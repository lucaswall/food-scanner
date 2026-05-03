// Stub — real implementation created by Worker 2 (FOO-971).
// This file is replaced when Worker 2's branch is merged before Worker 3.
import type { Logger } from "@/lib/logger";
import type { MacroGoalType } from "@/types";

export interface FitbitProfileCached {
  sex: "MALE" | "FEMALE" | "NA";
  ageYears: number;
  heightCm: number;
}

export interface FitbitWeightGoalCached {
  goalType: MacroGoalType;
}

export interface FitbitActivitySummaryCached {
  caloriesOut: number | null;
}

export async function getCachedFitbitProfile(
  _userId: string,
  _log?: Logger
): Promise<FitbitProfileCached> {
  throw new Error("fitbit-cache stub: not implemented");
}

export async function getCachedFitbitWeightKg(
  _userId: string,
  _date: string,
  _log?: Logger
): Promise<number | null> {
  throw new Error("fitbit-cache stub: not implemented");
}

export async function getCachedFitbitWeightGoal(
  _userId: string,
  _log?: Logger
): Promise<FitbitWeightGoalCached | null> {
  throw new Error("fitbit-cache stub: not implemented");
}

export async function getCachedActivitySummary(
  _userId: string,
  _date: string,
  _log?: Logger
): Promise<FitbitActivitySummaryCached | null> {
  throw new Error("fitbit-cache stub: not implemented");
}

export function invalidateFitbitProfileCache(_userId: string): void {
  // stub
}
