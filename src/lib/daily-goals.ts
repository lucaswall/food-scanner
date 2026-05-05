import { getDb } from "@/db/index";
import { dailyCalorieGoals, users } from "@/db/schema";
import { eq, and, gte, lt, desc } from "drizzle-orm";
import { getTodayDate } from "@/lib/date-utils";
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
  tdeeSource: string | null;
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
      /**
       * FOO-1036: true when the engine's `caloriesOut` input was a seed (history
       * median or RMR×1.4 default) rather than today's live Fitbit value. The UI
       * does not surface this — present for clients/telemetry only.
       */
      isSeeded?: boolean;
    }
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
  try {
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
  } catch (err) {
    // The ratchet is documented as optional — if Fitbit errors, we serve the
    // stored row. Apply the same graceful-degrade rule when the DB UPDATE
    // throws: never break the cache-hit path.
    log.warn(
      { action: "daily_goals_ratchet_failed", userId, date, err: (err as Error).message },
      "ratchet UPDATE failed; serving cached values",
    );
    return null;
  }

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

/**
 * FOO-1036: default activity factor used when no prior `live` history exists
 * for the user. Picked at the "lightly active" end of the standard TDEE range
 * (RMR × 1.4) so the seeded calorie target is always above RMR × 1.05 — never
 * yields a sub-RMR goal even before any Fitbit data is recorded.
 */
export const DEFAULT_ACTIVITY_MULTIPLIER = 1.4;

/**
 * FOO-1036 promotion: when a stored seeded row's live `caloriesOut` finally
 * clears `RMR × 1.05`, overwrite the row with live values regardless of
 * direction. Returns the new values when a promotion UPDATE fired; null when
 * skipped (not today, row already live/legacy, no live data, or threshold not
 * cleared). Does not throw — promotion is best-effort; on failure the caller
 * serves the cached seeded values.
 */
