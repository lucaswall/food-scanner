import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getDailyNutritionSummary } from "@/lib/food-log";
import { isValidDateFormat } from "@/lib/date-utils";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 60; // DB-only route
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/nutrition-summary");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  // Extract API key from Authorization header for rate limiting
  const authHeader = request.headers.get("Authorization");
  const apiKey = authHeader?.replace(/^Bearer\s+/i, "") || "";

  const { allowed } = checkRateLimit(
    `v1:nutrition-summary:${hashForRateLimit(apiKey)}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS
  );
  if (!allowed) {
    return errorResponse(
      "RATE_LIMIT_EXCEEDED",
      "Too many requests. Please try again later.",
      429
    );
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  if (!date) {
    return errorResponse("VALIDATION_ERROR", "Missing date parameter", 400);
  }

  if (!isValidDateFormat(date)) {
    log.warn({ action: "v1_nutrition_summary_validation" }, "invalid date format");
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid date format. Use YYYY-MM-DD",
      400
    );
  }

  try {
    const summary = await getDailyNutritionSummary(authResult.userId, date, log);

    log.debug(
      {
        action: "v1_nutrition_summary_success",
        date,
        totalCalories: summary.totals.calories,
        mealCount: summary.meals.length,
      },
      "v1 nutrition summary retrieved"
    );

    return conditionalResponse(request, summary);
  } catch (error) {
    log.error(
      { action: "v1_nutrition_summary_error", error: error instanceof Error ? error.message : String(error) },
      "v1 nutrition summary failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve nutrition summary", 500);
  }
}
