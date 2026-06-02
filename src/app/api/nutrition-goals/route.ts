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

  const validationError = validateSession(session, { requireHealth: true });
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

    log.debug(
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
      if (error.message === "HEALTH_TOKEN_INVALID") {
        return errorResponse("HEALTH_TOKEN_INVALID", "Google Health token is invalid or expired", 401);
      }
      // Note: HEALTH_SCOPE_MISSING is not handled here — getOrComputeDailyGoals
      // catches it upstream and returns a resolved blocked/scope_mismatch result
      // (HTTP 200), which TargetsCard renders. It never propagates to this catch.
      if (error.message === "HEALTH_RATE_LIMIT") {
        return errorResponse("HEALTH_RATE_LIMIT", "Google Health API rate limited. Please try again later.", 429);
      }
      if (error.message === "HEALTH_RATE_LIMIT_LOW") {
        return errorResponse(
          "HEALTH_RATE_LIMIT_LOW",
          "Google Health rate-limit headroom is low. Please try again in a few minutes.",
          503,
        );
      }
      if (error.message === "HEALTH_TIMEOUT") {
        return errorResponse("HEALTH_TIMEOUT", "Request to Google Health timed out. Please try again.", 504);
      }
      if (error.message === "HEALTH_REFRESH_TRANSIENT") {
        return errorResponse("HEALTH_REFRESH_TRANSIENT", "Temporary Google Health error. Please try again.", 502);
      }
      if (error.message === "HEALTH_TOKEN_SAVE_FAILED") {
        return errorResponse("HEALTH_TOKEN_SAVE_FAILED", "Failed to save Google Health tokens. Please try again.", 500);
      }
      if (error.message === "HEALTH_API_ERROR") {
        return errorResponse("HEALTH_API_ERROR", "Google Health API error", 502);
      }
    }

    return errorResponse("INTERNAL_ERROR", "Failed to fetch nutrition goals", 500);
  }
}
