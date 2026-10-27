import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getUserById } from "@/lib/users";

export async function GET() {
  const log = createRequestLogger("GET", "/api/auth/session");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  log.debug({ action: "session_check" }, "session valid");

  let user: Awaited<ReturnType<typeof getUserById>>;
  try {
    user = await getUserById(session!.userId, log);
  } catch (error) {
    log.error(
      { action: "session_user_lookup_error", error: error instanceof Error ? error.message : String(error) },
      "failed to load session user",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to load session", 500);
  }

  const response = successResponse({
    email: user?.email ?? null,
    healthConnected: session!.healthConnected,
    // Surface scope completeness so the client can prompt a reconnect for
    // scope_mismatch sessions instead of rendering health flows that 403.
    healthScopeComplete: session!.healthScopeComplete,
    expiresAt: session!.expiresAt,
  });
  response.headers.set("Cache-Control", "private, no-cache");
  return response;
}
