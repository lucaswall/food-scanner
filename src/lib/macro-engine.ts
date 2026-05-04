import type { MacroEngineInputs, MacroEngineOutputs, MacroGoalType } from "@/types";

/** Fitbit caloriesOut overestimate haircut — wrist-device validations show ~23–27% overshoot */
export const ACTIVITY_MULTIPLIER = 0.85;

export const GOAL_MULTIPLIERS: Record<MacroGoalType, number> = {
  LOSE:     0.80,
  MAINTAIN: 1.00,
  GAIN:     1.10,
};

export type BmiTier = "lt25" | "25to30" | "ge30";

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

export function getMacroProfile(key: MacroProfileKey | null | undefined): MacroProfile {
  if (key && key in MACRO_PROFILES_BY_KEY) return MACRO_PROFILES_BY_KEY[key];
  return DEFAULT_MACRO_PROFILE;
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

  // Mifflin-St Jeor RMR
  const rmrRaw =
    sex === "MALE"
      ? 10 * weightKg + 6.25 * heightCm - 5 * ageYears + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * ageYears - 161;
  const rmr = Math.round(rmrRaw);

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
