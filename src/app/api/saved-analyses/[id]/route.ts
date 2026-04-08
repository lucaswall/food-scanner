import { getSession, validateSession } from "@/lib/session";
import { conditionalResponse, errorResponse, successResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getSavedAnalysis, deleteSavedAnalysis } from "@/lib/saved-analyses";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const log = createRequestLogger("GET", "/api/saved-analyses/[id]");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { id: idParam } = await context.params;
  const id = Number(idParam);

  if (!Number.isInteger(id) || id <= 0) {
    return errorResponse("VALIDATION_ERROR", "Invalid saved analysis ID", 400);
  }

  try {
    const analysis = await getSavedAnalysis(session!.userId, id);

    if (!analysis) {
      return errorResponse("NOT_FOUND", "Saved analysis not found", 404);
    }

    return conditionalResponse(request, analysis);
  } catch (error) {
    log.error(
      {
        action: "get_saved_analysis_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to get saved analysis",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to get saved analysis", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const log = createRequestLogger("DELETE", "/api/saved-analyses/[id]");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { id: idParam } = await context.params;
  const id = Number(idParam);

  if (!Number.isInteger(id) || id <= 0) {
    return errorResponse("VALIDATION_ERROR", "Invalid saved analysis ID", 400);
  }

  try {
    const deleted = await deleteSavedAnalysis(session!.userId, id);

    if (!deleted) {
      return errorResponse("NOT_FOUND", "Saved analysis not found", 404);
    }

    log.info(
      { action: "delete_saved_analysis", userId: session!.userId, id },
      "deleted saved analysis",
    );

    return successResponse({ deleted: true });
  } catch (error) {
    log.error(
      {
        action: "delete_saved_analysis_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to delete saved analysis",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to delete saved analysis", 500);
  }
}
