import { getDb } from "@/db/index";
import { dailyCalorieGoals, users } from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";
import {
  computeMacroTargets,
  computeRmr,
  getMacroProfile,
  isMacroProfileKey,
  type MacroProfile,
  type MacroProfileKey,
} from "@/lib/macro-engine";
import {
  getCachedFitbitProfile,
  getCachedFitbitWeightKg,
  getCachedFitbitWeightGoal,
  getCachedActivitySummary,
} from "@/lib/fitbit-cache";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import type { BmiTier, MacroGoalType, NutritionGoals } from "@/types";

interface DbRow {
  calorieGoal: number;
  proteinGoal: number | null;
  carbsGoal: number | null;
  fatGoal: number | null;
  weightKg: string | null;
  caloriesOut: number | null;
  rmr: number | null;
  activityKcal: number | null;
  goalType: string | null;
  bmiTier: string | null;
  profileVersion: number | null;
  weightLoggedDate: string | null;
}

export type ComputeResult =
  | {
      status: "ok";
      goals: { calorieGoal: number; proteinGoal: number; carbsGoal: number; fatGoal: number };
      audit: {
        rmr: number;
        activityKcal: number;
        tdee: number;
        weightKg: string;
        bmiTier: BmiTier;
        goalType: MacroGoalType;
        caloriesOut: number;
        weightLoggedDate: string | null;
      };
      /** True when the weight log used is > 7 days older than the target date (FOO-1010). */
      weightStale?: boolean;
    }
  | { status: "partial"; proteinG: number; fatG: number }
  | {
      status: "blocked";
      reason: "no_weight" | "sex_unset" | "scope_mismatch" | "invalid_profile" | "invalid_activity";
    };

/** Result shape from a successful ratchet recompute. */
interface RatchetResult {
  targetKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  rmr: number;
  activityKcal: number;
  tdee: number;
  caloriesOut: number;
}

/**
 * FOO-1009 ratchet-up: re-evaluate today's calorie target with live
 * `caloriesOut` and UPDATE the row only when the new target EXCEEDS the stored
 * one. Returns the recomputed values when a ratchet UPDATE was applied;
 * returns null when the ratchet was skipped (no live activity, breaker, below
 * RMR×1.05 threshold, or new target ≤ stored).
 */
async function tryRatchetRecompute(args: {
  userId: string;
  date: string;
  existing: DbRow;
  liveActivity: { caloriesOut: number | null } | null;
  liveProfile: { ageYears: number; sex: "MALE" | "FEMALE" | "NA"; heightCm: number } | null;
  wKg: number;
  goalType: MacroGoalType;
  log: Logger;
}): Promise<RatchetResult | null> {
  const { userId, date, existing, liveActivity, liveProfile, wKg, goalType, log } = args;

  // Need a usable profile (non-NA) and a non-null caloriesOut to recompute.
  if (
    liveProfile === null ||
    liveProfile.sex === "NA" ||
    liveActivity === null ||
    liveActivity.caloriesOut === null
  ) {
    return null;
  }

  // Apply the FOO-999 below-RMR threshold — too noisy to anchor a target.
  const rmrThreshold =
    computeRmr(liveProfile.sex, liveProfile.ageYears, liveProfile.heightCm, wKg) * 1.05;
  if (liveActivity.caloriesOut < rmrThreshold) return null;

  let engineOut: ReturnType<typeof computeMacroTargets>;
  try {
    const macroProfile = (await loadUserMacroProfile(userId, log)).profile;
    engineOut = computeMacroTargets(
      {
        ageYears: liveProfile.ageYears,
        sex: liveProfile.sex,
        heightCm: liveProfile.heightCm,
        weightKg: wKg,
        caloriesOut: liveActivity.caloriesOut,
        goalType,
      },
      macroProfile,
    );
  } catch {
    // Don't disrupt cache-hit if recompute fails; serve stored values.
    return null;
  }

  if (engineOut.targetKcal <= existing.calorieGoal) {
    return null;
  }

  // Ratchet UP. Don't touch goalType/bmiTier/profileVersion/weightLoggedDate —
  // those are stable identity fields, not activity-derived.
  await getDb()
    .update(dailyCalorieGoals)
    .set({
      calorieGoal: engineOut.targetKcal,
      proteinGoal: engineOut.proteinG,
      carbsGoal: engineOut.carbsG,
      fatGoal: engineOut.fatG,
      caloriesOut: liveActivity.caloriesOut,
      activityKcal: engineOut.activityKcal,
      updatedAt: new Date(),
    })
    .where(and(eq(dailyCalorieGoals.userId, userId), eq(dailyCalorieGoals.date, date)));

  log.info(
    {
      action: "daily_goals_ratchet_up",
      userId,
      date,
      from: existing.calorieGoal,
      to: engineOut.targetKcal,
    },
    "calorie target ratcheted up",
  );

  return {
    targetKcal: engineOut.targetKcal,
    proteinG: engineOut.proteinG,
    carbsG: engineOut.carbsG,
    fatG: engineOut.fatG,
    rmr: engineOut.rmr,
    activityKcal: engineOut.activityKcal,
    tdee: engineOut.tdee,
    caloriesOut: liveActivity.caloriesOut,
  };
}

