import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { revokeApiKey } from "@/lib/api-keys";

const MAX_INT4 = 2147483647;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const log = createRequestLogger("DELETE", "/api/api-keys/[id]");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { id: idParam } = await context.params;
  // api_keys.id is a Postgres serial (int4): reject anything else before it reaches the DB
  const id = /^\d+$/.test(idParam) ? Number(idParam) : NaN;

  if (!Number.isSafeInteger(id) || id <= 0 || id > MAX_INT4) {
    return errorResponse("VALIDATION_ERROR", "Invalid API key ID", 400);
  }

  log.info(
    { action: "revoke_api_key", userId: session!.userId, keyId: id },
    "Revoking API key",
  );

  try {
    const revoked = await revokeApiKey(session!.userId, id, log);

    if (!revoked) {
      return errorResponse("NOT_FOUND", "API key not found or access denied", 404);
    }

    return successResponse({ revoked: true });
  } catch (error) {
    log.error(
      { action: "revoke_api_key_error", error: error instanceof Error ? error.message : String(error) },
      "Failed to revoke API key",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to revoke API key", 500);
  }
}
