import { validateApiRequest } from "@/lib/api-auth";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getDailyNutritionSummary } from "@/lib/food-log";
import { isValidDateFormat } from "@/lib/date-utils";

export async function GET(request: Request) {
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return errorResponse("VALIDATION_ERROR", "Missing date parameter", 400);
  }

  if (!isValidDateFormat(date)) {
    logger.warn({ action: "v1_food_log_validation" }, "invalid date format");
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid date format. Use YYYY-MM-DD",
      400
    );
  }

  try {
    const summary = await getDailyNutritionSummary(authResult.userId, date);

    logger.info(
      {
        action: "v1_food_log_success",
        date,
        totalEntries: summary.meals.reduce((sum, meal) => sum + meal.entries.length, 0),
        mealCount: summary.meals.length,
      },
      "v1 food log retrieved"
    );

    const response = successResponse(summary);
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "v1 food log failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve food log", 500);
  }
}
