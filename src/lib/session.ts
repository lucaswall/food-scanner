import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { SessionData, FullSession } from "@/types";
import { getRequiredEnv } from "@/lib/env";
import { errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getSessionById, deleteSession } from "@/lib/session-db";
import { getFitbitTokens } from "@/lib/fitbit-tokens";

export const sessionOptions: SessionOptions = {
  password: getRequiredEnv("SESSION_SECRET"),
  cookieName: "food-scanner-session",
  cookieOptions: {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // Must be "lax" for OAuth redirect flows
    maxAge: 30 * 24 * 60 * 60, // 30 days
    path: "/",
  },
};

/** Returns raw iron-session object for write operations (OAuth callbacks) */
export async function getRawSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

/** Returns full session data from cookie + DB, or null if no valid session */
export async function getSession(): Promise<FullSession | null> {
  const rawSession = await getRawSession();

  if (!rawSession.sessionId) {
    return null;
  }

  const dbSession = await getSessionById(rawSession.sessionId);
  if (!dbSession) {
    return null;
  }

  const fitbitTokens = await getFitbitTokens(dbSession.email);

  return {
    sessionId: dbSession.id,
    email: dbSession.email,
    expiresAt: dbSession.expiresAt.getTime(),
    fitbitConnected: fitbitTokens !== null,
    destroy: async () => {
      await deleteSession(dbSession.id);
      rawSession.destroy();
    },
  };
}

export function validateSession(
  session: FullSession | null,
  options?: { requireFitbit?: boolean },
): Response | null {
  if (!session) {
    logger.warn(
      { action: "session_invalid", reason: "missing" },
      "session validation failed: missing session",
    );
    return errorResponse("AUTH_MISSING_SESSION", "No active session", 401);
  }

  if (options?.requireFitbit && !session.fitbitConnected) {
    logger.warn(
      { action: "session_invalid", reason: "fitbit_not_connected" },
      "session validation failed: fitbit not connected",
    );
    return errorResponse("FITBIT_NOT_CONNECTED", "Fitbit account not connected", 400);
  }

  return null;
}
