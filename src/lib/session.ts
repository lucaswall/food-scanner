import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import type { SessionData, FullSession } from "@/types";
import { getRequiredEnv } from "@/lib/env";
import { errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getSessionById, deleteSession, touchSession } from "@/lib/session-db";
import { getFitbitTokens } from "@/lib/fitbit-tokens";
import { hasFitbitCredentials } from "@/lib/fitbit-credentials";

let touchFailCount = 0;
const TOUCH_FAIL_THRESHOLD = 3;

let _sessionOptions: SessionOptions | null = null;

function getSessionOptions(): SessionOptions {
  if (!_sessionOptions) {
    _sessionOptions = {
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
  }
  return _sessionOptions;
}

/** Returns raw iron-session object for write operations (OAuth callbacks) */
export async function getRawSession() {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, getSessionOptions());
}

const TWENTY_NINE_DAYS_MS = 29 * 24 * 60 * 60 * 1000;

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

  // Sliding expiration: extend session if it expires in less than 29 days.
  // This debounces to at most once per day of active use (30 - 29 = 1 day window).
  const msUntilExpiry = dbSession.expiresAt.getTime() - Date.now();
  if (msUntilExpiry < TWENTY_NINE_DAYS_MS) {
    touchSession(dbSession.id).then(() => {
      touchFailCount = 0;
    }).catch((err) => {
      touchFailCount++;
      const logLevel = touchFailCount >= TOUCH_FAIL_THRESHOLD ? "error" : "warn";
      logger[logLevel](
        { action: "touch_session_error", consecutiveFailures: touchFailCount, error: err instanceof Error ? err.message : String(err) },
        touchFailCount >= TOUCH_FAIL_THRESHOLD
          ? "persistent session touch failures detected"
          : "failed to extend session expiration",
      );
    });
  }

  const fitbitTokens = await getFitbitTokens(dbSession.userId);
  const hasCredentials = await hasFitbitCredentials(dbSession.userId);

  return {
    sessionId: dbSession.id,
    userId: dbSession.userId,
    expiresAt: dbSession.expiresAt.getTime(),
    fitbitConnected: fitbitTokens !== null,
    hasFitbitCredentials: hasCredentials,
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
