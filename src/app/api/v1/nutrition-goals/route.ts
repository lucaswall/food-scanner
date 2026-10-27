import { validateApiRequest, hashForRateLimit } from "@/lib/api-auth";
import { conditionalResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import {
  getOrComputeDailyGoals,
  mapComputeResultToNutritionGoals,
} from "@/lib/daily-goals";
import { getDailyGoalsByDateRange } from "@/lib/nutrition-goals";
import { getUserGoalSettings } from "@/lib/users";
import { checkRateLimit } from "@/lib/rate-limit";
import { getTodayDate, isValidDateFormat } from "@/lib/date-utils";
import { isExpectedHealthError, mapHealthError } from "@/lib/health-error-response";
import type { NutritionGoals } from "@/types";

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_RANGE_DAYS = 90;

// FOO-1063: range mode distinguishes "row not yet computed for a configured
// user" (`not_computed`) from "user has not set up goals" (`goals_not_set`).
// Locally extends the public `NutritionGoals.reason` union without polluting
// the shared type — `not_computed` is meaningful only in range mode.
type RangeReason = NonNullable<NutritionGoals["reason"]> | "not_computed";

// Range-mode entry shape — pinned to the public `NutritionGoals` contract for
// the data fields, with the locally-extended reason union for range gaps.
type RangeEntry = Pick<
  NutritionGoals,
  "calories" | "proteinG" | "carbsG" | "fatG" | "status"
> & { date: string; reason?: RangeReason };

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
  // Caller's local "today" (same convention as /api/v1/fasting `clientDate`). Used as the
  // default for single-date mode and to decide which dates are stable past rows.
  const clientDateParam = searchParams.get("clientDate");

  for (const [name, value] of [
    ["date", dateParam],
    ["from", fromParam],
    ["to", toParam],
    ["clientDate", clientDateParam],
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

      const [rows, userSettings] = await Promise.all([
        getDailyGoalsByDateRange(authResult.userId, fromParam, toParam),
        getUserGoalSettings(authResult.userId),
      ]);

      // FOO-1063: distinguish "user has no goal settings" from "row not yet
      // computed". Without this, configured users hitting the range endpoint
      // before single-date computes have populated rows are told their goals
      // aren't set up — wrong remediation.
      const settingsConfigured =
        userSettings.activityLevel !== null &&
        userSettings.goalWeightKg !== null &&
        userSettings.goalRateKgPerWeek !== null;
      const gapReason: RangeReason = settingsConfigured ? "not_computed" : "goals_not_set";

      // FOO-1033 (PR review): gap-fill any date in [from, to] that has no DB
      // row with a blocked entry so the response covers the full requested
      // span. Without this, clients silently see missing days as dropped data
      // and timelines misalign.
      const rowByDate = new Map(rows.map((row) => [row.date, row]));
      const entries: RangeEntry[] = [];
      const startMs = Date.parse(fromParam);
      const endMs = Date.parse(toParam);
      for (let ms = startMs; ms <= endMs; ms += 86_400_000) {
        const date = new Date(ms).toISOString().slice(0, 10);
        const row = rowByDate.get(date);
        if (!row) {
          entries.push({
            date,
            calories: null,
            proteinG: null,
            carbsG: null,
            fatG: null,
            status: "blocked",
            reason: gapReason,
          });
          continue;
        }
        // getDailyGoalsByDateRange only returns engine-written rows (invalidated
        // rows are excluded), so every row here is a real goal.
        entries.push({
          date,
          calories: row.calorieGoal,
          proteinG: row.proteinGoal,
          carbsG: row.carbsGoal,
          fatG: row.fatGoal,
          status: "ok",
        });
      }

      log.debug(
        { action: "v1_nutrition_goals_range", userId: authResult.userId, count: entries.length },
        "v1 nutrition goals range retrieved",
      );

      return conditionalResponse(request, { entries });
    }

    // Single-date mode — engine-computed.
    const date = dateParam ?? clientDateParam ?? getTodayDate();
    const result = await getOrComputeDailyGoals(
      authResult.userId,
      date,
      log,
      clientDateParam ?? undefined,
    );

    // FOO-1031 (PR review): getOrComputeDailyGoals catches HEALTH_SCOPE_MISSING
    // and returns a resolved blocked/scope_mismatch result rather than throwing.
    // The external API contract requires 403 here so clients can trigger their
    // re-auth flow — `mapHealthError` would never run otherwise.
    if (result.status === "blocked" && result.reason === "scope_mismatch") {
      return errorResponse(
        "HEALTH_SCOPE_MISSING",
        "Google Health permissions need updating. Please reconnect Google Health in Settings.",
        403,
      );
    }

    const goals = mapComputeResultToNutritionGoals(result);

    log.debug(
      { action: "v1_nutrition_goals_success", userId: authResult.userId, status: result.status },
      "v1 nutrition goals retrieved",
    );

    return conditionalResponse(request, { date, ...goals });
  } catch (error) {
    const logFields = {
      action: "v1_nutrition_goals_error",
      error: error instanceof Error ? error.message : String(error),
    };
    if (isExpectedHealthError(error)) {
      log.warn(logFields, "v1 nutrition goals fetch failed (expected Google Health condition)");
    } else {
      log.error(logFields, "v1 nutrition goals fetch failed");
    }
    return mapHealthError(error);
  }
}
