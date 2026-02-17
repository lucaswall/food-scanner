import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { ensureFreshToken, findOrCreateFood, logFood, deleteFoodLog } from "@/lib/fitbit";
import { insertCustomFood, insertFoodLogEntry, getCustomFoodById, updateCustomFoodMetadata } from "@/lib/food-log";
import { isValidDateFormat } from "@/lib/date-utils";
import type { FoodLogRequest, FoodLogResponse } from "@/types";
import { FitbitMealType } from "@/types";

const VALID_MEAL_TYPE_IDS = [
  FitbitMealType.Breakfast,
  FitbitMealType.MorningSnack,
  FitbitMealType.Lunch,
  FitbitMealType.AfternoonSnack,
  FitbitMealType.Dinner,
  FitbitMealType.Anytime,
];

function isValidFoodLogRequest(body: unknown): body is FoodLogRequest {
  if (!body || typeof body !== "object") return false;
  const req = body as Record<string, unknown>;

  // mealTypeId, date, and time are always required
  if (typeof req.mealTypeId !== "number") return false;
  if (typeof req.date !== "string") return false;
  if (typeof req.time !== "string") return false;

  // Reuse flow: reuseCustomFoodId + mealTypeId + date + time needed, optional metadata
  if (req.reuseCustomFoodId !== undefined) {
    if (typeof req.reuseCustomFoodId !== "number" || req.reuseCustomFoodId <= 0) return false;
    // Validate optional metadata update fields
    if (req.newDescription !== undefined) {
      if (typeof req.newDescription !== "string" || req.newDescription.length > 2000) return false;
    }
    if (req.newNotes !== undefined) {
      if (typeof req.newNotes !== "string" || req.newNotes.length > 2000) return false;
    }
    if (req.newKeywords !== undefined) {
      if (!Array.isArray(req.newKeywords) || !req.newKeywords.every((k: unknown) => typeof k === "string")) return false;
    }
    if (req.newConfidence !== undefined && req.newConfidence !== "high" && req.newConfidence !== "medium" && req.newConfidence !== "low") return false;
    return true;
  }

  // New food flow: all FoodAnalysis fields required
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
    (req.confidence !== "high" &&
      req.confidence !== "medium" &&
      req.confidence !== "low")
  ) {
    return false;
  }

  // Validate keywords if present: must be an array of strings, each ≤100 chars
  if (req.keywords !== undefined) {
    if (
      !Array.isArray(req.keywords) ||
      !req.keywords.every((k: unknown) => typeof k === "string" && (k as string).length <= 100)
    ) {
      return false;
    }
  }

  // Validate Tier 1 nutrients if present: must be null or non-negative number
  const tier1Fields = ["saturated_fat_g", "trans_fat_g", "sugars_g", "calories_from_fat"] as const;
  for (const field of tier1Fields) {
    const value = req[field];
    if (value !== undefined && value !== null) {
      if (typeof value !== "number" || value < 0) {
        return false;
      }
    }
  }

  return true;
}


