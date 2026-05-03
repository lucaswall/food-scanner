import type { MacroEngineInputs, MacroEngineOutputs } from "@/types";

/** Fitbit caloriesOut overestimate haircut — wrist-device validations show ~23–27% overshoot */
export const ACTIVITY_MULTIPLIER = 0.85;

export const PROTEIN_COEFFICIENTS: Record<
  "lt25" | "25to30" | "ge30",
  Record<"LOSE" | "MAINTAIN" | "GAIN", number>
> = {
  lt25:   { LOSE: 2.2, MAINTAIN: 1.6, GAIN: 1.8 },
  "25to30": { LOSE: 2.0, MAINTAIN: 1.6, GAIN: 1.8 },
  ge30:   { LOSE: 1.8, MAINTAIN: 1.6, GAIN: 1.6 },
};

export const CARB_FLOOR_GRAMS = 130;

export const FAT_PERCENT_OF_KCAL = 0.25;

export const GOAL_MULTIPLIERS: Record<"LOSE" | "MAINTAIN" | "GAIN", number> = {
  LOSE:     0.80,
  MAINTAIN: 1.00,
  GAIN:     1.10,
};

/**
 * Compute macro targets from biometric inputs.
 * Throws "SEX_UNSET" if sex is "NA" — engine never silently picks a sex.
 */
export function computeMacroTargets(inputs: MacroEngineInputs): MacroEngineOutputs {
  const { ageYears, sex, heightCm, weightKg, caloriesOut, goalType } = inputs;

  if (sex === "NA") {
    throw new Error("SEX_UNSET");
  }

  if (heightCm <= 0 || weightKg <= 0 || ageYears <= 0) {
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
  const bmiTier: "lt25" | "25to30" | "ge30" =
    bmi < 25 ? "lt25" : bmi < 30 ? "25to30" : "ge30";

  // Macros
  const proteinG = Math.round(weightKg * PROTEIN_COEFFICIENTS[bmiTier][goalType]);

  const fatFromWeight = weightKg * 0.8;
  const fatFromKcal = (targetKcal * FAT_PERCENT_OF_KCAL) / 9;
  const fatG = Math.round(Math.max(fatFromWeight, fatFromKcal));

  const carbsResidual = (targetKcal - proteinG * 4 - fatG * 9) / 4;
  const carbs10Pct = (0.10 * targetKcal) / 4;
  const carbsG = Math.round(Math.max(carbsResidual, CARB_FLOOR_GRAMS, carbs10Pct));

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
