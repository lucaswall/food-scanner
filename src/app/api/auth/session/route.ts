import { getSession, validateSession } from "@/lib/session";
import { successResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";

export async function GET() {
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  logger.debug({ action: "session_check" }, "session valid");

  return successResponse({
    email: session!.email,
    fitbitConnected: session!.fitbitConnected,
    expiresAt: session!.expiresAt,
  });
}
