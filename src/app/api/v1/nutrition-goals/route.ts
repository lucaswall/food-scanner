import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import {
  getOrComputeDailyGoals,
  loadUserMacroProfileKey,
  mapComputeResultToNutritionGoals,
} from "@/lib/daily-goals";
import { getDailyGoalsByDateRange } from "@/lib/nutrition-goals";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTodayDate, isValidDateFormat } from "@/lib/date-utils";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_RANGE_DAYS = 90;

function mapFitbitError(error: unknown): Response | null {
  if (!(error instanceof Error)) return null;
  if (error.message === "FITBIT_CREDENTIALS_MISSING") {
    return errorResponse("FITBIT_CREDENTIALS_MISSING", "Fitbit credentials not found", 424);
  }
  if (error.message === "FITBIT_TOKEN_INVALID") {
    return errorResponse("FITBIT_TOKEN_INVALID", "Fitbit token is invalid or expired", 401);
  }
  if (error.message === "FITBIT_SCOPE_MISSING") {
    return errorResponse(
      "FITBIT_SCOPE_MISSING",
      "Fitbit permissions need updating. Please reconnect your Fitbit account in Settings.",
      403,
    );
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
  if (error.message === "FITBIT_API_ERROR") {
    return errorResponse("FITBIT_API_ERROR", "Fitbit API error", 502);
  }
  return null;
}

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/v1/nutrition-goals");
  const authResult = await validateApiRequest(request);
  if (authResult instanceof Response) return authResult;

  const authHeader = request.headers.get("Authorization");
  const apiKey = authHeader?.replace(/^Bearer\s+/i, "") || "";

  const { allowed } = checkRateLimit(
    `v1:nutrition-goals:${hashForRateLimit(apiKey)}`,
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (!allowed) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests. Please try again later.", 429);
  }

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  for (const [name, value] of [
    ["date", dateParam],
    ["from", fromParam],
    ["to", toParam],
  ] as const) {
    if (value !== null && !isValidDateFormat(value)) {
      return errorResponse("VALIDATION_ERROR", `Invalid ${name} format. Use YYYY-MM-DD`, 400);
    }
  }

  // Range mode requires both `from` and `to`. Reject partial range params so
  // a caller's intent is unambiguous (and the response shape is predictable).
  if ((fromParam !== null) !== (toParam !== null)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "Range mode requires both `from` and `to`",
      400,
    );
  }

  try {
    // Range mode — read-only, no engine backfill.
    if (fromParam !== null && toParam !== null) {
      if (toParam < fromParam) {
        return errorResponse("VALIDATION_ERROR", "to must be >= from", 400);
      }
      const spanDays = Math.floor(
        (Date.parse(toParam) - Date.parse(fromParam)) / 86_400_000,
      );
      if (spanDays > MAX_RANGE_DAYS) {
        return errorResponse(
          "VALIDATION_ERROR",
          `Range exceeds ${MAX_RANGE_DAYS} days`,
          400,
        );
      }

      const [rows, profileKey] = await Promise.all([
        getDailyGoalsByDateRange(authResult.userId, fromParam, toParam),
        loadUserMacroProfileKey(authResult.userId),
      ]);

      const entries = rows.map((row) => {
        const computed = row.calorieGoal !== null && row.calorieGoal > 0 && row.proteinGoal !== null;
        return {
          date: row.date,
          calories: row.calorieGoal && row.calorieGoal > 0 ? row.calorieGoal : null,
          proteinG: row.proteinGoal,
          carbsG: row.carbsGoal,
          fatG: row.fatGoal,
          status: computed ? "ok" : "blocked",
          ...(computed ? {} : { reason: "not_computed" as const }),
        };
      });

      log.debug(
        { action: "v1_nutrition_goals_range", userId: authResult.userId, count: entries.length },
        "v1 nutrition goals range retrieved",
      );

      return conditionalResponse(request, { entries, profileKey });
    }

    // Single-date mode — engine-computed.
    const date = dateParam ?? getTodayDate();
    const [result, profileKey] = await Promise.all([
      getOrComputeDailyGoals(authResult.userId, date, log),
      loadUserMacroProfileKey(authResult.userId),
    ]);
    const goals = mapComputeResultToNutritionGoals(result);

    log.debug(
      { action: "v1_nutrition_goals_success", userId: authResult.userId, status: result.status },
      "v1 nutrition goals retrieved",
    );

    return conditionalResponse(request, { date, profileKey, ...goals });
  } catch (error) {
    log.error(
      { action: "v1_nutrition_goals_error", error: error instanceof Error ? error.message : String(error) },
      "v1 nutrition goals fetch failed",
    );
    const mapped = mapFitbitError(error);
    if (mapped) return mapped;
    return errorResponse("INTERNAL_ERROR", "Failed to fetch nutrition goals", 500);
  }
}
