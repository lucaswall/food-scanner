import { getSession, validateSession } from "@/lib/session";
import { successResponse } from "@/lib/api-response";
import { mapHealthError } from "@/lib/health-error-response";
import { createRequestLogger } from "@/lib/logger";
import {
  getCachedHealthProfile,
  getCachedHealthWeightKg,
  invalidateHealthProfileCache,
} from "@/lib/health-cache";
import { getUserGoalSettings } from "@/lib/users";
import { invalidateUserDailyGoalsForDate } from "@/lib/daily-goals";
import { getTodayDate } from "@/lib/date-utils";
import type { HealthProfileData } from "@/types";

/**
 * GET /api/health-profile
 *
 * Returns the user's Google Health profile data:
 * { ageYears, sex, heightCm, weightKg, weightLoggedDate, goalType, lastSyncedAt }
 *
 * goalType comes from users.weightGoalType (local DB, set in Settings) —
 * not from a Fitbit/Health API call (weight-goal API was dropped in Task 9).
 *
 * Does NOT shadow /api/health (the public health-check endpoint).
 */
export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/health-profile");
  const session = await getSession();

  const validationError = validateSession(session, { requireHealth: true });
  if (validationError) return validationError;

  const { searchParams } = new URL(request.url);
  const shouldRefresh = searchParams.get("refresh") === "1";
  const userId = session!.userId;

  if (shouldRefresh) {
    invalidateHealthProfileCache(userId);
    // Also invalidate today's daily-goals row so the next dashboard load
    // recomputes under the refreshed Google Health inputs (weight/sex/height).
    await invalidateUserDailyGoalsForDate(userId, getTodayDate());
  }

  try {
    const todayDate = getTodayDate();

    // User-explicit fetch (settings page, refresh button) — mark `important`.
    // sex + goalType (weightGoalType) are LOCAL settings — the Google Health v4
    // profile does not expose sex (FOO-1116), so prefer the local value.
    const [profile, weightLog, goalSettings] = await Promise.all([
      getCachedHealthProfile(userId, log, "important"),
      getCachedHealthWeightKg(userId, todayDate, log, "important"),
      getUserGoalSettings(userId),
    ]);

    const data: HealthProfileData = {
      ageYears: profile.ageYears,
      sex: goalSettings.sex ?? profile.sex,
      heightCm: profile.heightCm,
      weightKg: weightLog?.weightKg ?? null,
      weightLoggedDate: weightLog?.loggedDate ?? null,
      goalType: goalSettings.weightGoalType,
      lastSyncedAt: Date.now(),
    };

    log.info(
      { action: "health_profile_success", userId },
      "Google Health profile retrieved",
    );

    const response = successResponse(data);
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    log.error(
      { action: "health_profile_error", error: error instanceof Error ? error.message : String(error) },
      "Google Health profile fetch failed",
    );

    return mapHealthError(error);
  }
}
