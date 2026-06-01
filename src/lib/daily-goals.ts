import { getDb } from "@/db/index";
import { dailyCalorieGoals, users } from "@/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { getTodayDate } from "@/lib/date-utils";
import { computeMacroTargets } from "@/lib/macro-engine";
import {
  getCachedHealthProfile,
  getCachedHealthWeightKg,
} from "@/lib/health-cache";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import type { ActivityLevel, NutritionGoals, NutritionGoalsAudit } from "@/types";

// ─── DB row shape ─────────────────────────────────────────────────────────────

interface DbRow {
  calorieGoal: number;
  proteinGoal: number | null;
  carbsGoal: number | null;
  fatGoal: number | null;
  weightKg: string | null;
  rmr: number | null;
  weightLoggedDate: string | null;
  activityLevel: string | null;
  goalWeightKg: string | null;
  goalRateKgPerWeek: string | null;
  tdee: number | null;
  deficitKcal: number | null;
}

// ─── ComputeResult ────────────────────────────────────────────────────────────

export type ComputeResult =
  | {
      status: "ok";
      goals: { calorieGoal: number; proteinGoal: number; carbsGoal: number; fatGoal: number };
      /**
       * Full audit available for rows written by the new engine.
       * Absent for legacy rows (written before FOO-1040 migration) — the UI
       * renders only non-null audit fields in that case.
       */
      audit?: NutritionGoalsAudit;
      /** True when the weight log used is > 7 days older than the target date (FOO-1010). */
      weightStale?: boolean;
    }
  | {
      status: "blocked";
      reason:
        | "no_weight"
        | "sex_unset"
        | "scope_mismatch"
        | "invalid_profile"
        | "goals_not_set";
    };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compute weightStale flag from target date and weight log date. */
function computeWeightStale(
  targetDate: string,
  weightLoggedDate: string | null,
): boolean {
  if (weightLoggedDate === null) return false;
  const ageMs = Date.parse(targetDate) - Date.parse(weightLoggedDate);
  return ageMs / 86_400_000 > 7;
}

/** Build NutritionGoalsAudit from a fully-populated new-engine DB row. Returns undefined for legacy rows. */
function buildAuditFromRow(row: DbRow): NutritionGoalsAudit | undefined {
  if (
    row.rmr === null ||
    row.tdee === null ||
    row.deficitKcal === null ||
    row.activityLevel === null ||
    row.goalWeightKg === null ||
    row.goalRateKgPerWeek === null ||
    row.weightKg === null
  ) {
    return undefined;
  }

  // direction derived from deficitKcal sign
  const direction: "LOSE" | "MAINTAIN" | "GAIN" =
    row.deficitKcal < 0 ? "LOSE" : row.deficitKcal > 0 ? "GAIN" : "MAINTAIN";

  // palMultiplier = TDEE / RMR (approximate — recomputed for display only)
  const palMultiplier = parseFloat((row.tdee / row.rmr).toFixed(3));

  return {
    rmr: row.rmr,
    palMultiplier,
    tdee: row.tdee,
    weightKg: row.weightKg,
    weightLoggedDate: row.weightLoggedDate,
    activityLevel: row.activityLevel as ActivityLevel,
    goalWeightKg: parseFloat(row.goalWeightKg),
    goalRateKgPerWeek: parseFloat(row.goalRateKgPerWeek),
    deficitKcal: row.deficitKcal,
    direction,
  };
}

/** Read the existing daily_calorie_goals row for (userId, date). Returns null if absent. */
async function queryRow(userId: string, date: string): Promise<DbRow | null> {
  const rows = await getDb()
    .select({
      calorieGoal:       dailyCalorieGoals.calorieGoal,
      proteinGoal:       dailyCalorieGoals.proteinGoal,
      carbsGoal:         dailyCalorieGoals.carbsGoal,
      fatGoal:           dailyCalorieGoals.fatGoal,
      weightKg:          dailyCalorieGoals.weightKg,
      rmr:               dailyCalorieGoals.rmr,
      weightLoggedDate:  dailyCalorieGoals.weightLoggedDate,
      activityLevel:     dailyCalorieGoals.activityLevel,
      goalWeightKg:      dailyCalorieGoals.goalWeightKg,
      goalRateKgPerWeek: dailyCalorieGoals.goalRateKgPerWeek,
      tdee:              dailyCalorieGoals.tdee,
      deficitKcal:       dailyCalorieGoals.deficitKcal,
    })
    .from(dailyCalorieGoals)
    .where(and(eq(dailyCalorieGoals.userId, userId), eq(dailyCalorieGoals.date, date)));

  return (rows[0] as DbRow) ?? null;
}

