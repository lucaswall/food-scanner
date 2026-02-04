import { getSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";

export async function GET() {
  const session = await getSession();

  if (!session.sessionId) {
    logger.warn({ action: "session_invalid", reason: "missing" }, "no active session");
    return errorResponse("AUTH_MISSING_SESSION", "No active session", 401);
  }

  if (session.expiresAt < Date.now()) {
    logger.warn({ action: "session_invalid", reason: "expired" }, "session has expired");
    return errorResponse("AUTH_SESSION_EXPIRED", "Session has expired", 401);
  }

  logger.debug({ action: "session_check" }, "session valid");

  return successResponse({
    email: session.email,
    fitbitConnected: !!session.fitbit,
    expiresAt: session.expiresAt,
  });
}
