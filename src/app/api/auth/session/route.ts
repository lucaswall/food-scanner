import { getSession, validateSession } from "@/lib/session";
import { successResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getUserById } from "@/lib/users";

export async function GET() {
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  logger.debug({ action: "session_check" }, "session valid");

  const user = await getUserById(session!.userId);

  return successResponse({
    email: user?.email ?? null,
    fitbitConnected: session!.fitbitConnected,
    expiresAt: session!.expiresAt,
  });
}
