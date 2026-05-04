import type { BmiTier, MacroEngineInputs, MacroEngineOutputs, MacroGoalType } from "@/types";
import { logger as defaultLogger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

export type { BmiTier };

/** Fitbit caloriesOut overestimate haircut — wrist-device validations show ~23–27% overshoot */
export const ACTIVITY_MULTIPLIER = 0.85;

export const GOAL_MULTIPLIERS: Record<MacroGoalType, number> = {
  LOSE:     0.80,
  MAINTAIN: 1.00,
  GAIN:     1.10,
};

export interface MacroProfile {
  /** Display name for UI */
  name: string;
  /** Protein g/kg of total bodyweight, indexed by BMI tier × goal */
  proteinCoefficients: Record<BmiTier, Record<MacroGoalType, number>>;
  /** Which macro absorbs leftover calories after protein + the anchored macro */
  residualMacro: "carbs" | "fat";
  /** Carbs (g) — when residualMacro="carbs" this is the floor; when "fat" this is the fixed target */
  carbGrams: number;
  /** Used only when residualMacro="carbs": fat = max(weightKg * factor, target * pct / 9) */
  fatPerKgFactor: number;
  fatPercentOfKcal: number;
}

/** High-protein, carb-floor, fat as residual. Sports-nutrition / muscle-preservation school. */
export const MACRO_PROFILE_MUSCLE_PRESERVE: MacroProfile = {
  name: "Muscle Preserve",
  proteinCoefficients: {
    lt25:    { LOSE: 2.2, MAINTAIN: 1.6, GAIN: 1.8 },
    "25to30":{ LOSE: 2.0, MAINTAIN: 1.6, GAIN: 1.8 },
    ge30:    { LOSE: 1.8, MAINTAIN: 1.6, GAIN: 1.6 },
  },
  residualMacro: "carbs",
  carbGrams: 130,
  fatPerKgFactor: 0.8,
  fatPercentOfKcal: 0.25,
};

/** Moderate-protein, low-carb, fat as residual. RER / Lumen / metabolic-flexibility school. */
export const MACRO_PROFILE_METABOLIC_FLEX: MacroProfile = {
  name: "Metabolic Flex",
  proteinCoefficients: {
    lt25:    { LOSE: 1.4, MAINTAIN: 1.2, GAIN: 1.4 },
    "25to30":{ LOSE: 1.3, MAINTAIN: 1.2, GAIN: 1.4 },
    ge30:    { LOSE: 1.2, MAINTAIN: 1.0, GAIN: 1.2 },
  },
  residualMacro: "fat",
  carbGrams: 80,
  fatPerKgFactor: 1.2,
  fatPercentOfKcal: 0.40,
};

/** Default profile when a user hasn't picked one — keeps existing behavior on first load. */
export const DEFAULT_MACRO_PROFILE: MacroProfile = MACRO_PROFILE_MUSCLE_PRESERVE;

/** Database key → profile lookup. Source of truth for valid macro_profile column values. */
export const MACRO_PROFILES_BY_KEY = {
  muscle_preserve: MACRO_PROFILE_MUSCLE_PRESERVE,
  metabolic_flex: MACRO_PROFILE_METABOLIC_FLEX,
} as const satisfies Record<string, MacroProfile>;

export type MacroProfileKey = keyof typeof MACRO_PROFILES_BY_KEY;

export const MACRO_PROFILE_KEYS: readonly MacroProfileKey[] = [
  "muscle_preserve",
  "metabolic_flex",
];

export function isMacroProfileKey(value: unknown): value is MacroProfileKey {
  return typeof value === "string" && value in MACRO_PROFILES_BY_KEY;
}

/**
 * Render a human-readable description of a macro profile, derived from its
 * coefficients. Surfaces in `MacroProfileCard` so the description stays in
 * sync if engine constants change (FOO-1006).
 */
export function describeProfile(profile: MacroProfile): string {
  const allCoeffs = Object.values(profile.proteinCoefficients).flatMap((tier) =>
    Object.values(tier),
  );
  const minProtein = Math.min(...allCoeffs).toFixed(1);
  const maxProtein = Math.max(...allCoeffs).toFixed(1);
  const carbDescriptor =
    profile.residualMacro === "carbs"
      ? `${profile.carbGrams} g carb floor`
      : `${profile.carbGrams} g carbs`;
  const school =
    profile.residualMacro === "carbs"
      ? "Sports-nutrition / muscle-preservation"
      : "Lumen / metabolic-flexibility";
  return `Protein ${minProtein}–${maxProtein} g/kg with a ${carbDescriptor}. ${school} school.`;
}

export function getMacroProfile(
  key: MacroProfileKey | string | null | undefined,
  log: Logger = defaultLogger,
): MacroProfile {
  if (key === null || key === undefined) return DEFAULT_MACRO_PROFILE;
  if (key in MACRO_PROFILES_BY_KEY) {
    return MACRO_PROFILES_BY_KEY[key as MacroProfileKey];
  }
  log.warn(
    { action: "macro_profile_invalid_key", key },
    "users.macro_profile holds an unknown key — falling back to default. CHECK constraint should prevent this.",
  );
  return DEFAULT_MACRO_PROFILE;
}

/** Mifflin-St Jeor RMR. Inputs MUST be finite and positive (caller validates). */
export function computeRmr(
  sex: "MALE" | "FEMALE",
  ageYears: number,
  heightCm: number,
  weightKg: number,
): number {
  const rmrRaw =
    sex === "MALE"
      ? 10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161;
  return Math.round(rmrRaw);
}

/**
 * Compute macro targets from biometric inputs.
 * Throws "SEX_UNSET" if sex is "NA" — engine never silently picks a sex.
 *
 * `profile` defaults to DEFAULT_MACRO_PROFILE; production callers should pass
 * the user's chosen profile (looked up from users.macro_profile).
 */
export function computeMacroTargets(
  inputs: MacroEngineInputs,
  profile: MacroProfile = DEFAULT_MACRO_PROFILE,
): MacroEngineOutputs {
  const { ageYears, sex, heightCm, weightKg, caloriesOut, goalType } = inputs;

  if (sex === "NA") {
    throw new Error("SEX_UNSET");
  }

  if (
    !Number.isFinite(heightCm) ||
    !Number.isFinite(weightKg) ||
    !Number.isFinite(ageYears) ||
    heightCm <= 0 ||
    weightKg <= 0 ||
    ageYears <= 0
  ) {
    throw new Error("INVALID_PROFILE_DATA");
  }

  // 30000 kcal/day is well above the documented Tour-de-France ceiling (~9000),
  // so anything above that is bogus Fitbit data. Negative/NaN/Infinity always bogus.
  if (!Number.isFinite(caloriesOut) || caloriesOut < 0 || caloriesOut > 30000) {
    throw new Error("INVALID_ACTIVITY_DATA");
  }

  const rmr = computeRmr(sex, ageYears, heightCm, weightKg);

  // Activity calories with overshoot haircut
  const rawActivityKcal = Math.max(0, caloriesOut - rmr) * ACTIVITY_MULTIPLIER;
  const activityKcal = Math.round(rawActivityKcal);

  const tdee = rmr + activityKcal;

  const targetKcal = Math.round(tdee * GOAL_MULTIPLIERS[goalType]);

  // BMI tier
  const heightM = heightCm / 100;
  const bmi = weightKg / (heightM * heightM);
  const bmiTier: BmiTier =
    bmi < 25 ? "lt25" : bmi < 30 ? "25to30" : "ge30";

  // Protein (anchored in both profiles)
  const proteinG = Math.round(weightKg * profile.proteinCoefficients[bmiTier][goalType]);

  let carbsG: number;
  let fatG: number;

  if (profile.residualMacro === "carbs") {
    // Muscle-preserve: fat anchored, carbs absorb residual with a floor.
    const fatFromWeight = weightKg * profile.fatPerKgFactor;
    const fatFromKcal = (targetKcal * profile.fatPercentOfKcal) / 9;
    fatG = Math.round(Math.max(fatFromWeight, fatFromKcal));

    const carbsResidual = (targetKcal - proteinG * 4 - fatG * 9) / 4;
    const carbs10Pct = (0.10 * targetKcal) / 4;
    carbsG = Math.round(Math.max(carbsResidual, profile.carbGrams, carbs10Pct));
  } else {
    // Metabolic-flex: carbs fixed (low), fat absorbs residual.
    carbsG = profile.carbGrams;
    const fatRaw = (targetKcal - proteinG * 4 - carbsG * 4) / 9;
    fatG = Math.round(Math.max(0, fatRaw));
  }

  return {
    targetKcal,
    proteinG,
    carbsG,
    fatG,
    rmr,
    activityKcal,
    tdee,
    bmiTier,
  };
}
