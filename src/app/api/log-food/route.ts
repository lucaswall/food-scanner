import { getSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { ensureFreshToken, findOrCreateFood, logFood } from "@/lib/fitbit";
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

  return (
    typeof req.food_name === "string" &&
    req.food_name.length > 0 &&
    typeof req.amount === "number" &&
    req.amount > 0 &&
    typeof req.unit_id === "number" &&
    typeof req.calories === "number" &&
    req.calories >= 0 &&
    typeof req.protein_g === "number" &&
    req.protein_g >= 0 &&
    typeof req.carbs_g === "number" &&
    req.carbs_g >= 0 &&
    typeof req.fat_g === "number" &&
    req.fat_g >= 0 &&
    typeof req.fiber_g === "number" &&
    req.fiber_g >= 0 &&
    typeof req.sodium_mg === "number" &&
    req.sodium_mg >= 0 &&
    typeof req.mealTypeId === "number" &&
    typeof req.notes === "string" &&
    (req.confidence === "high" ||
      req.confidence === "medium" ||
      req.confidence === "low")
  );
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDateFormat(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

function isValidTimeFormat(time: string): boolean {
  return /^\d{2}:\d{2}:\d{2}$/.test(time);
}

export async function POST(request: Request) {
  const session = await getSession();

  if (!session.sessionId) {
    logger.warn({ action: "log_food_unauthorized" }, "no active session");
    return errorResponse("AUTH_MISSING_SESSION", "No active session", 401);
  }

  if (!session.expiresAt || session.expiresAt < Date.now()) {
    logger.warn({ action: "log_food_unauthorized" }, "session expired");
    return errorResponse("AUTH_SESSION_EXPIRED", "Session has expired", 401);
  }

  if (!session.fitbit) {
    logger.warn({ action: "log_food_no_fitbit" }, "Fitbit not connected");
    return errorResponse(
      "FITBIT_NOT_CONNECTED",
      "Fitbit account not connected",
      400
    );
  }

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
    // Ensure token is fresh (may update session.fitbit)
    const accessToken = await ensureFreshToken(session);

    // Save session after token refresh (persists any updated tokens)
    await session.save();

    // Find or create the food
    const { foodId, reused } = await findOrCreateFood(accessToken, body);

    // Log the food
    const date = body.date || formatDate(new Date());
    const logResult = await logFood(
      accessToken,
      foodId,
      body.mealTypeId,
      body.amount,
      body.unit_id,
      date,
      body.time
    );

    const response: FoodLogResponse = {
      success: true,
      fitbitFoodId: foodId,
      fitbitLogId: logResult.foodLog.logId,
      reusedFood: reused,
    };

    logger.info(
      {
        action: "log_food_success",
        foodId,
        logId: logResult.foodLog.logId,
        reused,
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