async function tryPromoteSeededRow(args: {
  userId: string;
  date: string;
  existing: DbRow;
  liveActivity: { caloriesOut: number | null } | null;
  liveProfile: { ageYears: number; sex: "MALE" | "FEMALE" | "NA"; heightCm: number } | null;
  wKg: number;
  goalType: MacroGoalType;
  targetIsToday: boolean;
  storedIsSeeded: boolean;
  log: Logger;
}): Promise<RatchetResult | null> {
  const {
    userId,
    date,
    existing,
    liveActivity,
    liveProfile,
    wKg,
    goalType,
    targetIsToday,
    storedIsSeeded,
    log,
  } = args;

  if (
    !targetIsToday ||
    !storedIsSeeded ||
    liveProfile === null ||
    liveProfile.sex === "NA" ||
    liveActivity === null ||
    liveActivity.caloriesOut === null
  ) {
    return null;
  }

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
    return null;
  }

  try {
    await getDb()
      .update(dailyCalorieGoals)
      .set({
        calorieGoal: engineOut.targetKcal,
        proteinGoal: engineOut.proteinG,
        carbsGoal: engineOut.carbsG,
        fatGoal: engineOut.fatG,
        caloriesOut: liveActivity.caloriesOut,
        rmr: engineOut.rmr,
        activityKcal: engineOut.activityKcal,
        bmiTier: engineOut.bmiTier,
        tdeeSource: "live",
        updatedAt: new Date(),
      })
      .where(and(eq(dailyCalorieGoals.userId, userId), eq(dailyCalorieGoals.date, date)));
  } catch (err) {
    // Honor the docstring's "does not throw" contract — a transient DB error
    // must not turn a successful cache-hit into a 500. Caller serves cached
    // seeded values; promotion will retry on the next read.
    log.warn(
      { action: "daily_goals_promotion_failed", userId, date, err: (err as Error).message },
      "promotion UPDATE failed; serving cached seeded values",
    );
    return null;
  }

  log.info(
    {
      action: "daily_goals_promoted",
      userId,
      date,
      from: existing.calorieGoal,
      to: engineOut.targetKcal,
      fromSource: existing.tdeeSource,
    },
    "calorie target promoted from seed to live",
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

/**
 * FOO-1036 seed resolver: pure read that picks a reasonable `caloriesOut`
 * value to feed the macro engine on days where Fitbit hasn't yet recorded a
 * usable cumulative `caloriesOut` (typical morning state).
 *
 * Strategy:
 *  - Pull rows from the prior 7 days (strictly before `targetDate`) where
 *    `tdee_source = 'live'` (NULL is treated as `'live'` for legacy rows
 *    written before this column existed).
 *  - Median of the qualifying `caloriesOut` values; for an even count, take
 *    the LOWER of the two middle values to keep the result an integer (no
 *    float arithmetic, robust against single high outliers).
 *  - If no qualifying rows exist, fall back to `round(rmr × 1.4)`.
 *
 * The caller decides whether to insert/update — this function never mutates.
 */
export async function resolveTdeeSeed(
  userId: string,
  targetDate: string,
  rmr: number,
  log: Logger,
): Promise<{ source: "history" | "default"; value: number }> {
  // 7-day inclusive-from / exclusive-to window: [targetDate - 7d, targetDate).
  // Exclusive upper bound guarantees today's own row never feeds its own seed.
  const targetTs = Date.parse(targetDate);
  const lookbackStart = new Date(targetTs - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const rows = await getDb()
    .select({
      tdeeSource: dailyCalorieGoals.tdeeSource,
      caloriesOut: dailyCalorieGoals.caloriesOut,
    })
    .from(dailyCalorieGoals)
    .where(
      and(
        eq(dailyCalorieGoals.userId, userId),
        gte(dailyCalorieGoals.date, lookbackStart),
        lt(dailyCalorieGoals.date, targetDate),
      ),
    )
    .orderBy(desc(dailyCalorieGoals.date))
    .limit(7);

  // Treat NULL tdeeSource as 'live' (legacy rows pre-FOO-1036). 'history' and
  // 'default' rows are skipped — re-using a seed as input to another seed
  // would compound the estimate.
  const liveCalories: number[] = [];
  for (const row of rows) {
    if (
      row.caloriesOut !== null &&
      (row.tdeeSource === null || row.tdeeSource === "live")
    ) {
      liveCalories.push(row.caloriesOut);
    }
  }

  if (liveCalories.length === 0) {
    const value = Math.round(rmr * DEFAULT_ACTIVITY_MULTIPLIER);
    log.debug(
      { action: "tdee_seed_resolved", source: "default", value, sampleSize: 0 },
      "tdee seed resolved (default fallback)",
    );
    return { source: "default", value };
  }

  // Median: ascending sort, pick floor((n-1)/2) → exact middle for odd, lower
  // of two middle for even. Integer-clean (no division).
  const sorted = [...liveCalories].sort((a, b) => a - b);
  const value = sorted[Math.floor((sorted.length - 1) / 2)];
  log.debug(
    {
      action: "tdee_seed_resolved",
      source: "history",
      value,
      sampleSize: sorted.length,
    },
    "tdee seed resolved (history median)",
  );
  return { source: "history", value };
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
      tdeeSource: dailyCalorieGoals.tdeeSource,
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
    // FOO-1032 (PR review): version-mismatch fallback only applies to today
    // and forward. invalidateUserDailyGoalsForProfileChange (FOO-995) only
    // clears today + future rows on profile change, so historical rows keep
    // their old profile_version by design — checking it on history scrolls
    // would force a Fitbit recompute storm and rewrite stable history.
    const targetIsTodayOrLater = date >= getTodayDate();
    const cacheHit =
      existing !== null &&
      hasMacros(existing) &&
      // FOO-996 race-safety: stored profile_version must match the user's
      // current version. A mismatch means a profile change landed AFTER this
      // row was written by an older in-flight compute — recompute.
      // Legacy rows (profile_version null, pre-F1) are accepted as-is.
      (!targetIsTodayOrLater ||
        existing.profileVersion === null ||
        existing.profileVersion === (await loadUserMacroProfileVersion(userId)));

    if (cacheHit && existing) {
      // FOO-1034 (PR review): the FOO-1009 ratchet is a today-only correction
      // for late-day exercise. Skip the activity fetch entirely on historical
      // dates — they stay stable per FOO-995/FOO-1032, and avoiding the Fitbit
      // call also saves quota on history scrolls.
      const targetIsToday = date === getTodayDate();

      // Re-fetch profile + weight goal + activity from process-level cache.
      // All "optional" — when the breaker rejects (low headroom), gracefully
      // degrade to stored values. Activity is needed for FOO-1009 ratchet-up.
      const [profileRes, weightGoalRes, activityRes] = await Promise.allSettled([
        getCachedFitbitProfile(userId, l, "optional"),
        getCachedFitbitWeightGoal(userId, l, "optional"),
        targetIsToday
          ? getCachedActivitySummary(userId, date, l, "optional")
          : Promise.resolve(null),
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

      // FOO-1036: stored tdeeSource of 'history' or 'default' indicates the row
      // was seeded (engine fed a default/history caloriesOut, not today's live
      // Fitbit value). NULL = legacy pre-FOO-1036 row, treated as 'live'.
      const storedIsSeeded =
        existing.tdeeSource === "history" || existing.tdeeSource === "default";

      // FOO-1036 promotion: a seeded row gets fully overwritten with live
      // values the moment today's live caloriesOut clears RMR × 1.05 — the
      // direction (up or down) doesn't matter because a seeded calorieGoal is
      // an estimate, not a stable anchor. Promotion is one-way per design: once
      // the row is 'live' it follows the ratchet UP-only rule below. Skipped
      // entirely on historical dates and on rows that are already live or legacy.
      const promoted = await tryPromoteSeededRow({
        userId,
        date,
        existing,
        liveActivity,
        liveProfile,
        wKg,
        goalType,
        targetIsToday,
        storedIsSeeded,
        log: l,
      });

      // FOO-1034: ratchet only runs for today. FOO-1036: ratchet only runs
      // for non-seeded rows (legacy NULL = live). Seeded rows take the
      // promotion path above; if promotion didn't fire (threshold not cleared
      // or live data unavailable), serve the cached seeded values.
      const ratchet =
        targetIsToday && !storedIsSeeded
          ? await tryRatchetRecompute({
              userId,
              date,
              existing,
              liveActivity,
              liveProfile,
              wKg,
              goalType,
              log: l,
            })
          : null;

      const recompute = promoted ?? ratchet;
      const tdee = recompute
        ? recompute.tdee
        : (existing.rmr ?? 0) + (existing.activityKcal ?? 0);

      return {
        status: "ok",
        goals: recompute
          ? {
              calorieGoal: recompute.targetKcal,
              proteinGoal: recompute.proteinG,
              carbsGoal: recompute.carbsG,
              fatGoal: recompute.fatG,
            }
          : {
              calorieGoal: existing.calorieGoal,
              proteinGoal: existing.proteinGoal!,
              carbsGoal: existing.carbsGoal!,
              fatGoal: existing.fatGoal!,
            },
        audit: {
          rmr: recompute ? recompute.rmr : existing.rmr!,
          activityKcal: recompute ? recompute.activityKcal : existing.activityKcal!,
          tdee,
          weightKg: existing.weightKg!,
          bmiTier,
          goalType,
          caloriesOut: recompute ? recompute.caloriesOut : existing.caloriesOut!,
          weightLoggedDate: existing.weightLoggedDate,
        },
        weightStale: computeWeightStale(date, existing.weightLoggedDate),
        // After a successful promotion the row is now live — clear isSeeded.
        ...(storedIsSeeded && !promoted ? { isSeeded: true } : {}),
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

    // Profile is needed for both seeded and live compute paths — load it now,
    // after the blocked-state guards above so blocked-state tests don't need to mock it.
    const { profile: macroProfile, version: profileVersion } = await loadUserMacroProfile(userId, l);

    // FOO-1030: explicit invalid-activity gate. Negative / NaN / Infinity /
    // > 30000 caloriesOut would otherwise be silently routed to the seed path
    // by the rmrThreshold gate below, bypassing the macro-engine's
    // INVALID_ACTIVITY_DATA validation. Mirror that validation here so an
    // unrecoverable Fitbit reading produces a 'blocked' status, not a seeded ok.
    if (
      activity !== null &&
      activity.caloriesOut !== null &&
      (!Number.isFinite(activity.caloriesOut) ||
        activity.caloriesOut < 0 ||
        activity.caloriesOut > 30000)
    ) {
      return { status: "blocked", reason: "invalid_activity" };
    }

    // FOO-999 / FOO-1036: 5% headroom above RMR is the boundary between "live
    // caloriesOut is reliable enough to anchor a target" and "fall back to a
    // seeded value". Below this, Fitbit's morning cumulative is too noisy and
    // the engine would otherwise produce a sub-RMR target. Per FOO-1036 the
    // engine no longer returns a partial result: instead we seed the engine's
    // caloriesOut input from a 7-day history median (or RMR × 1.4 fallback).
    // sex === "NA" is already filtered out by the blocked guard above.
    const rmr = computeRmr(profile.sex, profile.ageYears, profile.heightCm, weightKg);
    const rmrThreshold = rmr * 1.05;

    let effectiveCaloriesOut: number;
    let computeTdeeSource: "live" | "history" | "default";
    let isSeeded: boolean;

    if (
      activity === null ||
      activity.caloriesOut === null ||
      activity.caloriesOut < rmrThreshold
    ) {
      const seed = await resolveTdeeSeed(userId, date, rmr, l);
      effectiveCaloriesOut = seed.value;
      computeTdeeSource = seed.source;
      isSeeded = true;
    } else {
      effectiveCaloriesOut = activity.caloriesOut;
      computeTdeeSource = "live";
      isSeeded = false;
    }

    const engineOut = computeMacroTargets(
      {
        ageYears: profile.ageYears,
        sex: profile.sex,
        heightCm: profile.heightCm,
        weightKg,
        caloriesOut: effectiveCaloriesOut,
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
        caloriesOut: effectiveCaloriesOut,
        rmr: engineOut.rmr,
        activityKcal: engineOut.activityKcal,
        goalType,
        bmiTier: engineOut.bmiTier,
        profileVersion,
        weightLoggedDate: weightLog.loggedDate,
        tdeeSource: computeTdeeSource,
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
    //
    // FOO-1035 (PR review): use `<` (strictly older), NOT `!==`. The original
    // FOO-1029 test only covered the case where this compute is newer than the
    // row — but with `!==`, a stale in-flight compute (loaded before a PATCH)
    // would clobber a row that a parallel newer compute already refreshed. The
    // overwrite must happen only when the persisted version is older than the
    // version this compute is anchored to.
    const versionStale =
      row !== null && row.profileVersion != null && row.profileVersion < profileVersion;
    // FOO-1036: only preserve an existing calorieGoal when the row pre-dates
    // this feature (legacy NULL tdeeSource = Lumen-backfilled). Rows that were
    // already seeded by us ('history' / 'default') must be overwritten — their
    // calorieGoal is just an estimate, not user-supplied data.
    const existingIsSeededRow =
      row !== null && (row.tdeeSource === "history" || row.tdeeSource === "default");
    if (row && (!hasMacros(row) || versionStale)) {
      await getDb()
        .update(dailyCalorieGoals)
        .set({
          calorieGoal:
            !hasMacros(row) && row.calorieGoal > 0 && !existingIsSeededRow
              ? row.calorieGoal
              : engineOut.targetKcal,
          proteinGoal: engineOut.proteinG,
          carbsGoal: engineOut.carbsG,
          fatGoal: engineOut.fatG,
          weightKg: String(weightKg),
          caloriesOut: effectiveCaloriesOut,
          rmr: engineOut.rmr,
          activityKcal: engineOut.activityKcal,
          goalType,
          bmiTier: engineOut.bmiTier,
          profileVersion,
          weightLoggedDate: weightLog.loggedDate,
          tdeeSource: computeTdeeSource,
          updatedAt: new Date(),
        })
        .where(and(eq(dailyCalorieGoals.userId, userId), eq(dailyCalorieGoals.date, date)));
    }

    l.info(
      {
        action: "daily_goals_computed",
        userId,
        date,
        goalType,
        bmiTier: engineOut.bmiTier,
        tdeeSource: computeTdeeSource,
        ...(isSeeded ? { seedSource: computeTdeeSource } : {}),
      },
      "daily goals computed",
    );

    return {
      status: "ok",
      goals: {
        // Preserve a real Lumen-backfilled calorieGoal (legacy row, NULL tdeeSource),
        // but on a version-stale recompute the row's calorieGoal was computed
        // under a different profile — return the fresh engine value to match
        // what we just persisted. Already-seeded rows ('history'/'default') are
        // overwritten unconditionally per FOO-1036.
        calorieGoal:
          row && row.calorieGoal > 0 && !versionStale && !existingIsSeededRow
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
        caloriesOut: effectiveCaloriesOut,
        weightLoggedDate: weightLog.loggedDate,
      },
      weightStale: computeWeightStale(date, weightLog.loggedDate),
      ...(isSeeded ? { isSeeded: true } : {}),
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
      tdeeSource: null,
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
      tdeeSource: null,
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
      ...(result.isSeeded ? { isSeeded: true } : {}),
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