/** Compute weightStale flag from target date and weight log date. */
function computeWeightStale(targetDate: string, weightLoggedDate: string | null): boolean {
  if (weightLoggedDate === null) return false;
  const ageMs = Date.parse(targetDate) - Date.parse(weightLoggedDate);
  return ageMs / 86_400_000 > 7;
}

// In-flight Promise Map keyed `${userId}:${date}` — delete on settle (success or error)
const computeInFlight = new Map<string, Promise<ComputeResult>>();

function getBmiTier(weightKg: number, heightCm: number): BmiTier {
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  return bmi < 25 ? "lt25" : bmi < 30 ? "25to30" : "ge30";
}

function hasMacros(row: DbRow): boolean {
  return (
    row.proteinGoal !== null &&
    row.carbsGoal !== null &&
    row.fatGoal !== null &&
    row.rmr !== null &&
    row.activityKcal !== null &&
    row.weightKg !== null &&
    row.caloriesOut !== null
  );
}

/** Just the version — used in the cache-hit FOO-996 race-safety check. */
async function loadUserMacroProfileVersion(userId: string): Promise<number> {
  const rows = await getDb()
    .select({ macroProfileVersion: users.macroProfileVersion })
    .from(users)
    .where(eq(users.id, userId));
  return rows[0]?.macroProfileVersion ?? 1;
}

async function loadUserMacroProfile(
  userId: string,
  log?: Logger,
): Promise<{ profile: MacroProfile; version: number }> {
  const rows = await getDb()
    .select({
      macroProfile: users.macroProfile,
      macroProfileVersion: users.macroProfileVersion,
    })
    .from(users)
    .where(eq(users.id, userId));
  const key = rows[0]?.macroProfile;
  const version = rows[0]?.macroProfileVersion ?? 1;
  // Pass the raw stored key — getMacroProfile logs a warning for unknown
  // values so DB drift (FOO-1001) is observable.
  return {
    profile: getMacroProfile(key, log ?? logger),
    version,
  };
}

function isBmiTier(value: unknown): value is BmiTier {
  return value === "lt25" || value === "25to30" || value === "ge30";
}

function isMacroGoalType(value: unknown): value is MacroGoalType {
  return value === "LOSE" || value === "MAINTAIN" || value === "GAIN";
}

async function queryRow(userId: string, date: string): Promise<DbRow | null> {
  const rows = await getDb()
    .select({
      calorieGoal: dailyCalorieGoals.calorieGoal,
      proteinGoal: dailyCalorieGoals.proteinGoal,
      carbsGoal: dailyCalorieGoals.carbsGoal,
      fatGoal: dailyCalorieGoals.fatGoal,
      weightKg: dailyCalorieGoals.weightKg,
      caloriesOut: dailyCalorieGoals.caloriesOut,
      rmr: dailyCalorieGoals.rmr,
      activityKcal: dailyCalorieGoals.activityKcal,
      goalType: dailyCalorieGoals.goalType,
      bmiTier: dailyCalorieGoals.bmiTier,
      profileVersion: dailyCalorieGoals.profileVersion,
      weightLoggedDate: dailyCalorieGoals.weightLoggedDate,
    })
    .from(dailyCalorieGoals)
    .where(and(eq(dailyCalorieGoals.userId, userId), eq(dailyCalorieGoals.date, date)));

  return (rows[0] as DbRow) ?? null;
}

