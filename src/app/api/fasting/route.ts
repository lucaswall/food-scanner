import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { logger } from "@/lib/logger";
import { getFastingWindow, getFastingWindows } from "@/lib/fasting";
import { isToday, addDays } from "@/lib/date-utils";
import type { FastingResponse } from "@/types";

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

  // Single date mode
  if (!from && !to) {
    if (!date) {
      return errorResponse("VALIDATION_ERROR", "Missing date parameter", 400);
    }

    if (!isValidDateFormat(date)) {
      logger.warn({ action: "fasting_validation" }, "invalid date format");
      return errorResponse(
        "VALIDATION_ERROR",
        "Invalid date format. Use YYYY-MM-DD",
        400
      );
    }

    try {
      const window = await getFastingWindow(session!.userId, date);

      // Determine if live mode (date is today AND window has null firstMealTime)
      let live: { lastMealTime: string; startDate: string } | null = null;
      if (window && isToday(date) && window.firstMealTime === null) {
        live = {
          lastMealTime: window.lastMealTime,
          startDate: addDays(date, -1), // lastMealTime comes from previous day
        };
      }

      const response: FastingResponse = {
        window,
        live,
      };

      logger.info(
        {
          action: "fasting_window_success",
          date,
          hasFast: !!window,
          isLive: !!live,
        },
        "fasting window retrieved"
      );

      const res = successResponse(response);
      res.headers.set("Cache-Control", "private, no-cache");
      return res;
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        "fasting window failed"
      );
      return errorResponse("INTERNAL_ERROR", "Failed to retrieve fasting window", 500);
    }
  }

  // Date range mode
  if (!from || !to) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Both from and to parameters are required for date range queries",
      400
    );
  }

  if (!isValidDateFormat(from)) {
    logger.warn({ action: "fasting_validation" }, "invalid from date format");
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid from date format. Use YYYY-MM-DD",
      400
    );
  }

  if (!isValidDateFormat(to)) {
    logger.warn({ action: "fasting_validation" }, "invalid to date format");
    return errorResponse(
      "VALIDATION_ERROR",
      "Invalid to date format. Use YYYY-MM-DD",
      400
    );
  }

  if (from > to) {
    return errorResponse(
      "VALIDATION_ERROR",
      "from date must be before or equal to to date",
      400
    );
  }

  try {
    const windows = await getFastingWindows(session!.userId, from, to);

    logger.info(
      {
        action: "fasting_windows_success",
        from,
        to,
        count: windows.length,
      },
      "fasting windows retrieved"
    );

    const res = successResponse({ windows });
    res.headers.set("Cache-Control", "private, no-cache");
    return res;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      "fasting windows failed"
    );
    return errorResponse("INTERNAL_ERROR", "Failed to retrieve fasting windows", 500);
  }
}
