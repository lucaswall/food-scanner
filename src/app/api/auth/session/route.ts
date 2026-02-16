import { getSession, validateSession } from "@/lib/session";
import { successResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getUserById } from "@/lib/users";

export async function GET() {
  const log = createRequestLogger("GET", "/api/auth/session");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  log.debug({ action: "session_check" }, "session valid");

  const user = await getUserById(session!.userId);

  const response = successResponse({
    email: user?.email ?? null,
    fitbitConnected: session!.fitbitConnected,
    hasFitbitCredentials: session!.hasFitbitCredentials,
    expiresAt: session!.expiresAt,
  });
  response.headers.set("Cache-Control", "private, no-cache");
  return response;
}
