import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { ensureFreshToken, findOrCreateFood, logFood, deleteFoodLog } from "@/lib/fitbit";
import { getFoodLogEntryDetail, updateFoodLogEntry, updateFoodLogEntryMetadata } from "@/lib/food-log";
import { isValidDateFormat } from "@/lib/date-utils";
import type { FoodAnalysis, FoodLogEntryDetail } from "@/types";
import { FitbitMealType } from "@/types";

const VALID_MEAL_TYPE_IDS = [
  FitbitMealType.Breakfast,
  FitbitMealType.MorningSnack,
  FitbitMealType.Lunch,
  FitbitMealType.AfternoonSnack,
  FitbitMealType.Dinner,
  FitbitMealType.Anytime,
];

function isValidTimeFormat(time: string): boolean {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return false;
  const parts = time.split(":").map(Number);
  const hours = parts[0];
  const minutes = parts[1];
  const seconds = parts[2] ?? 0;
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
}

function isValidFoodAnalysis(req: Record<string, unknown>): boolean {
  if (
    typeof req.food_name !== "string" ||
    req.food_name.length === 0 ||
    req.food_name.length > 500 ||
    typeof req.amount !== "number" ||
    req.amount <= 0 ||
    typeof req.unit_id !== "number" ||
    typeof req.calories !== "number" ||
    req.calories < 0 ||
    typeof req.protein_g !== "number" ||
    req.protein_g < 0 ||
    typeof req.carbs_g !== "number" ||
    req.carbs_g < 0 ||
    typeof req.fat_g !== "number" ||
    req.fat_g < 0 ||
    typeof req.fiber_g !== "number" ||
    req.fiber_g < 0 ||
    typeof req.sodium_mg !== "number" ||
    req.sodium_mg < 0 ||
    typeof req.notes !== "string" ||
    req.notes.length > 2000 ||
    typeof req.description !== "string" ||
    req.description.length > 2000 ||
    (req.confidence !== "high" && req.confidence !== "medium" && req.confidence !== "low")
  ) {
    return false;
  }

  if (req.keywords !== undefined) {
    if (
      !Array.isArray(req.keywords) ||
      req.keywords.length > 20 ||
      !req.keywords.every((k: unknown) => typeof k === "string" && (k as string).length <= 100)
    ) {
      return false;
    }
  }

  const tier1Fields = ["saturated_fat_g", "trans_fat_g", "sugars_g", "calories_from_fat"] as const;
  for (const field of tier1Fields) {
    const value = req[field];
    if (value !== undefined && value !== null) {
      if (typeof value !== "number" || value < 0) return false;
    }
  }

  return true;
}

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

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/edit-food");
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: true });
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
  if (!isValidFoodAnalysis(data)) {
    log.warn({ action: "edit_food_validation" }, "invalid FoodAnalysis fields");
    return errorResponse("VALIDATION_ERROR", "Missing or invalid required fields", 400);
  }

  const analysis = data as unknown as FoodAnalysis;

  // Validate mealTypeId
  if (typeof data.mealTypeId !== "number" || !VALID_MEAL_TYPE_IDS.includes(data.mealTypeId as FitbitMealType)) {
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

  const entryId = data.entryId as number;
  const mealTypeId = data.mealTypeId as number;
  const date = data.date as string;
  const time = data.time as string;

  // Look up existing entry
  const entry = await getFoodLogEntryDetail(session!.userId, entryId);
  if (!entry) {
    return errorResponse("NOT_FOUND", "Food log entry not found", 404);
  }

  log.info(
    { action: "edit_food_request", entryId, foodName: analysis.food_name, mealTypeId },
    "processing food edit request"
  );

  const isDryRun = process.env.FITBIT_DRY_RUN === "true";
  const calories = Math.round(analysis.calories);

  // Fast path: nutrition unchanged — skip findOrCreateFood, only update metadata
  if (isNutritionUnchanged(analysis, entry)) {
    let fastPathFitbitLogId: number | null = entry.fitbitLogId;

    if (!isDryRun && entry.fitbitFoodId !== null) {
      const accessToken = await ensureFreshToken(session!.userId, log);

      // Delete old Fitbit log if exists
      if (entry.fitbitLogId) {
        try {
          await deleteFoodLog(accessToken, entry.fitbitLogId, log);
        } catch (deleteErr) {
          const errMsg = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
          log.error({ action: "edit_food_fast_path_delete_failed", error: errMsg }, "failed to delete old Fitbit log");
          return errorResponse("FITBIT_API_ERROR", "Failed to delete old Fitbit log", 500);
        }
      }

      // Re-log with existing fitbitFoodId
      try {
        const logResult = await logFood(accessToken, entry.fitbitFoodId, mealTypeId, analysis.amount, analysis.unit_id, date, time, log);
        fastPathFitbitLogId = logResult.foodLog.logId;
      } catch (logErr) {
        const errMsg = logErr instanceof Error ? logErr.message : String(logErr);
        log.error({ action: "edit_food_fast_path_relog_failed", error: errMsg }, "fast path re-log failed, attempting compensation");

        // Compensation: re-log with same fitbitFoodId
        if (entry.fitbitLogId) {
          try {
            const freshToken = await ensureFreshToken(session!.userId, log);
            await logFood(freshToken, entry.fitbitFoodId, entry.mealTypeId, entry.amount, entry.unitId, entry.date, entry.time ?? time, log);
            log.info({ action: "edit_food_fast_path_compensation_success" }, "fast path compensation succeeded");
          } catch (compensationErr) {
            log.error(
              { action: "edit_food_fast_path_compensation_failed", error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr) },
              "CRITICAL: fast path compensation failed after Fitbit log deleted"
            );
          }
        }

        return errorResponse("FITBIT_API_ERROR", "Failed to update food in Fitbit", 500);
      }
    }

    await updateFoodLogEntryMetadata(session!.userId, entryId, { mealTypeId, date, time, fitbitLogId: fastPathFitbitLogId }, log);

    log.info(
      { action: "edit_food_fast_path_success", entryId, dryRun: isDryRun || undefined },
      isDryRun ? "food edit metadata saved in dry-run mode (fast path)" : "food edit metadata saved via fast path"
    );

    return successResponse({
      fitbitFoodId: entry.fitbitFoodId ?? undefined,
      fitbitLogId: fastPathFitbitLogId ?? undefined,
      foodLogId: entryId,
      reusedFood: true,
      ...(isDryRun && { dryRun: true }),
    });
  }

  let newFitbitLogId: number | undefined;
  let fitbitFoodId: number | undefined;

  if (!isDryRun) {
    const accessToken = await ensureFreshToken(session!.userId, log);

    // Delete old Fitbit log if exists
    if (entry.fitbitLogId) {
      try {
        await deleteFoodLog(accessToken, entry.fitbitLogId, log);
        log.info({ action: "edit_food_old_fitbit_deleted", fitbitLogId: entry.fitbitLogId }, "old Fitbit log deleted");
      } catch (deleteErr) {
        const errMsg = deleteErr instanceof Error ? deleteErr.message : String(deleteErr);
        log.error({ action: "edit_food_delete_failed", error: errMsg }, "failed to delete old Fitbit log");
        return errorResponse("FITBIT_API_ERROR", "Failed to delete old Fitbit log", 500);
      }
    }

    // Create new Fitbit food + log
    try {
      const createResult = await findOrCreateFood(accessToken, { ...analysis, calories }, log);
      fitbitFoodId = createResult.foodId;
      const logResult = await logFood(
        accessToken,
        createResult.foodId,
        mealTypeId,
        analysis.amount,
        analysis.unit_id,
        date,
        time,
        log,
      );
      newFitbitLogId = logResult.foodLog.logId;
    } catch (logErr) {
      const errMsg = logErr instanceof Error ? logErr.message : String(logErr);
      log.error({ action: "edit_food_relog_failed", error: errMsg }, "failed to create new Fitbit log, attempting compensation");

      // Compensation: re-log the original entry
      if (entry.fitbitLogId) {
        try {
          const freshToken = await ensureFreshToken(session!.userId, log);
          const origCreate = await findOrCreateFood(freshToken, {
            food_name: entry.foodName,
            amount: entry.amount,
            unit_id: entry.unitId,
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
          }, log);
          await logFood(freshToken, origCreate.foodId, entry.mealTypeId, entry.amount, entry.unitId, entry.date, entry.time ?? time, log);
          log.info({ action: "edit_food_compensation_success" }, "original Fitbit log restored");
        } catch (compensationErr) {
          log.error(
            { action: "edit_food_compensation_failed", error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr) },
            "CRITICAL: compensation failed after Fitbit log deleted"
          );
        }
      }

      return errorResponse("FITBIT_API_ERROR", "Failed to update food in Fitbit", 500);
    }
  }

  // Update DB
  try {
    const result = await updateFoodLogEntry(
      session!.userId,
      entryId,
      {
        foodName: analysis.food_name,
        amount: analysis.amount,
        unitId: analysis.unit_id,
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
        ...(newFitbitLogId !== undefined ? { fitbitLogId: newFitbitLogId } : {}),
      },
      log,
    );

    if (!result) {
      return errorResponse("NOT_FOUND", "Food log entry not found during update", 404);
    }

    log.info(
      { action: "edit_food_success", entryId, newCustomFoodId: result.newCustomFoodId, fitbitLogId: result.fitbitLogId, dryRun: isDryRun || undefined },
      isDryRun ? "food edit saved in dry-run mode" : "food edit saved successfully"
    );

    return successResponse({
      fitbitFoodId: fitbitFoodId ?? undefined,
      fitbitLogId: result.fitbitLogId ?? undefined,
      foodLogId: entryId,
      reusedFood: false,
      ...(isDryRun && { dryRun: true }),
    });
  } catch (dbErr) {
    const errMsg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    log.error({ action: "edit_food_db_error", error: errMsg }, "DB update failed after Fitbit success, attempting compensation");

    // Compensation: delete new Fitbit log
    if (newFitbitLogId !== undefined && !isDryRun) {
      try {
        const freshToken = await ensureFreshToken(session!.userId, log);
        await deleteFoodLog(freshToken, newFitbitLogId, log);
        log.info({ action: "edit_food_db_compensation", fitbitLogId: newFitbitLogId }, "new Fitbit log deleted after DB failure");
      } catch (compensationErr) {
        log.error(
          { action: "edit_food_db_compensation_failed", fitbitLogId: newFitbitLogId, error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr) },
          "CRITICAL: new Fitbit log exists but DB update failed and compensation failed"
        );
        return errorResponse("PARTIAL_ERROR", "Food updated in Fitbit but local save failed. Manual cleanup may be needed.", 500);
      }
    }

    return errorResponse("INTERNAL_ERROR", "Failed to save food edit", 500);
  }
}
