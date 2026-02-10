import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { ensureFreshToken, findOrCreateFood, logFood, deleteFoodLog } from "@/lib/fitbit";
import { insertCustomFood, insertFoodLogEntry, getCustomFoodById, updateCustomFoodMetadata } from "@/lib/food-log";
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
    if (typeof req.reuseCustomFoodId !== "number") return false;
    // Validate optional metadata update fields
    if (req.newDescription !== undefined && typeof req.newDescription !== "string") return false;
    if (req.newNotes !== undefined && typeof req.newNotes !== "string") return false;
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
    typeof req.description !== "string" ||
    (req.confidence !== "high" &&
      req.confidence !== "medium" &&
      req.confidence !== "low")
  ) {
    return false;
  }

  // Validate keywords if present: must be an array of strings
  if (req.keywords !== undefined) {
    if (!Array.isArray(req.keywords) || !req.keywords.every((k: unknown) => typeof k === "string")) {
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

function isValidDateFormat(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function isValidTimeFormat(time: string): boolean {
  if (!/^\d{2}:\d{2}:\d{2}$/.test(time)) return false;
  const [hours, minutes, seconds] = time.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
}

export async function POST(request: Request) {
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
    logger.warn({ action: "log_food_validation" }, "invalid request body");
    return errorResponse(
      "VALIDATION_ERROR",
      "Missing or invalid required fields",
      400
    );
  }

  if (!VALID_MEAL_TYPE_IDS.includes(body.mealTypeId)) {
    logger.warn(
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
    logger.warn(
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
    logger.warn(
      { action: "log_food_validation" },
      "invalid time format"
    );
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid time format. Use HH:mm:ss",
      400
    );
  }

  logger.info(
    {
      action: "log_food_request",
      foodName: body.food_name,
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
        const accessToken = await ensureFreshToken(session!.userId);
        const logResult = await logFood(
          accessToken,
          existingFood.fitbitFoodId!,
          body.mealTypeId,
          Number(existingFood.amount),
          existingFood.unitId,
          date,
          time
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
            logger.error(
              { action: "update_custom_food_metadata_failed", error: err instanceof Error ? err.message : String(err) },
              "Failed to update custom food metadata (non-blocking)"
            );
          });
        }
      } catch (dbErr) {
        logger.error(
          { action: "food_log_db_error", error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
          "DB write failed after Fitbit success, attempting compensation"
        );
        if (fitbitLogId && !isDryRun) {
          try {
            const accessToken = await ensureFreshToken(session!.userId);
            await deleteFoodLog(accessToken, fitbitLogId);
            logger.info({ action: "food_log_compensation", fitbitLogId }, "Fitbit log rolled back after DB failure");
          } catch (compensationErr) {
            logger.error(
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

      logger.info(
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
      const accessToken = await ensureFreshToken(session!.userId);
      const createResult = await findOrCreateFood(accessToken, body);
      fitbitFoodId = createResult.foodId;
      reused = createResult.reused;

      const logResult = await logFood(
        accessToken,
        fitbitFoodId,
        body.mealTypeId,
        body.amount,
        body.unit_id,
        date,
        time
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
      logger.error(
        { action: "food_log_db_error", error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
        "DB write failed after Fitbit success, attempting compensation"
      );
      if (fitbitLogId && !isDryRun) {
        try {
          const accessToken = await ensureFreshToken(session!.userId);
          await deleteFoodLog(accessToken, fitbitLogId);
          logger.info({ action: "food_log_compensation", fitbitLogId }, "Fitbit log rolled back after DB failure");
        } catch (compensationErr) {
          logger.error(
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

    logger.info(
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
      logger.warn(
        { action: "log_food_credentials_missing" },
        "Fitbit credentials not configured"
      );
      return errorResponse(
        "FITBIT_CREDENTIALS_MISSING",
        "Fitbit credentials not configured. Please set up your credentials in Settings.",
        400
      );
    }

    if (errorMessage === "FITBIT_TOKEN_INVALID") {
      logger.warn(
        { action: "log_food_token_invalid" },
        "Fitbit token invalid, reconnect required"
      );
      return errorResponse(
        "FITBIT_TOKEN_INVALID",
        "Fitbit session expired. Please reconnect your Fitbit account.",
        401
      );
    }

    if (errorMessage === "FITBIT_RATE_LIMIT") {
      logger.warn({ action: "log_food_rate_limited" }, "Fitbit rate limited");
      return errorResponse(
        "FITBIT_API_ERROR",
        "Fitbit API rate limited. Please try again later.",
        500
      );
    }

    logger.error(
      { action: "log_food_error", error: errorMessage },
      "Fitbit API error"
    );
    return errorResponse("FITBIT_API_ERROR", "Failed to log food to Fitbit", 500);
  }
}
