import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { ensureFreshToken, findOrCreateFood, logFood } from "@/lib/fitbit";
import { insertCustomFood, insertFoodLogEntry, getCustomFoodById } from "@/lib/food-log";
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

  // mealTypeId is always required
  if (typeof req.mealTypeId !== "number") return false;

  // Reuse flow: only reuseCustomFoodId + mealTypeId needed
  if (req.reuseCustomFoodId !== undefined) {
    return typeof req.reuseCustomFoodId === "number";
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

  return true;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
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

  if (body.date && !isValidDateFormat(body.date)) {
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

  if (body.time && !isValidTimeFormat(body.time)) {
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

  try {
    // Ensure token is fresh (refreshes and saves to DB if needed)
    const accessToken = await ensureFreshToken(session!.email);

    const now = new Date();
    const date = body.date || formatDate(now);
    const time = body.time || formatTime(now);
    let foodId: number;
    let reused: boolean;
    let foodLogId: number | undefined;

    if (body.reuseCustomFoodId) {
      // Reuse flow: skip food creation, use existing custom food
      const existingFood = await getCustomFoodById(body.reuseCustomFoodId);
      if (!existingFood || !existingFood.fitbitFoodId) {
        return errorResponse(
          "VALIDATION_ERROR",
          "Custom food not found or has no Fitbit food ID",
          400
        );
      }

      foodId = existingFood.fitbitFoodId;
      reused = true;

      const logResult = await logFood(
        accessToken,
        foodId,
        body.mealTypeId,
        Number(existingFood.amount),
        existingFood.unitId,
        date,
        time
      );

      // Log entry only (no new custom_food)
      try {
        const logEntryResult = await insertFoodLogEntry(session!.email, {
          customFoodId: existingFood.id,
          mealTypeId: body.mealTypeId,
          amount: Number(existingFood.amount),
          unitId: existingFood.unitId,
          date,
          time,
          fitbitLogId: logResult.foodLog.logId,
        });
        foodLogId = logEntryResult.id;
      } catch (dbError) {
        logger.error(
          { action: "food_log_db_error", error: dbError instanceof Error ? dbError.message : String(dbError) },
          "failed to insert food log entry to database"
        );
      }

      const response: FoodLogResponse = {
        success: true,
        fitbitFoodId: foodId,
        fitbitLogId: logResult.foodLog.logId,
        reusedFood: reused,
        foodLogId,
      };

      logger.info(
        {
          action: "log_food_success",
          foodId,
          logId: logResult.foodLog.logId,
          reused,
          foodLogId,
        },
        "food logged successfully (reused)"
      );

      return successResponse(response);
    }

    // New food flow
    const createResult = await findOrCreateFood(accessToken, body);
    foodId = createResult.foodId;
    reused = createResult.reused;

    // Log the food
    const logResult = await logFood(
      accessToken,
      foodId,
      body.mealTypeId,
      body.amount,
      body.unit_id,
      date,
      time
    );

    // Log to database (non-fatal — Fitbit is the primary operation)
    try {
      const customFoodResult = await insertCustomFood(session!.email, {
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
        fitbitFoodId: foodId,
        keywords: body.keywords,
      });

      const logEntryResult = await insertFoodLogEntry(session!.email, {
        customFoodId: customFoodResult.id,
        mealTypeId: body.mealTypeId,
        amount: body.amount,
        unitId: body.unit_id,
        date,
        time,
        fitbitLogId: logResult.foodLog.logId,
      });
      foodLogId = logEntryResult.id;
    } catch (dbError) {
      logger.error(
        { action: "food_log_db_error", error: dbError instanceof Error ? dbError.message : String(dbError) },
        "failed to insert food log to database"
      );
    }

    const response: FoodLogResponse = {
      success: true,
      fitbitFoodId: foodId,
      fitbitLogId: logResult.foodLog.logId,
      reusedFood: reused,
      foodLogId,
    };

    logger.info(
      {
        action: "log_food_success",
        foodId,
        logId: logResult.foodLog.logId,
        reused,
        foodLogId,
      },
      "food logged successfully"
    );

    return successResponse(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

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
