import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getDailyNutritionSummary, getDateRangeNutritionSummary } from "@/lib/food-log";

function isValidDateFormat(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

export async function GET(request: Request) {
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // date parameter takes precedence over from/to
  if (date) {
    if (!isValidDateFormat(date)) {
      logger.warn({ action: "nutrition_summary_validation" }, "invalid date format");
      return errorResponse(
        "VALIDATION_ERROR",
        "Invalid date format. Use YYYY-MM-DD",
        400
      );
    }

    try {
      const summary = await getDailyNutritionSummary(session!.userId, date);

      logger.info(
        {
          action: "nutrition_summary_success",
          date,
          totalCalories: summary.totals.calories,
          mealCount: summary.meals.length,
        },
        "nutrition summary retrieved"
      );

      const response = successResponse(summary);
      response.headers.set("Cache-Control", "private, no-cache");
      return response;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "nutrition summary failed"
      );
      return errorResponse("INTERNAL_ERROR", "Failed to retrieve nutrition summary", 500);
    }
  }

  // Handle date range query
  if (from || to) {
    // Both from and to are required
    if (!from || !to) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Both from and to parameters are required for date range queries",
        400
      );
    }

    // Validate date formats
    if (!isValidDateFormat(from)) {
      logger.warn({ action: "nutrition_summary_validation" }, "invalid from date format");
      return errorResponse(
        "VALIDATION_ERROR",
        "Invalid date format for from parameter. Use YYYY-MM-DD",
        400
      );
    }

    if (!isValidDateFormat(to)) {
      logger.warn({ action: "nutrition_summary_validation" }, "invalid to date format");
      return errorResponse(
        "VALIDATION_ERROR",
        "Invalid date format for to parameter. Use YYYY-MM-DD",
        400
      );
    }

    // Validate from <= to
    if (from > to) {
      return errorResponse(
        "VALIDATION_ERROR",
        "from date must be before or equal to to date",
        400
      );
    }

    try {
      const days = await getDateRangeNutritionSummary(session!.userId, from, to);

      logger.info(
        {
          action: "nutrition_summary_range_success",
          from,
          to,
          dayCount: days.length,
        },
        "nutrition summary range retrieved"
      );

      const response = successResponse({ days });
      response.headers.set("Cache-Control", "private, no-cache");
      return response;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "nutrition summary range failed"
      );
      return errorResponse("INTERNAL_ERROR", "Failed to retrieve nutrition summary", 500);
    }
  }

  // Neither date nor from/to provided
  return errorResponse("VALIDATION_ERROR", "Missing date parameter or from/to date range", 400);
}
