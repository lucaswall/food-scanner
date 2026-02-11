import { validateApiRequest } from "@/lib/api-auth";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { ensureFreshToken, getFoodGoals } from "@/lib/fitbit";

export async function GET(request: Request) {
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  try {
    const accessToken = await ensureFreshToken(authResult.userId);
    const goals = await getFoodGoals(accessToken);

    logger.info(
      {
        action: "v1_nutrition_goals_success",
        calorieGoal: goals.calories,
      },
      "v1 nutrition goals retrieved"
    );

    const response = successResponse(goals);
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "v1 nutrition goals fetch failed"
    );

    if (error instanceof Error) {
      if (error.message === "FITBIT_CREDENTIALS_MISSING") {
        return errorResponse("FITBIT_CREDENTIALS_MISSING", "Fitbit credentials not found", 404);
      }
      if (error.message === "FITBIT_TOKEN_INVALID") {
        return errorResponse("FITBIT_TOKEN_INVALID", "Fitbit token is invalid or expired", 401);
      }
      if (error.message === "FITBIT_SCOPE_MISSING") {
        return errorResponse("FITBIT_SCOPE_MISSING", "Fitbit permissions need updating. Please reconnect your Fitbit account in Settings.", 403);
      }
      if (error.message === "FITBIT_API_ERROR") {
        return errorResponse("FITBIT_API_ERROR", "Fitbit API error", 502);
      }
    }

    return errorResponse("INTERNAL_ERROR", "Failed to fetch nutrition goals", 500);
  }
}
