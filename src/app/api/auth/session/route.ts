import { getSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";

export async function GET() {
  const session = await getSession();

  if (!session.sessionId) {
    return errorResponse("AUTH_MISSING_SESSION", "No active session", 401);
  }

  if (session.expiresAt < Date.now()) {
    return errorResponse("AUTH_SESSION_EXPIRED", "Session has expired", 401);
  }

  return successResponse({
    email: session.email,
    fitbitConnected: !!session.fitbit,
    expiresAt: session.expiresAt,
  });
}
