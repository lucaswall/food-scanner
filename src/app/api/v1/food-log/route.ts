import { validateApiRequest } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { getDailyNutritionSummary } from "@/lib/food-log";
import { isValidDateFormat } from "@/lib/date-utils";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_LIMIT_MAX = 60; // DB-only route
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/food-log");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  // Extract API key from Authorization header for rate limiting
  const authHeader = request.headers.get("Authorization");
  const apiKey = authHeader?.replace(/^Bearer\s+/i, "") || "";

  const { allowed } = checkRateLimit(
    `v1:food-log:${apiKey}`,
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
    log.warn({ action: "v1_food_log_validation" }, "invalid date format");
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
        action: "v1_food_log_success",
        date,
        totalEntries: summary.meals.reduce((sum, meal) => sum + meal.entries.length, 0),
        mealCount: summary.meals.length,
      },
      "v1 food log retrieved"
    );

    return conditionalResponse(request, summary);
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error) },
      "v1 food log failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve food log", 500);
  }
}
