import type { ActivityLevel, MacroEngineInputs, MacroEngineOutputs } from "@/types";

// ─── PAL lookup table ─────────────────────────────────────────────────────────

export const PAL_BY_ACTIVITY_LEVEL: Record<ActivityLevel, number> = {
  sedentary:    1.2,
  light:        1.375,
  moderate:     1.55,
  very_active:  1.725,
  extra_active: 1.9,
};

export const ACTIVITY_LEVEL_LABELS: Record<ActivityLevel, string> = {
  sedentary:    "Sedentary",
  light:        "Light",
  moderate:     "Moderate",
  very_active:  "Very active",
  extra_active: "Extra active",
};

// ─── Macro constants ──────────────────────────────────────────────────────────

export const PROTEIN_PER_KG_LOSE     = 2.2;
export const PROTEIN_PER_KG_MAINTAIN = 1.6;
export const PROTEIN_PER_KG_GAIN     = 1.8;
export const FAT_PER_KG              = 0.8;
export const FAT_MIN_PERCENT_KCAL    = 0.25;
export const CARB_FLOOR_GRAMS        = 130;
export const KCAL_PER_KG             = 7700;

// ─── RMR (Mifflin-St Jeor) ────────────────────────────────────────────────────

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

// ─── Goal-anchored macro targets ──────────────────────────────────────────────

/**
 * Compute macro targets from declared goal inputs.
 *
 * Throws:
 * - "SEX_UNSET" if sex === "NA"
 * - "INVALID_PROFILE_DATA" if any biometric input is non-finite or non-positive
 * - "INVALID_GOAL_RATE" if goalRateKgPerWeek < 0 or non-finite
 */
export function computeMacroTargets(inputs: MacroEngineInputs): MacroEngineOutputs {
  const {
    sex,
    ageYears,
    heightCm,
    currentWeightKg,
    activityLevel,
    goalWeightKg,
    goalRateKgPerWeek,
  } = inputs;

  if (sex === "NA") {
    throw new Error("SEX_UNSET");
  }

  if (
    !Number.isFinite(ageYears)  || ageYears  <= 0 ||
    !Number.isFinite(heightCm)  || heightCm  <= 0 ||
    !Number.isFinite(currentWeightKg) || currentWeightKg <= 0
  ) {
    throw new Error("INVALID_PROFILE_DATA");
  }

  if (!Number.isFinite(goalRateKgPerWeek) || goalRateKgPerWeek < 0) {
    throw new Error("INVALID_GOAL_RATE");
  }

  // ── Core calculations ──────────────────────────────────────────────────────

  const rmr = computeRmr(sex, ageYears, heightCm, currentWeightKg);
  const palMultiplier = PAL_BY_ACTIVITY_LEVEL[activityLevel];
  const tdee = Math.round(rmr * palMultiplier);

  // Direction: derived from currentWeight vs goalWeight; rate=0 forces MAINTAIN
  let direction: "LOSE" | "MAINTAIN" | "GAIN";
  if (goalRateKgPerWeek === 0) {
    direction = "MAINTAIN";
  } else if (currentWeightKg > goalWeightKg) {
    direction = "LOSE";
  } else if (currentWeightKg < goalWeightKg) {
    direction = "GAIN";
  } else {
    direction = "MAINTAIN";
  }

  // Daily calorie offset (no safety clamp)
  const kcalPerDay = Math.round(goalRateKgPerWeek * (KCAL_PER_KG / 7)); // = rate × 1100

  let targetKcal: number;
  let deficitKcal: number;

  if (direction === "LOSE") {
    targetKcal  = tdee - kcalPerDay;
    deficitKcal = -kcalPerDay;
  } else if (direction === "GAIN") {
    targetKcal  = tdee + kcalPerDay;
    deficitKcal = kcalPerDay;
  } else {
    targetKcal  = tdee;
    deficitKcal = 0;
  }

  // ── Macros ────────────────────────────────────────────────────────────────

  // Protein: single coefficient per direction, anchored to current body weight
  const proteinCoeff =
    direction === "LOSE"     ? PROTEIN_PER_KG_LOSE :
    direction === "GAIN"     ? PROTEIN_PER_KG_GAIN :
                               PROTEIN_PER_KG_MAINTAIN;
  const proteinG = Math.round(proteinCoeff * currentWeightKg);

  // Fat: weight-anchored floor with a percent-of-target floor
  const fatFromWeight = currentWeightKg * FAT_PER_KG;
  const fatFromKcal   = (targetKcal * FAT_MIN_PERCENT_KCAL) / 9;
  const fatG = Math.round(Math.max(fatFromWeight, fatFromKcal));

  // Carbs: residual with a 130g floor and a 10%-of-target floor
  const carbsResidual  = (targetKcal - proteinG * 4 - fatG * 9) / 4;
  const carbsFloor10pct = (targetKcal * 0.10) / 4;
  const carbsG = Math.round(Math.max(carbsResidual, CARB_FLOOR_GRAMS, carbsFloor10pct));

  return {
    targetKcal,
    proteinG,
    carbsG,
    fatG,
    rmr,
    palMultiplier,
    tdee,
    deficitKcal,
    direction,
  };
}
