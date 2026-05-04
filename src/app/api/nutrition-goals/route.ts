import { getSession, validateSession } from "@/lib/session";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import {
  getOrComputeDailyGoals,
  mapComputeResultToNutritionGoals,
} from "@/lib/daily-goals";
import { getTodayDate, isValidDateFormat } from "@/lib/date-utils";

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/nutrition-goals");
  const session = await getSession();

  const validationError = validateSession(session, { requireFitbit: true });
  if (validationError) return validationError;

  const { searchParams } = new URL(request.url);
  const clientDate = searchParams.get("clientDate");

  if (clientDate && !isValidDateFormat(clientDate)) {
    return errorResponse("VALIDATION_ERROR", "Invalid clientDate format. Use YYYY-MM-DD", 400);
  }

  try {
    const date = clientDate ?? getTodayDate();
    const result = await getOrComputeDailyGoals(session!.userId, date, log);
    const goals = mapComputeResultToNutritionGoals(result);

    log.info(
      { action: "nutrition_goals_success", status: result.status },
      "nutrition goals retrieved"
    );

    return conditionalResponse(request, goals);
  } catch (error) {
    log.error(
      { action: "nutrition_goals_error", error: error instanceof Error ? error.message : String(error) },
      "nutrition goals fetch failed"
    );

    if (error instanceof Error) {
      if (error.message === "FITBIT_CREDENTIALS_MISSING") {
        return errorResponse("FITBIT_CREDENTIALS_MISSING", "Fitbit credentials not found", 424);
      }
      if (error.message === "FITBIT_TOKEN_INVALID") {
        return errorResponse("FITBIT_TOKEN_INVALID", "Fitbit token is invalid or expired", 401);
      }
      if (error.message === "FITBIT_RATE_LIMIT") {
        return errorResponse("FITBIT_RATE_LIMIT", "Fitbit API rate limited. Please try again later.", 429);
      }
      if (error.message === "FITBIT_RATE_LIMIT_LOW") {
        return errorResponse(
          "FITBIT_RATE_LIMIT_LOW",
          "Fitbit rate-limit headroom is low. Please try again in a few minutes.",
          503,
        );
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