/** True when all three goal settings on the stored row match the user's current settings. */
function rowSettingsMatch(
  row: DbRow,
  userActivityLevel: string,
  userGoalWeightKg: string,
  userGoalRateKgPerWeek: string,
): boolean {
  return (
    row.activityLevel === userActivityLevel &&
    row.goalWeightKg === userGoalWeightKg &&
    row.goalRateKgPerWeek === userGoalRateKgPerWeek
  );
}

interface UserSettingsRow {
  activityLevel: string | null;
  goalWeightKg: string | null;
  goalRateKgPerWeek: string | null;
}

interface CompleteUserSettings {
  activityLevel: string;
  goalWeightKg: string;
  goalRateKgPerWeek: string;
}

/** Type predicate: all three goal-setting columns are non-null. */
function settingsAreComplete(
  s: UserSettingsRow | undefined,
): s is CompleteUserSettings {
  return (
    s !== undefined &&
    s.activityLevel !== null &&
    s.goalWeightKg !== null &&
    s.goalRateKgPerWeek !== null
  );
}

type EngineOut = ReturnType<typeof computeMacroTargets>;
interface WeightLog {
  weightKg: number;
  loggedDate: string;
}

/** Build the success response from a stored DB row (legacy or new engine output). */
function buildOkResponseFromRow(row: DbRow, date: string): ComputeResult {
  return {
    status: "ok",
    goals: {
      calorieGoal: row.calorieGoal,
      proteinGoal: row.proteinGoal ?? row.calorieGoal,
      carbsGoal:   row.carbsGoal   ?? 0,
      fatGoal:     row.fatGoal     ?? 0,
    },
    audit: buildAuditFromRow(row),
    ...(computeWeightStale(date, row.weightLoggedDate) ? { weightStale: true } : {}),
  };
}

/**
 * Engine-output column values written to `daily_calorie_goals`. Shared by the
 * INSERT.values() and onConflictDoUpdate.set clauses (set adds `updatedAt`).
 */
function buildEngineWriteValues(
  engineOut: EngineOut,
  userActivityLevel: string,
  userGoalWeightKg: string,
  userGoalRateKgPerWeek: string,
  weightLog: WeightLog,
) {
  return {
    calorieGoal:       engineOut.targetKcal,
    proteinGoal:       engineOut.proteinG,
    carbsGoal:         engineOut.carbsG,
    fatGoal:           engineOut.fatG,
    weightKg:          String(weightLog.weightKg),
    weightLoggedDate:  weightLog.loggedDate,
    rmr:               engineOut.rmr,
    tdee:              engineOut.tdee,
    activityLevel:     userActivityLevel,
    goalWeightKg:      userGoalWeightKg,
    goalRateKgPerWeek: userGoalRateKgPerWeek,
    deficitKcal:       engineOut.deficitKcal,
  };
}

/** Build NutritionGoalsAudit from engine output (post-compute, vs. buildAuditFromRow which builds from a stored DB row). */
function buildAuditFromEngine(
  engineOut: EngineOut,
  userActivityLevel: string,
  userGoalWeightKg: string,
  userGoalRateKgPerWeek: string,
  weightLog: WeightLog,
): NutritionGoalsAudit {
  return {
    rmr:               engineOut.rmr,
    palMultiplier:     engineOut.palMultiplier,
    tdee:              engineOut.tdee,
    weightKg:          String(weightLog.weightKg),
    weightLoggedDate:  weightLog.loggedDate,
    activityLevel:     userActivityLevel as ActivityLevel,
    goalWeightKg:      parseFloat(userGoalWeightKg),
    goalRateKgPerWeek: parseFloat(userGoalRateKgPerWeek),
    deficitKcal:       engineOut.deficitKcal,
    direction:         engineOut.direction,
  };
}

