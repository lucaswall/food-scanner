import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { ensureFreshToken, createNutritionLog, deleteNutritionLogs } from "@/lib/google-health";
import { getFoodLogEntryDetail, updateFoodLogEntry, updateFoodLogEntryMetadata, updateCustomFoodMetadata } from "@/lib/food-log";
import { isValidDateFormat, isValidTimeFormat } from "@/lib/date-utils";
import { isValidFoodAnalysisFields } from "@/lib/food-validation";
import { mapHealthError } from "@/lib/health-error-response";
import { checkRateLimit } from "@/lib/rate-limit";
import type { FoodAnalysis, FoodLogEntryDetail, ServingUnit } from "@/types";
import { MealType, coerceServingUnit } from "@/types";

// Task 3: Per-user rate limits (60 requests / 15 minutes)
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const VALID_MEAL_TYPE_IDS = [
  MealType.Breakfast,
  MealType.MorningSnack,
  MealType.Lunch,
  MealType.AfternoonSnack,
  MealType.Dinner,
  MealType.Anytime,
];


export function isNutritionUnchanged(analysis: FoodAnalysis, entry: FoodLogEntryDetail): boolean {
  return (
    analysis.food_name === entry.foodName &&
    analysis.amount === entry.amount &&
    analysis.unit_id === entry.unitId &&
    Math.round(analysis.calories) === entry.calories &&
    analysis.protein_g === entry.proteinG &&
    analysis.carbs_g === entry.carbsG &&
    analysis.fat_g === entry.fatG &&
    analysis.fiber_g === entry.fiberG &&
    analysis.sodium_mg === entry.sodiumMg &&
    (analysis.saturated_fat_g ?? null) === (entry.saturatedFatG ?? null) &&
    (analysis.trans_fat_g ?? null) === (entry.transFatG ?? null) &&
    (analysis.sugars_g ?? null) === (entry.sugarsG ?? null) &&
    (analysis.calories_from_fat ?? null) === (entry.caloriesFromFat ?? null)
  );
}

/** Build a FoodAnalysis from an existing entry's stored nutrients (fast-path re-create — nutrition unchanged). */
export function buildAnalysisFromEntry(entry: FoodLogEntryDetail): FoodAnalysis {
  return {
    food_name: entry.foodName,
    amount: entry.amount,
    unit_id: coerceServingUnit(entry.unitId),
    calories: entry.calories,
    protein_g: entry.proteinG,
    carbs_g: entry.carbsG,
    fat_g: entry.fatG,
    fiber_g: entry.fiberG,
    sodium_mg: entry.sodiumMg,
    saturated_fat_g: entry.saturatedFatG ?? null,
    trans_fat_g: entry.transFatG ?? null,
    sugars_g: entry.sugarsG ?? null,
    calories_from_fat: entry.caloriesFromFat ?? null,
    confidence: entry.confidence as "high" | "medium" | "low",
    notes: entry.notes ?? "",
    description: entry.description ?? "",
    keywords: entry.keywords,
  };
}


