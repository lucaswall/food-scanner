import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { deleteLabel } from "@/lib/nutrition-labels";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const log = createRequestLogger("DELETE", "/api/nutrition-labels/[id]");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);

  if (Number.isNaN(id)) {
    return errorResponse("VALIDATION_ERROR", "Invalid label id", 400);
  }

  try {
    const deleted = await deleteLabel(session!.userId, id);

    if (!deleted) {
      return errorResponse("NOT_FOUND", "Label not found", 404);
    }

    return successResponse({ deleted: true });
  } catch (error) {
    log.error(
      {
        action: "delete_nutrition_label_error",
        labelId: id,
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to delete nutrition label",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to delete nutrition label", 500);
  }
}
