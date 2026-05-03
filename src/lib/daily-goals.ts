import { getDb } from "@/db/index";
import { dailyCalorieGoals } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { computeMacroTargets, PROTEIN_COEFFICIENTS } from "@/lib/macro-engine";
import {
  getCachedFitbitProfile,
  getCachedFitbitWeightKg,
  getCachedFitbitWeightGoal,
  getCachedActivitySummary,
} from "@/lib/fitbit-cache";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import type { MacroGoalType } from "@/types";

type BmiTier = "lt25" | "25to30" | "ge30";

interface DbRow {
  calorieGoal: number;
  proteinGoal: number | null;
  carbsGoal: number | null;
  fatGoal: number | null;
  weightKg: string | null;
  caloriesOut: number | null;
  rmr: number | null;
  activityKcal: number | null;
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
      };
    }
  | { status: "partial"; proteinG: number; fatG: number }
  | { status: "blocked"; reason: "no_weight" | "sex_unset" | "scope_mismatch" };

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
    row.activityKcal !== null
  );
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
    if (existing && hasMacros(existing)) {
      // Re-fetch profile + weight goal from process-level cache (no real API call)
      const [profile, weightGoal] = await Promise.all([
        getCachedFitbitProfile(userId, l),
        getCachedFitbitWeightGoal(userId, l),
      ]);
      const wKg = existing.weightKg ? parseFloat(existing.weightKg) : 0;
      const bmiTier = getBmiTier(wKg, profile.heightCm);
      const tdee = (existing.rmr ?? 0) + (existing.activityKcal ?? 0);

      return {
        status: "ok",
        goals: {
          calorieGoal: existing.calorieGoal,
          proteinGoal: existing.proteinGoal!,
          carbsGoal: existing.carbsGoal!,
          fatGoal: existing.fatGoal!,
        },
        audit: {
          rmr: existing.rmr!,
          activityKcal: existing.activityKcal!,
          tdee,
          weightKg: existing.weightKg ?? String(wKg),
          bmiTier,
          goalType: weightGoal?.goalType ?? "MAINTAIN",
        },
      };
    }

    // Fetch from Fitbit (uses process-level TTL cache internally)
    const [profile, weightKg, weightGoal, activity] = await Promise.all([
      getCachedFitbitProfile(userId, l),
      getCachedFitbitWeightKg(userId, date, l),
      getCachedFitbitWeightGoal(userId, l),
      getCachedActivitySummary(userId, date, l),
    ]);

    if (profile.sex === "NA") {
      return { status: "blocked", reason: "sex_unset" };
    }
    if (weightKg === null) {
      return { status: "blocked", reason: "no_weight" };
    }

    const goalType: MacroGoalType = weightGoal?.goalType ?? "MAINTAIN";
    const bmiTier = getBmiTier(weightKg, profile.heightCm);

    if (activity === null || activity.caloriesOut === null || activity.caloriesOut === undefined) {
      // Partial: compute protein/fat without a full calorie target (no caloriesOut yet)
      const proteinG = Math.round(weightKg * PROTEIN_COEFFICIENTS[bmiTier][goalType]);
      const fatG = Math.round(weightKg * 0.8);
      return { status: "partial", proteinG, fatG };
    }

    // Full compute
    const engineOut = computeMacroTargets({
      ageYears: profile.ageYears,
      sex: profile.sex,
      heightCm: profile.heightCm,
      weightKg,
      caloriesOut: activity.caloriesOut,
      goalType,
    });

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
      })
      .onConflictDoNothing();

    // Read back the row (may be the one we inserted or an older conflict row)
    const row = await queryRow(userId, date);

    // If the read-back row is missing macros (Lumen-backfilled or pre-feature row),
    // update only macro+audit columns — keep the existing calorieGoal intact
    if (row && !hasMacros(row)) {
      await getDb()
        .update(dailyCalorieGoals)
        .set({
          proteinGoal: engineOut.proteinG,
          carbsGoal: engineOut.carbsG,
          fatGoal: engineOut.fatG,
          weightKg: String(weightKg),
          caloriesOut: activity.caloriesOut,
          rmr: engineOut.rmr,
          activityKcal: engineOut.activityKcal,
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
        calorieGoal: row?.calorieGoal ?? engineOut.targetKcal,
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
      },
    };
  } catch (error) {
    if (error instanceof Error && error.message === "FITBIT_SCOPE_MISSING") {
      return { status: "blocked", reason: "scope_mismatch" };
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
