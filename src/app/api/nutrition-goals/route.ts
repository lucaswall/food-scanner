import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { ensureFreshToken, getFoodGoals } from "@/lib/fitbit";
import { upsertCalorieGoal } from "@/lib/nutrition-goals";
import { getTodayDate } from "@/lib/date-utils";

export async function GET(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: true });
  if (validationError) return validationError;

  // Extract client-provided date if available
  const { searchParams } = new URL(request.url);
  const clientDate = searchParams.get("clientDate");

  try {
    const accessToken = await ensureFreshToken(session!.userId);
    const goals = await getFoodGoals(accessToken);

    // Capture calorie goal in database (fire-and-forget)
    // Use client's local date if provided, otherwise fall back to server UTC
    if (goals.calories !== null && goals.calories !== undefined) {
      const todayDate = clientDate || getTodayDate();
      upsertCalorieGoal(session!.userId, todayDate, goals.calories).catch((error) => {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error), userId: session!.userId },
          "failed to capture calorie goal"
        );
      });
    }

    logger.info(
      {
        action: "nutrition_goals_success",
        calorieGoal: goals.calories ?? "not_set",
      },
      "nutrition goals retrieved"
    );

    const response = successResponse(goals);
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "nutrition goals fetch failed"
    );

    if (error instanceof Error) {
      if (error.message === "FITBIT_CREDENTIALS_MISSING") {
        return errorResponse("FITBIT_CREDENTIALS_MISSING", "Fitbit credentials not found", 424);
      }
      if (error.message === "FITBIT_TOKEN_INVALID") {
        return errorResponse("FITBIT_TOKEN_INVALID", "Fitbit token is invalid or expired", 401);
      }
      if (error.message === "FITBIT_SCOPE_MISSING") {
        return errorResponse("FITBIT_SCOPE_MISSING", "Fitbit permissions need updating. Please reconnect your Fitbit account in Settings.", 403);
      }
      if (error.message === "FITBIT_RATE_LIMIT") {
        return errorResponse("FITBIT_RATE_LIMIT", "Fitbit API rate limited. Please try again later.", 429);
      }
      if (error.message === "FITBIT_TIMEOUT") {
        return errorResponse("FITBIT_TIMEOUT", "Request to Fitbit timed out. Please try again.", 504);
      }
      if (error.message === "FITBIT_REFRESH_TRANSIENT") {
        return errorResponse("FITBIT_REFRESH_TRANSIENT", "Temporary Fitbit error. Please try again.", 502);
      }
      if (error.message === "FITBIT_TOKEN_SAVE_FAILED") {
        return errorResponse("FITBIT_TOKEN_SAVE_FAILED", "Failed to save Fitbit tokens. Please try again.", 500);
      }
      if (error.message === "FITBIT_API_ERROR") {
        return errorResponse("FITBIT_API_ERROR", "Fitbit API error", 502);
      }
    }

    return errorResponse("INTERNAL_ERROR", "Failed to fetch nutrition goals", 500);
  }
}
