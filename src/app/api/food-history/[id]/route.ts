import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse, conditionalResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getFoodLogEntry, deleteFoodLogEntry, getFoodLogEntryDetail } from "@/lib/food-log";
import { ensureFreshToken, deleteNutritionLogs } from "@/lib/google-health";
import { mapHealthError, isExpectedHealthError } from "@/lib/health-error-response";

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
      // User-initiated delete: a 404 means our stored id has no live Health entry (data
      // drift). Surface it loudly, but the Health entry is definitively gone, so still
      // remove the local row — never strand the user with an undeletable entry.
      try {
        await deleteNutritionLogs(accessToken, [entry.healthLogId], log, session!.userId, "user");
      } catch (healthErr) {
        if (healthErr instanceof Error && healthErr.message === "HEALTH_LOG_NOT_FOUND") {
          log.error(
            { action: "delete_food_log_health_drift", entryId: id, healthLogId: entry.healthLogId },
            "CRITICAL: Google Health entry already gone (data drift) — proceeding with local delete",
          );
        } else {
          throw healthErr; // transient/other Health error → mapped to the right HTTP status below
        }
      }
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
    const errMsg = error instanceof Error ? error.message : String(error);
    // Expected operational conditions (token expiry, rate limit, timeout) log at warn to
    // avoid Sentry noise; genuine faults stay at error.
    if (isExpectedHealthError(error)) {
      log.warn({ action: "delete_food_log_error", error: errMsg }, "Google Health transient error deleting food log");
    } else {
      log.error({ action: "delete_food_log_error", error: errMsg }, "failed to delete food log entry");
    }
    return mapHealthError(error);
  }
}
