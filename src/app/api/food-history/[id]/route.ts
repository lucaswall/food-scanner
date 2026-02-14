import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getFoodLogEntry, deleteFoodLogEntry, getFoodLogEntryDetail } from "@/lib/food-log";
import { ensureFreshToken, deleteFoodLog } from "@/lib/fitbit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const response = successResponse(entry);
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    logger.error(
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
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: true });
  if (validationError) return validationError;

  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (Number.isNaN(id)) {
    return errorResponse("VALIDATION_ERROR", "Invalid entry ID", 400);
  }

  const entry = await getFoodLogEntry(session!.userId, id);
  if (!entry) {
    return errorResponse("NOT_FOUND", "Food log entry not found", 404);
  }

  try {
    const isDryRun = process.env.FITBIT_DRY_RUN === "true";

    // Delete from Fitbit first (if applicable), then local DB
    if (entry.fitbitLogId && !isDryRun) {
      const accessToken = await ensureFreshToken(session!.userId);
      await deleteFoodLog(accessToken, entry.fitbitLogId);
    }

    try {
      await deleteFoodLogEntry(session!.userId, id);
    } catch (dbErr) {
      logger.error(
        { action: "delete_food_log_db_error", entryId: id, error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
        "Fitbit delete succeeded but local DB delete failed",
      );
      return errorResponse("INTERNAL_ERROR", "Fitbit log deleted but local delete failed. Entry may be orphaned.", 500);
    }

    if (isDryRun) {
      logger.info(
        { action: "delete_food_log", entryId: id, fitbitLogId: entry.fitbitLogId },
        "food log entry deleted in dry-run mode (Fitbit API skipped)",
      );
    } else {
      logger.info(
        { action: "delete_food_log", entryId: id, fitbitLogId: entry.fitbitLogId },
        "food log entry deleted",
      );
    }

    return successResponse({ deleted: true });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage === "FITBIT_TOKEN_INVALID") {
      logger.warn(
        { action: "delete_food_log_token_invalid" },
        "Fitbit token invalid, reconnect required",
      );
      return errorResponse(
        "FITBIT_TOKEN_INVALID",
        "Fitbit session expired. Please reconnect your Fitbit account.",
        401,
      );
    }

    logger.error(
      { action: "delete_food_log_error", error: errorMessage },
      "failed to delete food log entry",
    );
    return errorResponse("FITBIT_API_ERROR", "Failed to delete food log entry", 502);
  }
}