async function doCompute(userId: string, date: string, log?: Logger): Promise<ComputeResult> {
  const l = log ?? logger;

  try {
    // Fast path: row already fully computed — re-use from DB
    const existing = await queryRow(userId, date);
    const cacheHit =
      existing !== null &&
      hasMacros(existing) &&
      // FOO-996 race-safety: stored profile_version must match the user's
      // current version. A mismatch means a profile change landed AFTER this
      // row was written by an older in-flight compute — recompute.
      // Legacy rows (profile_version null, pre-F1) are accepted as-is.
      (existing.profileVersion === null ||
        existing.profileVersion === (await loadUserMacroProfileVersion(userId)));

    if (cacheHit && existing) {
      // Re-fetch profile + weight goal + activity from process-level cache.
      // All "optional" — when the breaker rejects (low headroom), gracefully
      // degrade to stored values. Activity is needed for FOO-1009 ratchet-up.
      const [profileRes, weightGoalRes, activityRes] = await Promise.allSettled([
        getCachedFitbitProfile(userId, l, "optional"),
        getCachedFitbitWeightGoal(userId, l, "optional"),
        getCachedActivitySummary(userId, date, l, "optional"),
      ]);

      // Re-throw any non-breaker rejection from the profile fetch (the only
      // call that contributes to bmiTier — weightGoal has a safe MAINTAIN default).
      if (
        profileRes.status === "rejected" &&
        !(profileRes.reason instanceof Error && profileRes.reason.message === "FITBIT_RATE_LIMIT_LOW")
      ) {
        throw profileRes.reason;
      }
      if (
        weightGoalRes.status === "rejected" &&
        !(weightGoalRes.reason instanceof Error && weightGoalRes.reason.message === "FITBIT_RATE_LIMIT_LOW")
      ) {
        throw weightGoalRes.reason;
      }
      // Activity rejection (any reason) → skip ratchet, serve stored goals.
      // The ratchet (FOO-1009) is an optional enhancement; if Fitbit errors,
      // the stored row is self-sufficient — never break the cache-hit path
      // over an activity fetch.

      // hasMacros guarantees existing.weightKg is non-null, so parseFloat is safe.
      const wKg = parseFloat(existing.weightKg!);

      // Prefer stored audit columns (FOO-993). Stored values reflect the goal
      // and BMI tier that PRODUCED the stored macros — never re-derive from
      // current Fitbit state, which could have drifted since the row was written.
      // Fall back to the live re-fetch only for legacy rows (pre-F1 columns null).
      const storedGoalType = isMacroGoalType(existing.goalType) ? existing.goalType : null;
      const storedBmiTier = isBmiTier(existing.bmiTier) ? existing.bmiTier : null;

      const bmiTier =
        storedBmiTier ??
        (profileRes.status === "fulfilled" ? getBmiTier(wKg, profileRes.value.heightCm) : "lt25");
      const goalType: MacroGoalType =
        storedGoalType ??
        (weightGoalRes.status === "fulfilled"
          ? weightGoalRes.value?.goalType ?? "MAINTAIN"
          : "MAINTAIN");

      if (storedGoalType === null || storedBmiTier === null) {
        l.warn(
          { action: "daily_goals_legacy_audit", userId, date },
          "audit reconstructed from current Fitbit state (legacy row pre-F1)",
        );
      }

      // FOO-1009 ratchet-up: re-evaluate the calorie target against the live
      // caloriesOut. Only UPDATE the row when the new target EXCEEDS the stored
      // one — meal-planning stability + credit for late-day exercise. Skip
      // when the live snapshot is too noisy (below RMR×1.05) or unavailable.
      const liveActivity =
        activityRes.status === "fulfilled" ? activityRes.value : null;
      const liveProfile =
        profileRes.status === "fulfilled" ? profileRes.value : null;

      const ratchet = await tryRatchetRecompute({
        userId,
        date,
        existing,
        liveActivity,
        liveProfile,
        wKg,
        goalType,
        log: l,
      });

      const tdee = ratchet
        ? ratchet.tdee
        : (existing.rmr ?? 0) + (existing.activityKcal ?? 0);

      return {
        status: "ok",
        goals: ratchet
          ? {
              calorieGoal: ratchet.targetKcal,
              proteinGoal: ratchet.proteinG,
              carbsGoal: ratchet.carbsG,
              fatGoal: ratchet.fatG,
            }
          : {
              calorieGoal: existing.calorieGoal,
              proteinGoal: existing.proteinGoal!,
              carbsGoal: existing.carbsGoal!,
              fatGoal: existing.fatGoal!,
            },
        audit: {
          rmr: existing.rmr!,
          activityKcal: ratchet ? ratchet.activityKcal : existing.activityKcal!,
          tdee,
          weightKg: existing.weightKg!,
          bmiTier,
          goalType,
          caloriesOut: ratchet ? ratchet.caloriesOut : existing.caloriesOut!,
          weightLoggedDate: existing.weightLoggedDate,
        },
        weightStale: computeWeightStale(date, existing.weightLoggedDate),
      };
    }

    // Fetch from Fitbit (uses process-level TTL cache internally). This is the
    // first compute of the day for this user — mark it `important` so the breaker
    // does not reject; if FITBIT_RATE_LIMIT_LOW *does* propagate (remaining < 5),
    // the caller maps it to a 503.
    const [profile, weightLog, weightGoal, activity] = await Promise.all([
      getCachedFitbitProfile(userId, l, "important"),
      getCachedFitbitWeightKg(userId, date, l, "important"),
      getCachedFitbitWeightGoal(userId, l, "important"),
      getCachedActivitySummary(userId, date, l, "important"),
    ]);

    if (profile.sex === "NA") {
      return { status: "blocked", reason: "sex_unset" };
    }
    if (weightLog === null) {
      return { status: "blocked", reason: "no_weight" };
    }

    const weightKg = weightLog.weightKg;
    const goalType: MacroGoalType = weightGoal?.goalType ?? "MAINTAIN";
    const bmiTier = getBmiTier(weightKg, profile.heightCm);

    // Profile is needed for both partial and full compute paths — load it now,
    // after the blocked-state guards above so blocked-state tests don't need to mock it.
    const { profile: macroProfile, version: profileVersion } = await loadUserMacroProfile(userId, l);

    // FOO-1030 (PR review): explicit invalid-activity gate before the partial
    // fallback. Negative / NaN / Infinity / >30000 caloriesOut would otherwise
    // be masked as "partial" by the rmrThreshold gate below, bypassing the
    // macro-engine's INVALID_ACTIVITY_DATA validation. Mirror that validation here.
    if (
      activity !== null &&
      activity.caloriesOut !== null &&
      (!Number.isFinite(activity.caloriesOut) ||
        activity.caloriesOut < 0 ||
        activity.caloriesOut > 30000)
    ) {
      return { status: "blocked", reason: "invalid_activity" };
    }

    // FOO-999: 5% headroom above RMR — caloriesOut below this is too noisy
    // (early-morning Fitbit reports before tracking begins) to anchor a target,
    // and below RMR would yield an unsafe sub-RMR calorie goal for LOSE/MAINTAIN.
    // sex === "NA" is already filtered out by the blocked guard above.
    const rmrThreshold =
      computeRmr(profile.sex, profile.ageYears, profile.heightCm, weightKg) * 1.05;

    if (
      activity === null ||
      activity.caloriesOut === null ||
      activity.caloriesOut < rmrThreshold
    ) {
      // Partial: compute protein/fat per the active profile without a full calorie target.
      const proteinG = Math.round(
        weightKg * macroProfile.proteinCoefficients[bmiTier][goalType],
      );
      const fatG = Math.round(weightKg * macroProfile.fatPerKgFactor);
      return { status: "partial", proteinG, fatG };
    }

    // Full compute
    const engineOut = computeMacroTargets(
      {
        ageYears: profile.ageYears,
        sex: profile.sex,
        heightCm: profile.heightCm,
        weightKg,
        caloriesOut: activity.caloriesOut,
        goalType,
      },
      macroProfile,
    );

    // INSERT … ON CONFLICT (userId, date) DO NOTHING
    await getDb()
      .insert(dailyCalorieGoals)
      .values({
        userId,
        date,
        calorieGoal: engineOut.targetKcal,
        proteinGoal: engineOut.proteinG,
        carbsGoal: engineOut.carbsG,
        fatGoal: engineOut.fatG,
        weightKg: String(weightKg),
        caloriesOut: activity.caloriesOut,
        rmr: engineOut.rmr,
        activityKcal: engineOut.activityKcal,
        goalType,
        bmiTier: engineOut.bmiTier,
        profileVersion,
        weightLoggedDate: weightLog.loggedDate,
      })
      .onConflictDoNothing();

    // Read back the row (may be the one we inserted or an older conflict row)
    const row = await queryRow(userId, date);

    // Update the read-back row when:
    //  (a) it's missing macros (Lumen-backfilled or pre-feature row), OR
    //  (b) FOO-1029 (PR review): its persisted profile_version is stale relative
    //      to the user's current version. This happens in the FOO-996 race when
    //      an older in-flight compute already wrote a fully populated row before
    //      PATCH bumped the version. The INSERT...ON CONFLICT DO NOTHING above
    //      is a no-op in that case, so without this UPDATE the stale row stays
    //      and every subsequent read mismatches → infinite full-compute loop.
    //
    // For Lumen-backfilled rows (case a), preserve a real existing calorieGoal.
    // For version-stale rows (case b), the existing macros were computed under a
    // different profile — overwrite with the fresh engine output.
    // `!= null` mirrors the cache-hit check (line 268): a null profileVersion
    // is a legacy pre-F1 row, not a stale version — leave it for the cache-hit
    // path to handle on the next read.
    const versionStale =
      row !== null && row.profileVersion != null && row.profileVersion !== profileVersion;
    if (row && (!hasMacros(row) || versionStale)) {
      await getDb()
        .update(dailyCalorieGoals)
        .set({
          calorieGoal:
            !hasMacros(row) && row.calorieGoal > 0 ? row.calorieGoal : engineOut.targetKcal,
          proteinGoal: engineOut.proteinG,
          carbsGoal: engineOut.carbsG,
          fatGoal: engineOut.fatG,
          weightKg: String(weightKg),
          caloriesOut: activity.caloriesOut,
          rmr: engineOut.rmr,
          activityKcal: engineOut.activityKcal,
          goalType,
          bmiTier: engineOut.bmiTier,
          profileVersion,
          weightLoggedDate: weightLog.loggedDate,
          updatedAt: new Date(),
        })
        .where(and(eq(dailyCalorieGoals.userId, userId), eq(dailyCalorieGoals.date, date)));
    }

    l.info(
      { action: "daily_goals_computed", userId, date, goalType, bmiTier: engineOut.bmiTier },
      "daily goals computed"
    );

    return {
      status: "ok",
      goals: {
        // Preserve a real Lumen-backfilled calorieGoal (case a above), but on a
        // version-stale recompute (case b) the row's calorieGoal was computed
        // under a different profile — return the fresh engine value to match
        // what we just persisted.
        calorieGoal:
          row && row.calorieGoal > 0 && !versionStale
            ? row.calorieGoal
            : engineOut.targetKcal,
        proteinGoal: engineOut.proteinG,
        carbsGoal: engineOut.carbsG,
        fatGoal: engineOut.fatG,
      },
      audit: {
        rmr: engineOut.rmr,
        activityKcal: engineOut.activityKcal,
        tdee: engineOut.tdee,
        weightKg: String(weightKg),
        bmiTier: engineOut.bmiTier,
        goalType,
        caloriesOut: activity.caloriesOut,
        weightLoggedDate: weightLog.loggedDate,
      },
      weightStale: computeWeightStale(date, weightLog.loggedDate),
    };
  } catch (error) {
    if (error instanceof Error && error.message === "FITBIT_SCOPE_MISSING") {
      return { status: "blocked", reason: "scope_mismatch" };
    }
    if (error instanceof Error && error.message === "INVALID_PROFILE_DATA") {
      return { status: "blocked", reason: "invalid_profile" };
    }
    if (error instanceof Error && error.message === "INVALID_ACTIVITY_DATA") {
      return { status: "blocked", reason: "invalid_activity" };
    }
    throw error;
  }
}