export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/edit-food");
  const session = await getSession();

  const validationError = validateSession(session, { requireHealth: true });
  if (validationError) return validationError;

  const { allowed } = checkRateLimit(`edit-food:${session!.userId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse("VALIDATION_ERROR", "Request body must be an object", 400);
  }

  const data = body as Record<string, unknown>;

  // Validate entryId
  if (typeof data.entryId !== "number" || !Number.isInteger(data.entryId) || data.entryId <= 0) {
    return errorResponse("VALIDATION_ERROR", "entryId must be a positive integer", 400);
  }

  // Validate FoodAnalysis fields
  if (!isValidFoodAnalysisFields(data)) {
    log.warn({ action: "edit_food_validation" }, "invalid FoodAnalysis fields");
    return errorResponse("VALIDATION_ERROR", "Missing or invalid required fields", 400);
  }

  // edit-food requires non-empty keywords (shared validator allows empty arrays)
  if (!Array.isArray(data.keywords) || data.keywords.length === 0) {
    log.warn({ action: "edit_food_validation" }, "keywords must be a non-empty array");
    return errorResponse("VALIDATION_ERROR", "Missing or invalid required fields", 400);
  }

  const analysis = data as unknown as FoodAnalysis;

  // Validate mealTypeId
  if (typeof data.mealTypeId !== "number" || !VALID_MEAL_TYPE_IDS.includes(data.mealTypeId as MealType)) {
    log.warn({ action: "edit_food_validation", mealTypeId: data.mealTypeId }, "invalid mealTypeId");
    return errorResponse("VALIDATION_ERROR", "Invalid mealTypeId. Must be 1 (Breakfast), 2 (Morning Snack), 3 (Lunch), 4 (Afternoon Snack), 5 (Dinner), or 7 (Anytime)", 400);
  }

  // Validate date
  if (typeof data.date !== "string" || !isValidDateFormat(data.date)) {
    return errorResponse("VALIDATION_ERROR", "Invalid date format. Use YYYY-MM-DD", 400);
  }

  // Validate time
  if (typeof data.time !== "string" || !isValidTimeFormat(data.time)) {
    return errorResponse("VALIDATION_ERROR", "Invalid time format. Use HH:mm or HH:mm:ss", 400);
  }

  // Validate zoneOffset (optional)
  if (data.zoneOffset !== undefined && data.zoneOffset !== null) {
    if (typeof data.zoneOffset !== "string" || !/^[+-]\d{2}:\d{2}$/.test(data.zoneOffset)) {
      return errorResponse("VALIDATION_ERROR", "Invalid zoneOffset format. Use ±HH:MM", 400);
    }
  }

  const entryId = data.entryId as number;
  const mealTypeId = data.mealTypeId as number;
  const date = data.date as string;
  const time = data.time as string;
  const requestZoneOffset = (data.zoneOffset as string | undefined) ?? null;
  const userId = session!.userId;

  // Look up existing entry
  const entry = await getFoodLogEntryDetail(userId, entryId);
  if (!entry) {
    return errorResponse("NOT_FOUND", "Food log entry not found", 404);
  }

  // P2-4: prefer the request's explicit offset, else preserve the entry's stored offset,
  // so a non-UTC meal is written at the correct instant instead of the `...Z` UTC fallback.
  const zoneOffset = requestZoneOffset ?? entry.zoneOffset;

  // Health-write timing for the new log: edited request values, with the resolved offset.
  const requestTiming = { date, time, zoneOffset, mealTypeId };

  log.info(
    { action: "edit_food_request", entryId, foodName: analysis.food_name, mealTypeId },
    "processing food edit request"
  );

  const isDryRun = process.env.HEALTH_DRY_RUN === "true";
  const calories = Math.round(analysis.calories);

  // ── Fast path: nutrition unchanged — create-new-first, then delete-old ───────
  // Ordering is create → DB-flip → delete-old (P1-7). A crash/timeout in any gap
  // leaves at worst a recoverable duplicate, never the data loss the old
  // delete-then-create ordering risked.

  if (isNutritionUnchanged(analysis, entry)) {
    let fastPathHealthLogId: string | null = entry.healthLogId;
    let accessToken: string | null = null;

    if (!isDryRun) {
      try {
        accessToken = await ensureFreshToken(userId, log);
      } catch (tokenErr) {
        log.error({ action: "edit_food_fast_path_ensure_token_failed", error: tokenErr instanceof Error ? tokenErr.message : String(tokenErr) }, "health error on token refresh (fast path)");
        return mapHealthError(tokenErr);
      }

      // CREATE-new-FIRST with the entry's stored nutrition (anonymous logs aren't
      // editable in place). The old log is untouched, so a failure here strands
      // nothing — old log + old DB row remain intact.
      try {
        const createResult = await createNutritionLog(accessToken, buildAnalysisFromEntry(entry), requestTiming, log, userId);
        fastPathHealthLogId = createResult.healthLogId;
      } catch (logErr) {
        log.error({ action: "edit_food_fast_path_relog_failed", error: logErr instanceof Error ? logErr.message : String(logErr) }, "fast path create failed — old log left intact, no compensation needed");
        return mapHealthError(logErr);
      }
    }

    // DB-flip: point the entry at the new log. This is the source-of-truth commit.
    try {
      await updateFoodLogEntryMetadata(userId, entryId, { mealTypeId, date, time, healthLogId: fastPathHealthLogId, zoneOffset }, log);
    } catch (dbErr) {
      log.error({ action: "edit_food_fast_path_db_error", error: dbErr instanceof Error ? dbErr.message : String(dbErr) }, "fast path DB update failed after create — cleaning up new log (old log + DB row intact)");

      // DB never flipped: the old log is still authoritative. Delete the new orphan
      // log (cleanup mode). No re-create — the old log was never touched.
      if (!isDryRun && accessToken && fastPathHealthLogId !== null && fastPathHealthLogId !== entry.healthLogId) {
        try {
          await deleteNutritionLogs(accessToken, [fastPathHealthLogId], log, userId, "cleanup");
          log.info({ action: "edit_food_fast_path_db_cleanup_success" }, "deleted orphaned new health log after DB failure");
        } catch (cleanupErr) {
          log.error(
            { action: "edit_food_fast_path_db_cleanup_failed", newHealthLogId: fastPathHealthLogId, error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr) },
            "CRITICAL: new health log orphaned — DB update failed and orphan cleanup failed; manual cleanup may be needed"
          );
          return errorResponse("PARTIAL_ERROR", "Food created in Google Health but local save failed and cleanup failed. Manual cleanup may be needed.", 500);
        }
      }

      return errorResponse("INTERNAL_ERROR", "Failed to save food edit", 500);
    }

    // ── Committed past here: the DB points at the new log. The tail is best-effort;
    //    failures leave a recoverable duplicate, never data loss, so they must NOT
    //    fail the request.

    // Cosmetic custom_foods metadata (notes/description/keywords/confidence).
    const metadataChanged =
      analysis.notes !== (entry.notes ?? "") ||
      analysis.description !== (entry.description ?? "") ||
      analysis.confidence !== entry.confidence ||
      JSON.stringify(analysis.keywords) !== JSON.stringify(entry.keywords);

    if (metadataChanged) {
      try {
        await updateCustomFoodMetadata(userId, entry.customFoodId, {
          notes: analysis.notes || null,
          description: analysis.description || null,
          keywords: analysis.keywords,
          confidence: analysis.confidence,
        }, log);
      } catch (metaErr) {
        log.warn(
          { action: "edit_food_fast_path_metadata_failed", error: metaErr instanceof Error ? metaErr.message : String(metaErr) },
          "fast path custom-food metadata update failed after edit committed — non-fatal"
        );
      }
    }

    // DELETE-old-LAST (cleanup): only now that the DB points at the new log. A failure
    // here may leave a duplicate old log (double-count, user-removable) — strictly
    // better than the data loss the old ordering risked, so do NOT fail the request.
    if (!isDryRun && accessToken && entry.healthLogId && entry.healthLogId !== fastPathHealthLogId) {
      try {
        await deleteNutritionLogs(accessToken, [entry.healthLogId], log, userId, "cleanup");
      } catch (deleteErr) {
        log.error(
          { action: "edit_food_fast_path_old_delete_failed", oldHealthLogId: entry.healthLogId, newHealthLogId: fastPathHealthLogId, error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr) },
          "CRITICAL: failed to delete old Google Health log after edit committed — a duplicate/orphan old log may remain (user-removable double-count)"
        );
      }
    }

    log.info(
      { action: "edit_food_fast_path_success", entryId, dryRun: isDryRun || undefined },
      isDryRun ? "food edit metadata saved in dry-run mode (fast path)" : "food edit metadata saved via fast path"
    );

    return successResponse({
      healthLogId: fastPathHealthLogId ?? undefined,
      foodLogId: entryId,
      reusedFood: true,
      ...(isDryRun && { dryRun: true }),
    });
  }

  // ── Regular path: nutrition changed — create-new-first, then delete-old ──────
  // Same inversion as the fast path (P1-7): create → DB-flip → delete-old, so a
  // crash/timeout in any gap leaves a recoverable duplicate, never data loss.

  let newHealthLogId: string | undefined;
  let accessToken: string | null = null;

  if (!isDryRun) {
    try {
      accessToken = await ensureFreshToken(userId, log);
    } catch (tokenErr) {
      log.error({ action: "edit_food_ensure_token_failed", error: tokenErr instanceof Error ? tokenErr.message : String(tokenErr) }, "health error on token refresh");
      return mapHealthError(tokenErr);
    }

    // CREATE-new-FIRST. The old log is untouched, so a failure here strands nothing —
    // old log + old DB row remain intact.
    try {
      const createResult = await createNutritionLog(
        accessToken,
        { ...analysis, calories },
        requestTiming,
        log,
        userId,
      );
      newHealthLogId = createResult.healthLogId ?? undefined;
    } catch (logErr) {
      log.error({ action: "edit_food_relog_failed", error: logErr instanceof Error ? logErr.message : String(logErr) }, "failed to create new health log — old log left intact, no compensation needed");
      return mapHealthError(logErr);
    }
  }

  // DB-flip: persist the edit, pointing the entry at the new log. Source-of-truth commit.
  let result: Awaited<ReturnType<typeof updateFoodLogEntry>>;
  try {
    result = await updateFoodLogEntry(
      userId,
      entryId,
      {
        foodName: analysis.food_name,
        amount: analysis.amount,
        unitId: analysis.unit_id as ServingUnit,
        calories,
        proteinG: analysis.protein_g,
        carbsG: analysis.carbs_g,
        fatG: analysis.fat_g,
        fiberG: analysis.fiber_g,
        sodiumMg: analysis.sodium_mg,
        saturatedFatG: analysis.saturated_fat_g,
        transFatG: analysis.trans_fat_g,
        sugarsG: analysis.sugars_g,
        caloriesFromFat: analysis.calories_from_fat,
        confidence: analysis.confidence,
        notes: analysis.notes || null,
        description: analysis.description || null,
        keywords: analysis.keywords ?? null,
        mealTypeId,
        date,
        time,
        zoneOffset,
        ...(newHealthLogId !== undefined ? { healthLogId: newHealthLogId } : {}),
      },
      log,
    );
  } catch (dbErr) {
    log.error({ action: "edit_food_db_error", error: dbErr instanceof Error ? dbErr.message : String(dbErr) }, "DB update failed after create — cleaning up new log (old log + DB row intact)");

    // DB never flipped: the old log is still authoritative. Delete the new orphan log
    // (cleanup mode). No re-create — the old log was never touched.
    if (!isDryRun && accessToken && newHealthLogId !== undefined) {
      try {
        await deleteNutritionLogs(accessToken, [newHealthLogId], log, userId, "cleanup");
        log.info({ action: "edit_food_db_cleanup_success", healthLogId: newHealthLogId }, "deleted orphaned new health log after DB failure");
      } catch (cleanupErr) {
        log.error(
          { action: "edit_food_db_cleanup_failed", newHealthLogId, error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr) },
          "CRITICAL: new health log orphaned — DB update failed and orphan cleanup failed; manual cleanup may be needed"
        );
        return errorResponse("PARTIAL_ERROR", "Food created in Google Health but local save failed and cleanup failed. Manual cleanup may be needed.", 500);
      }
    }

    return errorResponse("INTERNAL_ERROR", "Failed to save food edit", 500);
  }

  if (!result) {
    // The entry vanished between lookup and update. The new log (if any) is now an
    // orphan — clean it up so it doesn't double-count, then report NOT_FOUND.
    if (!isDryRun && accessToken && newHealthLogId !== undefined) {
      try {
        await deleteNutritionLogs(accessToken, [newHealthLogId], log, userId, "cleanup");
      } catch (cleanupErr) {
        log.error(
          { action: "edit_food_missing_entry_cleanup_failed", newHealthLogId, error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr) },
          "CRITICAL: entry missing on update and orphan new-log cleanup failed; manual cleanup may be needed"
        );
      }
    }
    return errorResponse("NOT_FOUND", "Food log entry not found during update", 404);
  }

  // ── Committed: the DB points at the new log. DELETE-old-LAST (cleanup): a failure
  //    here may leave a duplicate old log (user-removable double-count) — strictly
  //    better than data loss, so do NOT fail the request.
  if (!isDryRun && accessToken && entry.healthLogId && entry.healthLogId !== newHealthLogId) {
    try {
      await deleteNutritionLogs(accessToken, [entry.healthLogId], log, userId, "cleanup");
    } catch (deleteErr) {
      log.error(
        { action: "edit_food_old_delete_failed", oldHealthLogId: entry.healthLogId, newHealthLogId, error: deleteErr instanceof Error ? deleteErr.message : String(deleteErr) },
        "CRITICAL: failed to delete old Google Health log after edit committed — a duplicate/orphan old log may remain (user-removable double-count)"
      );
    }
  }

  log.info(
    { action: "edit_food_success", entryId, newCustomFoodId: result.newCustomFoodId, healthLogId: result.healthLogId, dryRun: isDryRun || undefined },
    isDryRun ? "food edit saved in dry-run mode" : "food edit saved successfully"
  );

  return successResponse({
    healthLogId: result.healthLogId ?? undefined,
    foodLogId: entryId,
    reusedFood: false,
    ...(isDryRun && { dryRun: true }),
  });
}
