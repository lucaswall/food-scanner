import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { isExpectedHealthError, mapHealthError } from "@/lib/health-error-response";
import { createRequestLogger } from "@/lib/logger";
import {
  getCachedHealthProfile,
  getCachedHealthWeightKg,
  expireHealthProfileCache,
  getHealthProfileSyncedAt,
} from "@/lib/health-cache";
import { getUserGoalSettings } from "@/lib/users";
import { invalidateUserDailyGoalsForDate } from "@/lib/daily-goals";
import { getTodayDate, isValidDateFormat } from "@/lib/date-utils";
import type { HealthProfileData } from "@/types";

/**
 * GET /api/health-profile
 *
 * Returns the user's Google Health profile data:
 * { ageYears, sex, heightCm, weightKg, weightLoggedDate, goalType, lastSyncedAt }
 *
 * goalType comes from users.weightGoalType (local DB, set in Settings), not from
 * the Google Health API — v4 exposes no weight-goal resource.
 *
 * Query params:
 *   refresh=1    force a refetch from Google Health (last-known values are kept as a
 *                serve-stale fallback if the refetch fails)
 *   clientDate   caller's local YYYY-MM-DD; selects the weight lookup date and the
 *                daily-goals row invalidated on refresh. Defaults to the server date.
 *
 * lastSyncedAt is when the underlying Google Health data was fetched (not the request time).
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

  const clientDate = searchParams.get("clientDate");
  if (clientDate !== null && !isValidDateFormat(clientDate)) {
    return errorResponse("VALIDATION_ERROR", "Invalid clientDate format. Use YYYY-MM-DD", 400);
  }
  const todayDate = clientDate ?? getTodayDate();

  const requestStartedAt = Date.now();

  try {
    if (shouldRefresh) {
      // Expire (not wipe) so a failed refetch can still fall back to last-known values.
      expireHealthProfileCache(userId);
    }

    // User-explicit fetch (settings page, refresh button) — mark `important`.
    // sex + goalType (weightGoalType) are LOCAL settings — the Google Health v4
    // profile does not expose sex (FOO-1116), so prefer the local value.
    const [profile, weightLog, goalSettings] = await Promise.all([
      getCachedHealthProfile(userId, log, "important"),
      getCachedHealthWeightKg(userId, todayDate, log, "important"),
      getUserGoalSettings(userId),
    ]);

    const syncedAt = getHealthProfileSyncedAt(userId, todayDate);

    // Only after the refetch actually succeeded (data fetched during this request, not a
    // serve-stale fallback): drop the user's local-day goals row so the next dashboard load
    // recomputes under the refreshed Google Health inputs (weight/sex/height).
    if (shouldRefresh && syncedAt !== null && syncedAt >= requestStartedAt) {
      await invalidateUserDailyGoalsForDate(userId, todayDate);
    }

    const data: HealthProfileData = {
      ageYears: profile.ageYears,
      sex: goalSettings.sex ?? profile.sex,
      heightCm: profile.heightCm,
      weightKg: weightLog?.weightKg ?? null,
      weightLoggedDate: weightLog?.loggedDate ?? null,
      goalType: goalSettings.weightGoalType,
      lastSyncedAt: syncedAt ?? Date.now(),
    };

    log.info(
      { action: "health_profile_success", userId },
      "Google Health profile retrieved",
    );

    const response = successResponse(data);
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    const logFields = {
      action: "health_profile_error",
      error: error instanceof Error ? error.message : String(error),
    };
    if (isExpectedHealthError(error)) {
      log.warn(logFields, "Google Health profile fetch failed (expected condition)");
    } else {
      log.error(logFields, "Google Health profile fetch failed");
    }

    return mapHealthError(error);
  }
}