// Non-async so concurrent callers receive the EXACT same Promise object reference
export function getOrComputeDailyGoals(
  userId: string,
  date: string,
  log?: Logger
): Promise<ComputeResult> {
  const key = `${userId}:${date}`;
  const inflight = computeInFlight.get(key);
  if (inflight) return inflight;

  const promise = doCompute(userId, date, log).finally(() => computeInFlight.delete(key));
  computeInFlight.set(key, promise);
  return promise;
}

/**
 * Reset macro/audit columns for ONE specific (userId, date) row, scoped to a
 * Fitbit-side data refresh (FOO-992). Drops the in-flight compute key for that
 * date and zeroes the row so the next read forces a fresh compute under
 * up-to-date Fitbit inputs. Distinct from `invalidateUserDailyGoalsForProfileChange`:
 * Fitbit refresh implies "the upstream inputs changed for this date" rather
 * than "the user changed their profile choice" — does NOT bump the version
 * counter and does NOT touch other dates.
 */
export async function invalidateUserDailyGoalsForDate(
  userId: string,
  date: string,
): Promise<void> {
  computeInFlight.delete(`${userId}:${date}`);

  await getDb()
    .update(dailyCalorieGoals)
    .set({
      calorieGoal: 0,
      proteinGoal: null,
      carbsGoal: null,
      fatGoal: null,
      weightKg: null,
      caloriesOut: null,
      rmr: null,
      activityKcal: null,
      goalType: null,
      bmiTier: null,
      profileVersion: null,
      weightLoggedDate: null,
      updatedAt: new Date(),
    })
    .where(and(eq(dailyCalorieGoals.userId, userId), eq(dailyCalorieGoals.date, date)));
}

