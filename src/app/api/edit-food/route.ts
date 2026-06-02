import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { ensureFreshToken, createNutritionLog, deleteNutritionLogs } from "@/lib/google-health";
import { getFoodLogEntryDetail, updateFoodLogEntry, updateFoodLogEntryMetadata, updateCustomFoodMetadata } from "@/lib/food-log";
import { isValidDateFormat, isValidTimeFormat } from "@/lib/date-utils";
import { isValidFoodAnalysisFields } from "@/lib/food-validation";
import { mapHealthError } from "@/lib/health-error-response";
import type { FoodAnalysis, FoodLogEntryDetail, ServingUnit } from "@/types";
import { MealType, coerceServingUnit } from "@/types";

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

/** Build a FoodAnalysis from an existing entry's stored nutrients (for compensation/fast-path recreate). */
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
  const zoneOffset = (data.zoneOffset as string | undefined) ?? null;
  const userId = session!.userId;

  // Look up existing entry
  const entry = await getFoodLogEntryDetail(userId, entryId);
  if (!entry) {
    return errorResponse("NOT_FOUND", "Food log entry not found", 404);
  }

  // Health-write timing: primary creates use the edited request values; compensation
  // re-creates restore the entry's original date/time/meal (FOO-1113).
  const requestTiming = { date, time, zoneOffset, mealTypeId };
  const entryTiming = { date: entry.date, time: entry.time, mealTypeId: entry.mealTypeId };

  log.info(
    { action: "edit_food_request", entryId, foodName: analysis.food_name, mealTypeId },
    "processing food edit request"
  );

  const isDryRun = process.env.HEALTH_DRY_RUN === "true";
  const calories = Math.round(analysis.calories);

  // ── Fast path: nutrition unchanged — delete+relog from entry's own nutrients ─

  if (isNutritionUnchanged(analysis, entry)) {
    let fastPathHealthLogId: string | null = entry.healthLogId;

    if (!isDryRun) {
      let accessToken: string;
      try {
        accessToken = await ensureFreshToken(userId, log);
      } catch (tokenErr) {
        log.error({ action: "edit_food_fast_path_ensure_token_failed", error: tokenErr instanceof Error ? tokenErr.message : String(tokenErr) }, "health error on token refresh (fast path)");
        return mapHealthError(tokenErr);
      }

      // Delete old health log if exists (user-initiated: 404 → HEALTH_LOG_NOT_FOUND, not silent)
      if (entry.healthLogId) {
        try {
          await deleteNutritionLogs(accessToken, [entry.healthLogId], log, userId, "user");
        } catch (deleteErr) {
          const errMsg = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
          if (errMsg === "HEALTH_LOG_NOT_FOUND") {
            // Data drift: the old Google Health entry is already gone. The delete's goal is
            // achieved, so proceed with the re-create rather than failing the edit with a
            // misleading 500 (mirrors food-history's drift handling — never strand the user).
            log.error(
              { action: "edit_food_fast_path_delete_drift", entryId, healthLogId: entry.healthLogId },
              "CRITICAL: old Google Health entry already gone (data drift) — proceeding with re-create",
            );
          } else {
            log.error({ action: "edit_food_fast_path_delete_failed", error: errMsg }, "failed to delete old health log");
            return mapHealthError(deleteErr);
          }
        }
      }

      // Re-create with entry's stored nutrition (anonymous logs aren't editable in place)
      try {
        const createResult = await createNutritionLog(accessToken, buildAnalysisFromEntry(entry), requestTiming, log, userId);
        fastPathHealthLogId = createResult.healthLogId;
      } catch (logErr) {
        const errMsg = logErr instanceof Error ? logErr.message : String(logErr);
        log.error({ action: "edit_food_fast_path_relog_failed", error: errMsg }, "fast path re-create failed, attempting compensation");

        // Compensation: re-create original health log
        if (entry.healthLogId) {
          try {
            const freshToken = await ensureFreshToken(userId, log);
            const compensationResult = await createNutritionLog(freshToken, buildAnalysisFromEntry(entry), entryTiming, log, userId);
            const compensationHealthLogId = compensationResult.healthLogId;
            try {
              await updateFoodLogEntryMetadata(userId, entryId, {
                mealTypeId: entry.mealTypeId,
                date: entry.date,
                time: entry.time ?? time,
                healthLogId: compensationHealthLogId,
              }, log);
            } catch (dbUpdateErr) {
              log.error(
                { action: "edit_food_fast_path_compensation_db_failed", error: dbUpdateErr instanceof Error ? dbUpdateErr.message : String(dbUpdateErr) },
                "failed to update healthLogId after fast path compensation"
              );
              return errorResponse("PARTIAL_ERROR", "Food restored in Google Health but local ID link failed. Manual cleanup may be needed.", 500);
            }
            log.info({ action: "edit_food_fast_path_compensation_success" }, "fast path compensation succeeded");
          } catch (compensationErr) {
            log.error(
              {
                action: "edit_food_fast_path_compensation_failed",
                oldHealthLogId: entry.healthLogId,
                error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr),
              },
              "CRITICAL: fast path compensation failed after health log deleted — original could not be restored"
            );
            return errorResponse("PARTIAL_ERROR", "Health entry deleted but original could not be restored. Manual recovery needed.", 500);
          }
        }

        return mapHealthError(logErr);
      }
    }

    try {
      await updateFoodLogEntryMetadata(userId, entryId, { mealTypeId, date, time, healthLogId: fastPathHealthLogId, zoneOffset }, log);

      // Update custom_foods metadata if it changed
      const metadataChanged =
        analysis.notes !== (entry.notes ?? "") ||
        analysis.description !== (entry.description ?? "") ||
        analysis.confidence !== entry.confidence ||
        JSON.stringify(analysis.keywords) !== JSON.stringify(entry.keywords);

      if (metadataChanged) {
        await updateCustomFoodMetadata(userId, entry.customFoodId, {
          notes: analysis.notes || null,
          description: analysis.description || null,
          keywords: analysis.keywords,
          confidence: analysis.confidence,
        }, log);
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
    } catch (dbErr) {
      const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      log.error({ action: "edit_food_fast_path_db_error", error: errMsg }, "fast path DB update failed after health log creation, attempting compensation");

      // Compensation: delete new health log + re-create original
      if (!isDryRun && fastPathHealthLogId !== null && fastPathHealthLogId !== entry.healthLogId) {
        try {
          const freshToken = await ensureFreshToken(userId, log);
          await deleteNutritionLogs(freshToken, [fastPathHealthLogId!], log, userId, "cleanup");
          const compensationResult = await createNutritionLog(freshToken, buildAnalysisFromEntry(entry), entryTiming, log, userId);
          const compensationHealthLogId = compensationResult.healthLogId;
          try {
            await updateFoodLogEntryMetadata(userId, entryId, {
              mealTypeId: entry.mealTypeId,
              date: entry.date,
              time: entry.time ?? time,
              healthLogId: compensationHealthLogId,
            }, log);
          } catch (dbUpdateErr) {
            log.error(
              { action: "edit_food_fast_path_db_compensation_failed", error: dbUpdateErr instanceof Error ? dbUpdateErr.message : String(dbUpdateErr) },
              "failed to update healthLogId after fast path DB compensation"
            );
            return errorResponse("PARTIAL_ERROR", "Food restored in Google Health but local ID link failed. Manual cleanup may be needed.", 500);
          }
          log.info({ action: "edit_food_fast_path_db_compensation_success" }, "fast path DB compensation succeeded");
        } catch (compensationErr) {
          log.error(
            {
              action: "edit_food_fast_path_db_compensation_failed",
              healthLogId: fastPathHealthLogId,
              oldHealthLogId: entry.healthLogId,
              error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr),
            },
            "CRITICAL: fast path health log compensation failed after DB error — orphaned health log may exist"
          );
          return errorResponse("PARTIAL_ERROR", "Food updated in Google Health but local save failed. Manual cleanup may be needed.", 500);
        }
      }

      return errorResponse("INTERNAL_ERROR", "Failed to save food edit", 500);
    }
  }

  // ── Regular path: nutrition changed — delete+create ──────────────────────────

  let newHealthLogId: string | undefined;

  if (!isDryRun) {
    let accessToken: string;
    try {
      accessToken = await ensureFreshToken(userId, log);
    } catch (tokenErr) {
      log.error({ action: "edit_food_ensure_token_failed", error: tokenErr instanceof Error ? tokenErr.message : String(tokenErr) }, "health error on token refresh");
      return mapHealthError(tokenErr);
    }

    // Delete old health log if exists (user-initiated: 404 → HEALTH_LOG_NOT_FOUND, not silent)
    if (entry.healthLogId) {
      try {
        await deleteNutritionLogs(accessToken, [entry.healthLogId], log, userId, "user");
        log.info({ action: "edit_food_old_health_deleted", healthLogId: entry.healthLogId }, "old health log deleted");
      } catch (deleteErr) {
        const errMsg = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
        if (errMsg === "HEALTH_LOG_NOT_FOUND") {
          // Data drift: the old Google Health entry is already gone. Proceed with creating the
          // new log instead of failing the edit with a misleading 500 (mirrors food-history's
          // drift handling — never strand the user with an uneditable entry).
          log.error(
            { action: "edit_food_delete_drift", entryId, healthLogId: entry.healthLogId },
            "CRITICAL: old Google Health entry already gone (data drift) — proceeding with create",
          );
        } else {
          log.error({ action: "edit_food_delete_failed", error: errMsg }, "failed to delete old health log");
          return mapHealthError(deleteErr);
        }
      }
    }

    // Create new health log
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
      const errMsg = logErr instanceof Error ? logErr.message : String(logErr);
      log.error({ action: "edit_food_relog_failed", error: errMsg }, "failed to create new health log, attempting compensation");

      // Compensation: re-create the original entry's health log
      if (entry.healthLogId) {
        try {
          const freshToken = await ensureFreshToken(userId, log);
          const compensationResult = await createNutritionLog(freshToken, buildAnalysisFromEntry(entry), entryTiming, log, userId);
          const compensationHealthLogId = compensationResult.healthLogId;
          try {
            await updateFoodLogEntryMetadata(userId, entryId, {
              mealTypeId: entry.mealTypeId,
              date: entry.date,
              time: entry.time ?? time,
              healthLogId: compensationHealthLogId,
            }, log);
          } catch (dbUpdateErr) {
            log.error(
              { action: "edit_food_compensation_db_failed", error: dbUpdateErr instanceof Error ? dbUpdateErr.message : String(dbUpdateErr) },
              "failed to update healthLogId after regular path compensation"
            );
            return errorResponse("PARTIAL_ERROR", "Food restored in Google Health but local ID link failed. Manual cleanup may be needed.", 500);
          }
          log.info({ action: "edit_food_compensation_success" }, "original health log restored");
        } catch (compensationErr) {
          log.error(
            {
              action: "edit_food_compensation_failed",
              oldHealthLogId: entry.healthLogId,
              error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr),
            },
            "CRITICAL: compensation failed after health log deleted — original could not be restored"
          );
          return errorResponse("PARTIAL_ERROR", "Health entry deleted but original could not be restored. Manual recovery needed.", 500);
        }
      }

      return mapHealthError(logErr);
    }
  }

  // Update DB
  try {
    const result = await updateFoodLogEntry(
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

    if (!result) {
      return errorResponse("NOT_FOUND", "Food log entry not found during update", 404);
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
  } catch (dbErr) {
    const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    log.error({ action: "edit_food_db_error", error: errMsg }, "DB update failed after health log creation, attempting compensation");

    // Compensation: delete new health log + re-create original (mirrors fast-path pattern)
    if (newHealthLogId !== undefined && !isDryRun) {
      try {
        const freshToken = await ensureFreshToken(userId, log);
        await deleteNutritionLogs(freshToken, [newHealthLogId], log, userId, "cleanup");
        // Re-create the original health log from the entry's stored nutrients
        const compensationResult = await createNutritionLog(freshToken, buildAnalysisFromEntry(entry), entryTiming, log, userId);
        const compensationHealthLogId = compensationResult.healthLogId;
        try {
          await updateFoodLogEntryMetadata(userId, entryId, {
            mealTypeId: entry.mealTypeId,
            date: entry.date,
            time: entry.time ?? time,
            healthLogId: compensationHealthLogId,
          }, log);
        } catch (dbUpdateErr) {
          log.error(
            { action: "edit_food_db_compensation_db_failed", error: dbUpdateErr instanceof Error ? dbUpdateErr.message : String(dbUpdateErr) },
            "failed to update healthLogId after regular path DB compensation"
          );
          return errorResponse("PARTIAL_ERROR", "Food restored in Google Health but local ID link failed. Manual cleanup may be needed.", 500);
        }
        log.info({ action: "edit_food_db_compensation_success", healthLogId: compensationHealthLogId }, "original health log restored after DB failure");
      } catch (compensationErr) {
        log.error(
          { action: "edit_food_db_compensation_failed", healthLogId: newHealthLogId, error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr) },
          "CRITICAL: new health log exists but DB update failed and compensation failed"
        );
        return errorResponse("PARTIAL_ERROR", "Food updated in Google Health but local save failed. Manual cleanup may be needed.", 500);
      }
    }

    return errorResponse("INTERNAL_ERROR", "Failed to save food edit", 500);
  }
}
