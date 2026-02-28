import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { toggleFavorite } from "@/lib/food-log";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const log = createRequestLogger("PATCH", "/api/custom-foods/[id]/favorite");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (Number.isNaN(id)) {
    return errorResponse("VALIDATION_ERROR", "Invalid food ID", 400);
  }

  try {
    const result = await toggleFavorite(session!.userId, id);
    if (!result) {
      return errorResponse("NOT_FOUND", "Food not found", 404);
    }

    return successResponse(result);
  } catch (error) {
    log.error(
      { action: "toggle_favorite_error", foodId: id, error: error instanceof Error ? error.message : String(error) },
      "failed to toggle favorite",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to toggle favorite", 500);
  }
}