/**
 * Reset macro/audit columns for the user's rows from `fromDate` forward so the
 * engine re-derives them under the (possibly new) macro profile on next read.
 * Called from the macro-profile API after a profile change.
 *
 * **Scope (FOO-995):** today + future dates only. Historical days reflect the
 * goal/profile context active at the time the row was written and stay stable —
 * avoids the rate-limit storm of N Fitbit recomputes when a user scrolls through
 * history after toggling the profile. The profile-version counter (FOO-996) is
 * the actual race-safety mechanism; this row clear is for UX (immediate visible
 * refresh on the dashboard's next read).
 *
 * Also drops in-flight compute promises for this user at `fromDate` and after.
 */
export async function invalidateUserDailyGoalsForProfileChange(
  userId: string,
  fromDate: string,
): Promise<void> {
  for (const key of computeInFlight.keys()) {
    if (key.startsWith(`${userId}:`)) {
      const dateSuffix = key.slice(userId.length + 1);
      if (dateSuffix >= fromDate) {
        computeInFlight.delete(key);
      }
    }
  }

  await getDb()
    .update(dailyCalorieGoals)
    .set({
      calorieGoal: 0,
      proteinGoal: null,
      carbsGoal: null,
      fatGoal: null,
      weightKg: null,
      caloriesOut: null,
      rmr: null,
      activityKcal: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dailyCalorieGoals.userId, userId),
        gte(dailyCalorieGoals.date, fromDate),
      ),
    );
}

