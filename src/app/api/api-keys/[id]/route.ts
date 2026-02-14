import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { revokeApiKey } from "@/lib/api-keys";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { id: idParam } = await context.params;
  const id = Number(idParam);

  if (isNaN(id) || id <= 0) {
    return errorResponse("VALIDATION_ERROR", "Invalid API key ID", 400);
  }

  logger.info(
    { action: "revoke_api_key", userId: session!.userId, keyId: id },
    "Revoking API key",
  );

  try {
    const revoked = await revokeApiKey(session!.userId, id);

    if (!revoked) {
      return errorResponse("NOT_FOUND", "API key not found or access denied", 404);
    }

    return successResponse({ revoked: true });
  } catch (error) {
    logger.error(
      { action: "revoke_api_key_error", error: error instanceof Error ? error.message : String(error) },
      "Failed to revoke API key",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to revoke API key", 500);
  }
}
