import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { SessionData } from "@/types";
import { getRequiredEnv } from "@/lib/env";
import { errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";

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

export async function getSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export function validateSession(
  session: SessionData,
  options?: { requireFitbit?: boolean },
): Response | null {
  if (!session.sessionId) {
    logger.warn(
      { action: "session_invalid", reason: "missing" },
      "session validation failed: missing session",
    );
    return errorResponse("AUTH_MISSING_SESSION", "No active session", 401);
  }

  if (!session.expiresAt || session.expiresAt < Date.now()) {
    logger.warn(
      { action: "session_invalid", reason: "expired" },
      "session validation failed: expired",
    );
    return errorResponse("AUTH_SESSION_EXPIRED", "Session has expired", 401);
  }

  if (options?.requireFitbit && !session.fitbit) {
    logger.warn(
      { action: "session_invalid", reason: "fitbit_not_connected" },
      "session validation failed: fitbit not connected",
    );
    return errorResponse("FITBIT_NOT_CONNECTED", "Fitbit account not connected", 400);
  }

  return null;
}