function isValidTimeFormat(time: string): boolean {
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return false;
  const parts = time.split(":").map(Number);
  const hours = parts[0];
  const minutes = parts[1];
  const seconds = parts[2] ?? 0;
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
}

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/log-food");
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: true });
  if (validationError) return validationError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (!isValidFoodLogRequest(body)) {
    log.warn({ action: "log_food_validation" }, "invalid request body");
    return errorResponse(
      "VALIDATION_ERROR",
      "Missing or invalid required fields",
      400
    );
  }

  if (!VALID_MEAL_TYPE_IDS.includes(body.mealTypeId)) {
    log.warn(
      { action: "log_food_validation", mealTypeId: body.mealTypeId },
      "invalid mealTypeId"
    );
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid mealTypeId. Must be 1 (Breakfast), 2 (Morning Snack), 3 (Lunch), 4 (Afternoon Snack), 5 (Dinner), or 7 (Anytime)",
      400
    );
  }

  if (!isValidDateFormat(body.date)) {
    log.warn(
      { action: "log_food_validation" },
      "invalid date format"
    );
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid date format. Use YYYY-MM-DD",
      400
    );
  }

  if (!isValidTimeFormat(body.time)) {
    log.warn(
      { action: "log_food_validation" },
      "invalid time format"
    );
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid time format. Use HH:mm or HH:mm:ss",
      400
    );
  }

  log.info(
    {
      action: "log_food_request",
      ...(body.reuseCustomFoodId
        ? { reuseCustomFoodId: body.reuseCustomFoodId }
        : { foodName: body.food_name }),
      mealTypeId: body.mealTypeId,
    },
    "processing food log request"
  );

  const isDryRun = process.env.FITBIT_DRY_RUN === "true";

  try {
    const { date, time } = body;
    let foodLogId: number | undefined;

    if (body.reuseCustomFoodId) {
      // Reuse flow: skip food creation, use existing custom food
      const existingFood = await getCustomFoodById(session!.userId, body.reuseCustomFoodId);
      if (!existingFood) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Custom food not found",
          400
        );
      }
      if (!isDryRun && !existingFood.fitbitFoodId) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Custom food has no Fitbit food ID",
          400
        );
      }

      const reused = true;
      let fitbitLogId: number | undefined;

      if (!isDryRun) {
        const accessToken = await ensureFreshToken(session!.userId, log);
        const logResult = await logFood(
          accessToken,
          existingFood.fitbitFoodId!,
          body.mealTypeId,
          Number(existingFood.amount),
          existingFood.unitId,
          date,
          time,
          log,
        );
        fitbitLogId = logResult.foodLog.logId;
      }

      // Log entry only (no new custom_food)
      try {
        const logEntryResult = await insertFoodLogEntry(session!.userId, {
          customFoodId: existingFood.id,
          mealTypeId: body.mealTypeId,
          amount: Number(existingFood.amount),
          unitId: existingFood.unitId,
          date,
          time,
          fitbitLogId: fitbitLogId ?? null,
        });
        foodLogId = logEntryResult.id;

        // Update custom food metadata if new values provided (fire-and-forget)
        const hasMetadataUpdates =
          body.newDescription !== undefined ||
          body.newNotes !== undefined ||
          body.newKeywords !== undefined ||
          body.newConfidence !== undefined;

        if (hasMetadataUpdates) {
          const metadataUpdate: {
            description?: string;
            notes?: string;
            keywords?: string[];
            confidence?: "high" | "medium" | "low";
          } = {};
          if (body.newDescription !== undefined) metadataUpdate.description = body.newDescription as string;
          if (body.newNotes !== undefined) metadataUpdate.notes = body.newNotes as string;
          if (body.newKeywords !== undefined) metadataUpdate.keywords = body.newKeywords as string[];
          if (body.newConfidence !== undefined) metadataUpdate.confidence = body.newConfidence as "high" | "medium" | "low";

          updateCustomFoodMetadata(session!.userId, existingFood.id, metadataUpdate).catch((err) => {
            log.error(
              { action: "update_custom_food_metadata_failed", error: err instanceof Error ? err.message : String(err) },
              "Failed to update custom food metadata (non-blocking)"
            );
          });
        }
      } catch (dbErr) {
        log.error(
          { action: "food_log_db_error", error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
          "DB write failed after Fitbit success, attempting compensation"
        );
        if (fitbitLogId && !isDryRun) {
          try {
            const accessToken = await ensureFreshToken(session!.userId, log);
            await deleteFoodLog(accessToken, fitbitLogId, log);
            log.info({ action: "food_log_compensation", fitbitLogId }, "Fitbit log rolled back after DB failure");
          } catch (compensationErr) {
            log.error(
              { action: "food_log_compensation_failed", fitbitLogId, error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr) },
              "CRITICAL: Fitbit log exists but DB write failed and compensation failed"
            );
            return errorResponse("PARTIAL_ERROR", "Food logged to Fitbit but local save failed. Manual cleanup may be needed.", 500);
          }
        }
        return errorResponse("INTERNAL_ERROR", "Failed to save food log", 500);
      }

      const response: FoodLogResponse = {
        success: true,
        fitbitFoodId: existingFood.fitbitFoodId ?? undefined,
        fitbitLogId,
        reusedFood: reused,
        foodLogId,
        ...(isDryRun && { dryRun: true }),
      };

      log.info(
        {
          action: "log_food_success",
          foodId: existingFood.fitbitFoodId,
          logId: fitbitLogId,
          reused,
          foodLogId,
          dryRun: isDryRun || undefined,
        },
        isDryRun ? "food logged in dry-run mode (Fitbit API skipped)" : "food logged successfully (reused)"
      );

      return successResponse(response);
    }

    // New food flow
    let fitbitFoodId: number | undefined;
    let fitbitLogId: number | undefined;
    let reused = false;

    if (!isDryRun) {
      const accessToken = await ensureFreshToken(session!.userId, log);
      const createResult = await findOrCreateFood(accessToken, body, log);
      fitbitFoodId = createResult.foodId;
      reused = createResult.reused;

      const logResult = await logFood(
        accessToken,
        fitbitFoodId,
        body.mealTypeId,
        body.amount,
        body.unit_id,
        date,
        time,
        log,
      );
      fitbitLogId = logResult.foodLog.logId;
    }

    // Log to database — DB is authoritative, failures trigger compensation
    try {
      const customFoodResult = await insertCustomFood(session!.userId, {
        foodName: body.food_name,
        amount: body.amount,
        unitId: body.unit_id,
        calories: body.calories,
        proteinG: body.protein_g,
        carbsG: body.carbs_g,
        fatG: body.fat_g,
        fiberG: body.fiber_g,
        sodiumMg: body.sodium_mg,
        confidence: body.confidence,
        notes: body.notes,
        description: body.description,
        fitbitFoodId: fitbitFoodId ?? null,
        keywords: body.keywords,
      });

      const logEntryResult = await insertFoodLogEntry(session!.userId, {
        customFoodId: customFoodResult.id,
        mealTypeId: body.mealTypeId,
        amount: body.amount,
        unitId: body.unit_id,
        date,
        time,
        fitbitLogId: fitbitLogId ?? null,
      });
      foodLogId = logEntryResult.id;
    } catch (dbErr) {
      log.error(
        { action: "food_log_db_error", error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
        "DB write failed after Fitbit success, attempting compensation"
      );
      if (fitbitLogId && !isDryRun) {
        try {
          const accessToken = await ensureFreshToken(session!.userId, log);
          await deleteFoodLog(accessToken, fitbitLogId, log);
          log.info({ action: "food_log_compensation", fitbitLogId }, "Fitbit log rolled back after DB failure");
        } catch (compensationErr) {
          log.error(
            { action: "food_log_compensation_failed", fitbitLogId, error: compensationErr instanceof Error ? compensationErr.message : String(compensationErr) },
            "CRITICAL: Fitbit log exists but DB write failed and compensation failed"
          );
          return errorResponse("PARTIAL_ERROR", "Food logged to Fitbit but local save failed. Manual cleanup may be needed.", 500);
        }
      }
      return errorResponse("INTERNAL_ERROR", "Failed to save food log", 500);
    }

    const response: FoodLogResponse = {
      success: true,
      fitbitFoodId,
      fitbitLogId,
      reusedFood: reused,
      foodLogId,
      ...(isDryRun && { dryRun: true }),
    };

    log.info(
      {
        action: "log_food_success",
        foodId: fitbitFoodId,
        logId: fitbitLogId,
        reused,
        foodLogId,
        dryRun: isDryRun || undefined,
      },
      isDryRun ? "food logged in dry-run mode (Fitbit API skipped)" : "food logged successfully"
    );

    return successResponse(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage === "FITBIT_CREDENTIALS_MISSING") {
      log.warn(
        { action: "log_food_credentials_missing" },
        "Fitbit credentials not configured"
      );
      return errorResponse(
        "FITBIT_CREDENTIALS_MISSING",
        "Fitbit credentials not configured. Please set up your credentials in Settings.",
        424
      );
    }

    if (errorMessage === "FITBIT_TOKEN_INVALID") {
      log.warn(
        { action: "log_food_token_invalid" },
        "Fitbit token invalid, reconnect required"
      );
      return errorResponse(
        "FITBIT_TOKEN_INVALID",
        "Fitbit session expired. Please reconnect your Fitbit account.",
        401
      );
    }

    if (errorMessage === "FITBIT_TIMEOUT") {
      log.warn({ action: "log_food_timeout" }, "Fitbit request timed out");
      return errorResponse(
        "FITBIT_TIMEOUT",
        "Request to Fitbit timed out. Please try again.",
        504
      );
    }

    if (errorMessage === "FITBIT_RATE_LIMIT") {
      log.warn({ action: "log_food_rate_limited" }, "Fitbit rate limited");
      return errorResponse(
        "FITBIT_API_ERROR",
        "Fitbit API rate limited. Please try again later.",
        500
      );
    }

    log.error(
      { action: "log_food_error", error: errorMessage },
      "Fitbit API error"
    );
    return errorResponse("FITBIT_API_ERROR", "Failed to log food to Fitbit", 500);
  }
}
