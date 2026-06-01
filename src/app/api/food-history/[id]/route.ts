import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse, conditionalResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getFoodLogEntry, deleteFoodLogEntry, getFoodLogEntryDetail } from "@/lib/food-log";
import { ensureFreshToken, deleteNutritionLogs } from "@/lib/google-health";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const log = createRequestLogger("GET", "/api/food-history/[id]");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (Number.isNaN(id)) {
    return errorResponse("VALIDATION_ERROR", "Invalid entry ID", 400);
  }

  try {
    const entry = await getFoodLogEntryDetail(session!.userId, id);
    if (!entry) {
      return errorResponse("NOT_FOUND", "Food log entry not found", 404);
    }

    return conditionalResponse(request, entry);
  } catch (error) {
    log.error(
      { action: "get_food_entry_detail_error", entryId: id, error: error instanceof Error ? error.message : String(error) },
      "failed to get food entry detail",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to get food entry detail", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const log = createRequestLogger("DELETE", "/api/food-history/[id]");
  const session = await getSession();

  const validationError = validateSession(session, { requireHealth: true });
  if (validationError) return validationError;

  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (Number.isNaN(id)) {
    return errorResponse("VALIDATION_ERROR", "Invalid entry ID", 400);
  }

  let entry;
  try {
    entry = await getFoodLogEntry(session!.userId, id);
  } catch (error) {
    log.error(
      { action: "delete_food_log_lookup_error", entryId: id, error: error instanceof Error ? error.message : String(error) },
      "failed to look up food log entry",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to look up food log entry", 500);
  }
  if (!entry) {
    return errorResponse("NOT_FOUND", "Food log entry not found", 404);
  }

  try {
    const isDryRun = process.env.HEALTH_DRY_RUN === "true";

    // Delete from Google Health first (if applicable), then local DB
    if (entry.healthLogId && !isDryRun) {
      const accessToken = await ensureFreshToken(session!.userId, log);
      await deleteNutritionLogs(accessToken, [entry.healthLogId], log, session!.userId);
    }

    try {
      await deleteFoodLogEntry(session!.userId, id, log);
    } catch (dbErr) {
      log.error(
        { action: "delete_food_log_db_error", entryId: id, error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
        "Health delete succeeded but local DB delete failed",
      );
      return errorResponse("INTERNAL_ERROR", "Health log deleted but local delete failed. Entry may be orphaned.", 500);
    }

    if (isDryRun) {
      log.info(
        { action: "delete_food_log", entryId: id, healthLogId: entry.healthLogId },
        "food log entry deleted in dry-run mode (Health API skipped)",
      );
    } else {
      log.info(
        { action: "delete_food_log", entryId: id, healthLogId: entry.healthLogId },
        "food log entry deleted",
      );
    }

    return successResponse({ deleted: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage === "HEALTH_TOKEN_INVALID") {
      log.warn(
        { action: "delete_food_log_token_invalid" },
        "Google Health token invalid, reconnect required",
      );
      return errorResponse(
        "HEALTH_TOKEN_INVALID",
        "Google Health session expired. Please reconnect your account.",
        401,
      );
    }

    if (errorMessage === "HEALTH_RATE_LIMIT_LOW") {
      log.warn(
        { action: "delete_food_log_rate_limit_low" },
        "Google Health rate limit headroom low",
      );
      return errorResponse(
        "HEALTH_RATE_LIMIT_LOW",
        "Google Health rate-limit headroom is low. Please try again in a few minutes.",
        503,
      );
    }

    log.error(
      { action: "delete_food_log_error", error: errorMessage },
      "failed to delete food log entry",
    );
    return errorResponse("HEALTH_API_ERROR", "Failed to delete food log entry", 502);
  }
}