/** Build the engine-success ComputeResult. Used by both the post-write success path AND the FOO-1070 drift skip-write path. */
function buildOkResponseFromEngine(
  engineOut: EngineOut,
  userActivityLevel: string,
  userGoalWeightKg: string,
  userGoalRateKgPerWeek: string,
  weightLog: WeightLog,
  date: string,
): ComputeResult {
  return {
    status: "ok",
    goals: {
      calorieGoal: engineOut.targetKcal,
      proteinGoal: engineOut.proteinG,
      carbsGoal:   engineOut.carbsG,
      fatGoal:     engineOut.fatG,
    },
    audit: buildAuditFromEngine(
      engineOut,
      userActivityLevel,
      userGoalWeightKg,
      userGoalRateKgPerWeek,
      weightLog,
    ),
    ...(computeWeightStale(date, weightLog.loggedDate) ? { weightStale: true } : {}),
  };
}

// In-flight Promise Map keyed `${userId}:${date}` — delete on settle
const computeInFlight = new Map<string, Promise<ComputeResult>>();

// ─── Core compute ─────────────────────────────────────────────────────────────

async function doCompute(
  userId: string,
  date: string,
  log?: Logger,
): Promise<ComputeResult> {
  const l = log ?? logger;

  try {
    // ── Step 1: Read user goal settings ─────────────────────────────────────
    const userRows = await getDb()
      .select({
        activityLevel:     users.activityLevel,
        goalWeightKg:      users.goalWeightKg,
        goalRateKgPerWeek: users.goalRateKgPerWeek,
      })
      .from(users)
      .where(eq(users.id, userId));

    const userSettings = userRows[0];
    const isPast = date < getTodayDate();

    // ── Step 2: Read existing row (early — past historical rows are stable
    //           regardless of current users.* state, so we can short-circuit
    //           before the settings check covering the FOO-1062 migration
    //           cutover and the regular past-date cache hit in one branch).
    //
    // Sentinel: `proteinGoal !== null` is "row was written by the engine"
    // (FOO-1068). The new engine permits non-positive `calorieGoal` for
    // extreme rates so `> 0` would mistreat valid extreme rows as missing;
    // invalidation nulls all macro columns so `proteinGoal !== null`
    // distinguishes real engine output from invalidated rows.
    const existing = await queryRow(userId, date);

    if (isPast && existing !== null && existing.proteinGoal !== null) {
      return buildOkResponseFromRow(existing, date);
    }

    if (!settingsAreComplete(userSettings)) {
      l.debug(
        { action: "daily_goals_blocked", reason: "goals_not_set", userId, date },
        "Daily goals blocked",
      );
      return { status: "blocked", reason: "goals_not_set" };
    }

    const {
      activityLevel: userActivityLevel,
      goalWeightKg: userGoalWeightKg,
      goalRateKgPerWeek: userGoalRateKgPerWeek,
    } = userSettings;

    // Today/future cache hit (past rows already returned above).
    if (existing !== null && existing.proteinGoal !== null) {
      if (
        rowSettingsMatch(
          existing,
          userActivityLevel,
          userGoalWeightKg,
          userGoalRateKgPerWeek,
        )
      ) {
        return buildOkResponseFromRow(existing, date);
      }
      // Settings drifted → fall through to full recompute.
    }

    // ── Step 3: Read Google Health profile + weight (parallel) ──────────────
    const [profile, weightLog] = await Promise.all([
      getCachedHealthProfile(userId, l, "important"),
      getCachedHealthWeightKg(userId, date, l, "important"),
    ]);

    if (profile.sex === "NA") {
      l.warn(
        { action: "daily_goals_blocked", reason: "sex_unset", userId, date },
        "Daily goals blocked",
      );
      return { status: "blocked", reason: "sex_unset" };
    }
    if (weightLog === null) {
      l.warn(
        { action: "daily_goals_blocked", reason: "no_weight", userId, date },
        "Daily goals blocked",
      );
      return { status: "blocked", reason: "no_weight" };
    }

    // ── Step 4: Compute macros ───────────────────────────────────────────────
    const engineOut = computeMacroTargets({
      sex:               profile.sex,
      ageYears:          profile.ageYears,
      heightCm:          profile.heightCm,
      currentWeightKg:   weightLog.weightKg,
      activityLevel:     userActivityLevel as ActivityLevel,
      goalWeightKg:      parseFloat(userGoalWeightKg),
      goalRateKgPerWeek: parseFloat(userGoalRateKgPerWeek),
    });

    // FOO-1070: re-read users.* immediately before the write to catch a
    // settings PATCH that fired during our compute. Without this, a stale
    // doCompute racing with a settings PATCH could write its pre-PATCH input:
    // the setWhere CAS only protects the conflict path, but if the PATCH's
    // invalidation DELETED the row, the INSERT bypasses conflict entirely.
    // The recheck closes the conflict-time race; the residual recheck→INSERT
    // µs window is acceptable for the family-scale workload.
    const freshUserRows = await getDb()
      .select({
        activityLevel:     users.activityLevel,
        goalWeightKg:      users.goalWeightKg,
        goalRateKgPerWeek: users.goalRateKgPerWeek,
      })
      .from(users)
      .where(eq(users.id, userId));
    const fresh = freshUserRows[0];
    const stillFresh =
      fresh !== undefined &&
      fresh.activityLevel     === userActivityLevel &&
      fresh.goalWeightKg      === userGoalWeightKg &&
      fresh.goalRateKgPerWeek === userGoalRateKgPerWeek;

    if (!stillFresh) {
      l.debug(
        { action: "daily_goals_compute_skipped_write_drift", userId, date },
        "settings drifted during compute — returning fresh values without persisting",
      );
      return buildOkResponseFromEngine(
        engineOut,
        userActivityLevel,
        userGoalWeightKg,
        userGoalRateKgPerWeek,
        weightLog,
        date,
      );
    }

    // ── Step 5: UPSERT ───────────────────────────────────────────────────────
    const writeValues = buildEngineWriteValues(
      engineOut,
      userActivityLevel,
      userGoalWeightKg,
      userGoalRateKgPerWeek,
      weightLog,
    );
    await getDb()
      .insert(dailyCalorieGoals)
      .values({ userId, date, ...writeValues })
      .onConflictDoUpdate({
        target: [dailyCalorieGoals.userId, dailyCalorieGoals.date],
        set: { ...writeValues, updatedAt: new Date() },
        // FOO-1066/1067/1068: atomic compare-and-swap — only overwrite if our
        // input still matches `users.*` AT WRITE TIME via an EXISTS subquery.
        // This single predicate covers every case correctly:
        //   - FOO-1066 stale-compute race: pre-PATCH compute's input no longer
        //     matches users.* (which was updated by PATCH) → predicate FALSE,
        //     UPDATE skipped, fresher row preserved.
        //   - FOO-1067 invalidated row: invalidate left the row as
        //     calorieGoal=0/null-settings; our compute's input matches users.*
        //     → predicate TRUE, UPDATE proceeds, row is rewritten.
        //   - drift-recompute (settings changed without invalidation, e.g.
        //     crash mid-PATCH or direct DB write): the rowSettingsMatch fail
        //     above made us recompute with current users.*; predicate TRUE,
        //     UPDATE proceeds.
        //   - idempotent recompute: input == users.* trivially, predicate
        //     TRUE, UPDATE is a no-op overwrite.
        // Postgres evaluates EXISTS as part of the same statement, so there
        // is no TOCTOU window between the check and the UPDATE.
        setWhere: sql`EXISTS (
          SELECT 1 FROM ${users}
          WHERE ${users.id} = ${userId}
            AND ${users.activityLevel} = ${userActivityLevel}
            AND ${users.goalWeightKg} = ${userGoalWeightKg}
            AND ${users.goalRateKgPerWeek} = ${userGoalRateKgPerWeek}
        )`,
      });

    l.info(
      {
        action: "daily_goals_computed",
        userId,
        date,
        direction: engineOut.direction,
        targetKcal: engineOut.targetKcal,
      },
      "daily goals computed",
    );

    return buildOkResponseFromEngine(
      engineOut,
      userActivityLevel,
      userGoalWeightKg,
      userGoalRateKgPerWeek,
      weightLog,
      date,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    // Note: SEX_UNSET is not handled here — `profile.sex === "NA"` is checked
    // and short-circuited before computeMacroTargets is called, so the engine
    // never reaches its SEX_UNSET throw path from this caller.
    let reason: "scope_mismatch" | "invalid_profile" | null = null;
    if (errorMessage === "HEALTH_SCOPE_MISSING") reason = "scope_mismatch";
    else if (errorMessage === "INVALID_PROFILE_DATA") reason = "invalid_profile";
    else if (errorMessage === "INVALID_GOAL_RATE") reason = "invalid_profile";

    if (reason !== null) {
      l.warn(
        { action: "daily_goals_blocked", reason, userId, date, errorMessage },
        "Daily goals blocked",
      );
      return { status: "blocked", reason };
    }
    throw error;
  }
}

// Non-async so concurrent callers receive the EXACT same Promise object reference
export function getOrComputeDailyGoals(
  userId: string,
  date: string,
  log?: Logger,
): Promise<ComputeResult> {
  const key = `${userId}:${date}`;
  const inflight = computeInFlight.get(key);
  if (inflight) return inflight;

  const promise = doCompute(userId, date, log).finally(() =>
    computeInFlight.delete(key),
  );
  computeInFlight.set(key, promise);
  return promise;
}

// ─── Invalidation ─────────────────────────────────────────────────────────────

/**
 * Delete daily_calorie_goals rows for the user from `fromDate` forward.
 * Called from the daily-goals-settings PATCH route after the user updates
 * their activity level, goal weight, or goal rate.
 */
export async function invalidateUserDailyGoalsForSettingsChange(
  userId: string,
  fromDate: string,
): Promise<void> {
  // Clear in-flight promises for this user at fromDate and after
  for (const key of computeInFlight.keys()) {
    if (key.startsWith(`${userId}:`)) {
      const dateSuffix = key.slice(userId.length + 1);
      if (dateSuffix >= fromDate) {
        computeInFlight.delete(key);
      }
    }
  }

  await getDb()
    .delete(dailyCalorieGoals)
    .where(
      and(
        eq(dailyCalorieGoals.userId, userId),
        gte(dailyCalorieGoals.date, fromDate),
      ),
    );
}

/**
 * Reset macro/audit columns for ONE specific (userId, date) row, scoped to a
 * Google Health data refresh (FOO-992). Drops the in-flight compute key for that
 * date and zeroes the row so the next read forces a fresh compute under
 * up-to-date Google Health inputs.
 */
export async function invalidateUserDailyGoalsForDate(
  userId: string,
  date: string,
): Promise<void> {
  computeInFlight.delete(`${userId}:${date}`);

  await getDb()
    .update(dailyCalorieGoals)
    .set({
      calorieGoal:       0,
      proteinGoal:       null,
      carbsGoal:         null,
      fatGoal:           null,
      weightKg:          null,
      rmr:               null,
      weightLoggedDate:  null,
      activityLevel:     null,
      goalWeightKg:      null,
      goalRateKgPerWeek: null,
      tdee:              null,
      deficitKcal:       null,
      updatedAt:         new Date(),
    })
    .where(and(eq(dailyCalorieGoals.userId, userId), eq(dailyCalorieGoals.date, date)));
}

// ─── Accessors ────────────────────────────────────────────────────────────────

export async function getDailyGoalsByDate(
  userId: string,
  date: string,
): Promise<{
  date: string;
  calorieGoal: number;
  proteinGoal: number | null;
  carbsGoal: number | null;
  fatGoal: number | null;
  weightKg: string | null;
  rmr: number | null;
  tdee: number | null;
} | null> {
  const rows = await getDb()
    .select({
      date:        dailyCalorieGoals.date,
      calorieGoal: dailyCalorieGoals.calorieGoal,
      proteinGoal: dailyCalorieGoals.proteinGoal,
      carbsGoal:   dailyCalorieGoals.carbsGoal,
      fatGoal:     dailyCalorieGoals.fatGoal,
      weightKg:    dailyCalorieGoals.weightKg,
      rmr:         dailyCalorieGoals.rmr,
      tdee:        dailyCalorieGoals.tdee,
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
      carbsG:   result.goals.carbsGoal,
      fatG:     result.goals.fatGoal,
      status:   "ok",
      ...(result.audit ? { audit: result.audit } : {}),
      ...(result.weightStale ? { weightStale: true } : {}),
    };
  }
  return {
    calories: null,
    proteinG: null,
    carbsG:   null,
    fatG:     null,
    status:   "blocked",
    reason:   result.reason,
  };
}