export async function getDailyGoalsByDate(
  userId: string,
  date: string
): Promise<{
  date: string;
  calorieGoal: number;
  proteinGoal: number | null;
  carbsGoal: number | null;
  fatGoal: number | null;
  weightKg: string | null;
  caloriesOut: number | null;
  rmr: number | null;
  activityKcal: number | null;
} | null> {
  const rows = await getDb()
    .select({
      date: dailyCalorieGoals.date,
      calorieGoal: dailyCalorieGoals.calorieGoal,
      proteinGoal: dailyCalorieGoals.proteinGoal,
      carbsGoal: dailyCalorieGoals.carbsGoal,
      fatGoal: dailyCalorieGoals.fatGoal,
      weightKg: dailyCalorieGoals.weightKg,
      caloriesOut: dailyCalorieGoals.caloriesOut,
      rmr: dailyCalorieGoals.rmr,
      activityKcal: dailyCalorieGoals.activityKcal,
    })
    .from(dailyCalorieGoals)
    .where(and(eq(dailyCalorieGoals.userId, userId), eq(dailyCalorieGoals.date, date)));

  return (rows[0] as typeof rows[0] | undefined) ?? null;
}

/**
 * Map a `ComputeResult` to the public `NutritionGoals` API response shape.
 * Shared by `/api/nutrition-goals` (internal) and `/api/v1/nutrition-goals`
 * (external). Extracted from the internal route handler in A1 (FOO-1008).
 */
export function mapComputeResultToNutritionGoals(result: ComputeResult): NutritionGoals {
  if (result.status === "ok") {
    return {
      calories: result.goals.calorieGoal,
      proteinG: result.goals.proteinGoal,
      carbsG: result.goals.carbsGoal,
      fatG: result.goals.fatGoal,
      status: "ok",
      audit: result.audit,
      ...(result.weightStale ? { weightStale: true } : {}),
    };
  }
  if (result.status === "partial") {
    return {
      calories: null,
      proteinG: result.proteinG,
      carbsG: null,
      fatG: result.fatG,
      status: "partial",
    };
  }
  return {
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    status: "blocked",
    reason: result.reason,
  };
}

/** Look up the user's stored macro-profile key (defaulting to muscle_preserve). */
export async function loadUserMacroProfileKey(userId: string): Promise<MacroProfileKey> {
  const rows = await getDb()
    .select({ macroProfile: users.macroProfile })
    .from(users)
    .where(eq(users.id, userId));
  const stored = rows[0]?.macroProfile;
  return isMacroProfileKey(stored) ? stored : "muscle_preserve";
}
