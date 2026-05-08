import { describe, it, expect } from "vitest";
import {
  computeRmr,
  computeMacroTargets,
  PAL_BY_ACTIVITY_LEVEL,
  ACTIVITY_LEVEL_LABELS,
  PROTEIN_PER_KG_LOSE,
  PROTEIN_PER_KG_MAINTAIN,
  PROTEIN_PER_KG_GAIN,
  FAT_PER_KG,
  FAT_MIN_PERCENT_KCAL,
  CARB_FLOOR_GRAMS,
  KCAL_PER_KG,
} from "@/lib/macro-engine";
import type { ActivityLevel } from "@/types";

// ─── RMR (Mifflin-St Jeor — unchanged) ───────────────────────────────────────

describe("computeRmr", () => {
  it("computes correct RMR for a male", () => {
    // 10*70 + 6.25*175 - 5*30 + 5 = 700 + 1093.75 - 150 + 5 = 1648.75 → 1649
    expect(computeRmr("MALE", 30, 175, 70)).toBe(1649);
  });

  it("computes correct RMR for a female", () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25 → 1345
    expect(computeRmr("FEMALE", 25, 165, 60)).toBe(1345);
  });

  it("rounds to nearest integer", () => {
    const result = computeRmr("MALE", 30, 175, 70);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("matches canonical scenario: 49y/M/176cm/121kg", () => {
    // 10*121 + 6.25*176 - 5*49 + 5 = 1210 + 1100 - 245 + 5 = 2070
    expect(computeRmr("MALE", 49, 176, 121)).toBe(2070);
  });
});

// ─── PAL lookup ───────────────────────────────────────────────────────────────

describe("PAL_BY_ACTIVITY_LEVEL", () => {
  it("sedentary = 1.2", () => expect(PAL_BY_ACTIVITY_LEVEL.sedentary).toBe(1.2));
  it("light = 1.375", () => expect(PAL_BY_ACTIVITY_LEVEL.light).toBe(1.375));
  it("moderate = 1.55", () => expect(PAL_BY_ACTIVITY_LEVEL.moderate).toBe(1.55));
  it("very_active = 1.725", () => expect(PAL_BY_ACTIVITY_LEVEL.very_active).toBe(1.725));
  it("extra_active = 1.9", () => expect(PAL_BY_ACTIVITY_LEVEL.extra_active).toBe(1.9));

  it("covers all ActivityLevel values", () => {
    const levels: ActivityLevel[] = ["sedentary", "light", "moderate", "very_active", "extra_active"];
    for (const level of levels) {
      expect(PAL_BY_ACTIVITY_LEVEL[level]).toBeGreaterThan(1);
    }
  });
});

// ─── ACTIVITY_LEVEL_LABELS ────────────────────────────────────────────────────

describe("ACTIVITY_LEVEL_LABELS", () => {
  it("has correct display labels", () => {
    expect(ACTIVITY_LEVEL_LABELS.sedentary).toBe("Sedentary");
    expect(ACTIVITY_LEVEL_LABELS.light).toBe("Light");
    expect(ACTIVITY_LEVEL_LABELS.moderate).toBe("Moderate");
    expect(ACTIVITY_LEVEL_LABELS.very_active).toBe("Very active");
    expect(ACTIVITY_LEVEL_LABELS.extra_active).toBe("Extra active");
  });
});

// ─── Engine constants ─────────────────────────────────────────────────────────

describe("engine constants", () => {
  it("PROTEIN_PER_KG_LOSE = 2.2", () => expect(PROTEIN_PER_KG_LOSE).toBe(2.2));
  it("PROTEIN_PER_KG_MAINTAIN = 1.6", () => expect(PROTEIN_PER_KG_MAINTAIN).toBe(1.6));
  it("PROTEIN_PER_KG_GAIN = 1.8", () => expect(PROTEIN_PER_KG_GAIN).toBe(1.8));
  it("FAT_PER_KG = 0.8", () => expect(FAT_PER_KG).toBe(0.8));
  it("FAT_MIN_PERCENT_KCAL = 0.25", () => expect(FAT_MIN_PERCENT_KCAL).toBe(0.25));
  it("CARB_FLOOR_GRAMS = 130", () => expect(CARB_FLOOR_GRAMS).toBe(130));
  it("KCAL_PER_KG = 7700", () => expect(KCAL_PER_KG).toBe(7700));
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe("computeMacroTargets — input validation", () => {
  const baseInputs = {
    sex: "MALE" as const,
    ageYears: 30,
    heightCm: 175,
    currentWeightKg: 70,
    activityLevel: "moderate" as const,
    goalWeightKg: 65,
    goalRateKgPerWeek: 0.5,
  };

  describe("SEX_UNSET", () => {
    it("throws SEX_UNSET when sex is NA", () => {
      expect(() => computeMacroTargets({ ...baseInputs, sex: "NA" })).toThrow("SEX_UNSET");
    });
  });

  describe("INVALID_PROFILE_DATA", () => {
    it("throws when heightCm is 0", () => {
      expect(() => computeMacroTargets({ ...baseInputs, heightCm: 0 })).toThrow("INVALID_PROFILE_DATA");
    });

    it("throws when currentWeightKg is 0", () => {
      expect(() => computeMacroTargets({ ...baseInputs, currentWeightKg: 0 })).toThrow("INVALID_PROFILE_DATA");
    });

    it("throws when ageYears is negative", () => {
      expect(() => computeMacroTargets({ ...baseInputs, ageYears: -1 })).toThrow("INVALID_PROFILE_DATA");
    });

    it("throws on NaN weight", () => {
      expect(() => computeMacroTargets({ ...baseInputs, currentWeightKg: NaN })).toThrow("INVALID_PROFILE_DATA");
    });

    it("throws on Infinity height", () => {
      expect(() => computeMacroTargets({ ...baseInputs, heightCm: Infinity })).toThrow("INVALID_PROFILE_DATA");
    });

    it("throws on NaN ageYears", () => {
      expect(() => computeMacroTargets({ ...baseInputs, ageYears: NaN })).toThrow("INVALID_PROFILE_DATA");
    });

    it("throws when goalWeightKg is 0", () => {
      expect(() => computeMacroTargets({ ...baseInputs, goalWeightKg: 0 })).toThrow("INVALID_PROFILE_DATA");
    });

    it("throws on NaN goalWeightKg", () => {
      expect(() => computeMacroTargets({ ...baseInputs, goalWeightKg: NaN })).toThrow("INVALID_PROFILE_DATA");
    });

    it("throws on Infinity goalWeightKg", () => {
      expect(() => computeMacroTargets({ ...baseInputs, goalWeightKg: Infinity })).toThrow("INVALID_PROFILE_DATA");
    });
  });

  describe("INVALID_GOAL_RATE", () => {
    it("throws when goalRateKgPerWeek is negative", () => {
      expect(() => computeMacroTargets({ ...baseInputs, goalRateKgPerWeek: -0.5 })).toThrow("INVALID_GOAL_RATE");
    });

    it("throws when goalRateKgPerWeek is NaN", () => {
      expect(() => computeMacroTargets({ ...baseInputs, goalRateKgPerWeek: NaN })).toThrow("INVALID_GOAL_RATE");
    });

    it("throws when goalRateKgPerWeek is Infinity", () => {
      expect(() => computeMacroTargets({ ...baseInputs, goalRateKgPerWeek: Infinity })).toThrow("INVALID_GOAL_RATE");
    });

    it("accepts goalRateKgPerWeek = 0 (MAINTAIN override)", () => {
      expect(() => computeMacroTargets({ ...baseInputs, goalRateKgPerWeek: 0 })).not.toThrow();
    });
  });
});

// ─── TDEE computation ─────────────────────────────────────────────────────────

describe("computeMacroTargets — TDEE", () => {
  it("TDEE = round(RMR × PAL) for sedentary", () => {
    // RMR for 30y/M/175cm/70kg:
    // 10*70 + 6.25*175 - 5*30 + 5 = 1648.75 → 1649
    // TDEE = round(1649 × 1.2) = round(1978.8) = 1979
    const result = computeMacroTargets({
      sex: "MALE",
      ageYears: 30,
      heightCm: 175,
      currentWeightKg: 70,
      activityLevel: "sedentary",
      goalWeightKg: 65,
      goalRateKgPerWeek: 0.5,
    });
    expect(result.rmr).toBe(1649);
    expect(result.palMultiplier).toBe(1.2);
    expect(result.tdee).toBe(Math.round(1649 * 1.2));
  });

  it("TDEE = round(RMR × PAL) for moderate", () => {
    // RMR = 1649, PAL = 1.55 → round(1649 × 1.55) = round(2555.95) = 2556
    const result = computeMacroTargets({
      sex: "MALE",
      ageYears: 30,
      heightCm: 175,
      currentWeightKg: 70,
      activityLevel: "moderate",
      goalWeightKg: 65,
      goalRateKgPerWeek: 0.5,
    });
    expect(result.tdee).toBe(Math.round(1649 * 1.55));
    expect(result.palMultiplier).toBe(1.55);
  });
});

// ─── Direction inference ──────────────────────────────────────────────────────

describe("computeMacroTargets — direction", () => {
  const base = {
    sex: "MALE" as const,
    ageYears: 30,
    heightCm: 175,
    currentWeightKg: 80,
    activityLevel: "moderate" as const,
    goalRateKgPerWeek: 0.5,
  };

  it("LOSE when currentWeight > goalWeight", () => {
    const result = computeMacroTargets({ ...base, goalWeightKg: 70 });
    expect(result.direction).toBe("LOSE");
  });

  it("GAIN when currentWeight < goalWeight", () => {
    const result = computeMacroTargets({ ...base, goalWeightKg: 90 });
    expect(result.direction).toBe("GAIN");
  });

  it("MAINTAIN when currentWeight === goalWeight", () => {
    const result = computeMacroTargets({ ...base, goalWeightKg: 80 });
    expect(result.direction).toBe("MAINTAIN");
  });

  it("MAINTAIN when goalRateKgPerWeek === 0 even if goal differs", () => {
    const result = computeMacroTargets({ ...base, goalWeightKg: 70, goalRateKgPerWeek: 0 });
    expect(result.direction).toBe("MAINTAIN");
  });
});

// ─── Deficit / surplus magnitude ─────────────────────────────────────────────

describe("computeMacroTargets — deficit/surplus and targetKcal", () => {
  it("LOSE: targetKcal = tdee − round(rate × 1100); deficitKcal is negative", () => {
    // 30y/M/175cm/80kg, moderate (PAL=1.55), goalWeight=70, rate=0.5
    // RMR = 10*80 + 6.25*175 - 5*30 + 5 = 800 + 1093.75 - 150 + 5 = 1748.75 → 1749
    // TDEE = round(1749 × 1.55) = round(2710.95) = 2711
    // kcal_per_day = round(0.5 × 1100) = 550
    // targetKcal = 2711 - 550 = 2161
    // deficitKcal = -550
    const result = computeMacroTargets({
      sex: "MALE",
      ageYears: 30,
      heightCm: 175,
      currentWeightKg: 80,
      activityLevel: "moderate",
      goalWeightKg: 70,
      goalRateKgPerWeek: 0.5,
    });
    expect(result.rmr).toBe(1749);
    expect(result.tdee).toBe(Math.round(1749 * 1.55));
    expect(result.targetKcal).toBe(result.tdee - Math.round(0.5 * 1100));
    expect(result.deficitKcal).toBe(-Math.round(0.5 * 1100));
  });

  it("GAIN: targetKcal = tdee + round(rate × 1100); deficitKcal is positive", () => {
    const result = computeMacroTargets({
      sex: "MALE",
      ageYears: 30,
      heightCm: 175,
      currentWeightKg: 70,
      activityLevel: "moderate",
      goalWeightKg: 80,
      goalRateKgPerWeek: 0.3,
    });
    const kcalPerDay = Math.round(0.3 * 1100);
    expect(result.targetKcal).toBe(result.tdee + kcalPerDay);
    expect(result.deficitKcal).toBe(kcalPerDay);
    expect(result.direction).toBe("GAIN");
  });

  it("MAINTAIN: targetKcal = tdee; deficitKcal = 0", () => {
    const result = computeMacroTargets({
      sex: "MALE",
      ageYears: 30,
      heightCm: 175,
      currentWeightKg: 70,
      activityLevel: "moderate",
      goalWeightKg: 70,
      goalRateKgPerWeek: 0.5,
    });
    expect(result.targetKcal).toBe(result.tdee);
    expect(result.deficitKcal).toBe(0);
    expect(result.direction).toBe("MAINTAIN");
  });
});

// ─── No safety clamp ─────────────────────────────────────────────────────────

describe("computeMacroTargets — no safety clamp", () => {
  it("returns raw targetKcal even when < 1200 (sedentary + aggressive rate)", () => {
    // 25y/F/155cm/55kg, sedentary (PAL=1.2), goalWeight=45, rate=1.5
    // RMR = 10*55 + 6.25*155 - 5*25 - 161 = 550 + 968.75 - 125 - 161 = 1232.75 → 1233
    // TDEE = round(1233 × 1.2) = round(1479.6) = 1480
    // kcal_per_day = round(1.5 × 1100) = 1650
    // targetKcal = 1480 - 1650 = -170 (definitely below 1200, even below 0)
    const result = computeMacroTargets({
      sex: "FEMALE",
      ageYears: 25,
      heightCm: 155,
      currentWeightKg: 55,
      activityLevel: "sedentary",
      goalWeightKg: 45,
      goalRateKgPerWeek: 1.5,
    });
    expect(result.targetKcal).toBeLessThan(1200);
    // Explicitly confirm it's the raw computed value (no 1200 floor applied)
    const rmr = computeRmr("FEMALE", 25, 155, 55);
    const tdee = Math.round(rmr * 1.2);
    const kcalPerDay = Math.round(1.5 * 1100);
    expect(result.targetKcal).toBe(tdee - kcalPerDay);
  });
});

// ─── Protein anchoring ────────────────────────────────────────────────────────

describe("computeMacroTargets — protein anchoring", () => {
  const base = {
    sex: "MALE" as const,
    ageYears: 30,
    heightCm: 175,
    activityLevel: "moderate" as const,
    goalRateKgPerWeek: 0.5,
  };

  it("LOSE: protein = round(2.2 × currentWeightKg)", () => {
    const result = computeMacroTargets({
      ...base,
      currentWeightKg: 80,
      goalWeightKg: 70,
    });
    expect(result.proteinG).toBe(Math.round(2.2 * 80));
    expect(result.direction).toBe("LOSE");
  });

  it("MAINTAIN: protein = round(1.6 × currentWeightKg)", () => {
    const result = computeMacroTargets({
      ...base,
      currentWeightKg: 70,
      goalWeightKg: 70,
    });
    expect(result.proteinG).toBe(Math.round(1.6 * 70));
    expect(result.direction).toBe("MAINTAIN");
  });

  it("GAIN: protein = round(1.8 × currentWeightKg)", () => {
    const result = computeMacroTargets({
      ...base,
      currentWeightKg: 70,
      goalWeightKg: 80,
    });
    expect(result.proteinG).toBe(Math.round(1.8 * 70));
    expect(result.direction).toBe("GAIN");
  });
});

// ─── Carbs/fat split ──────────────────────────────────────────────────────────

describe("computeMacroTargets — carbs/fat split", () => {
  it("fatG = round(max(weight × 0.8, targetKcal × 0.25 / 9))", () => {
    // 30y/M/175cm/80kg, moderate, LOSE (goal=70, rate=0.5)
    // targetKcal = 2161, weight = 80
    // fatFromWeight = 80 × 0.8 = 64
    // fatFromKcal = 2161 × 0.25 / 9 = 540.25 / 9 = 60.03
    // fatG = round(max(64, 60.03)) = 64
    const result = computeMacroTargets({
      sex: "MALE",
      ageYears: 30,
      heightCm: 175,
      currentWeightKg: 80,
      activityLevel: "moderate",
      goalWeightKg: 70,
      goalRateKgPerWeek: 0.5,
    });
    const fatFromWeight = 80 * 0.8;
    const fatFromKcal = result.targetKcal * 0.25 / 9;
    expect(result.fatG).toBe(Math.round(Math.max(fatFromWeight, fatFromKcal)));
  });

  it("carbsG = round(max(residual, 130, targetKcal × 0.10 / 4))", () => {
    const result = computeMacroTargets({
      sex: "MALE",
      ageYears: 30,
      heightCm: 175,
      currentWeightKg: 80,
      activityLevel: "moderate",
      goalWeightKg: 70,
      goalRateKgPerWeek: 0.5,
    });
    const carbsResidual = (result.targetKcal - result.proteinG * 4 - result.fatG * 9) / 4;
    const carbsFloor = result.targetKcal * 0.10 / 4;
    expect(result.carbsG).toBe(Math.round(Math.max(carbsResidual, 130, carbsFloor)));
  });

  it("enforces 130g carb floor on aggressive deficit scenarios", () => {
    const result = computeMacroTargets({
      sex: "FEMALE",
      ageYears: 25,
      heightCm: 160,
      currentWeightKg: 60,
      activityLevel: "sedentary",
      goalWeightKg: 55,
      goalRateKgPerWeek: 0.3,
    });
    expect(result.carbsG).toBeGreaterThanOrEqual(130);
  });
});

// ─── Canonical scenario ────────────────────────────────────────────────────────

describe("computeMacroTargets — canonical scenario (49y/M/176cm/121kg, LOSE 0.5/week, moderate)", () => {
  // RMR = 10*121 + 6.25*176 - 5*49 + 5 = 1210 + 1100 - 245 + 5 = 2070
  // PAL (moderate) = 1.55 → TDEE = round(2070 × 1.55) = round(3208.5) = 3209
  // kcal_per_day = round(0.5 × 1100) = 550
  // targetKcal = 3209 - 550 = 2659
  // direction = LOSE (121 > 70)
  // proteinG = round(2.2 × 121) = round(266.2) = 266
  // fatFromWeight = 121 × 0.8 = 96.8; fatFromKcal = 2659 × 0.25 / 9 = 73.86
  // fatG = round(96.8) = 97
  // carbsResidual = (2659 - 266*4 - 97*9) / 4 = (2659 - 1064 - 873) / 4 = 722/4 = 180.5
  // carbsFloor10pct = 2659 * 0.10 / 4 = 66.475
  // carbsG = round(max(180.5, 130, 66.475)) = 181

  const inputs = {
    sex: "MALE" as const,
    ageYears: 49,
    heightCm: 176,
    currentWeightKg: 121,
    activityLevel: "moderate" as const,
    goalWeightKg: 70,
    goalRateKgPerWeek: 0.5,
  };

  it("rmr = 2070", () => {
    expect(computeMacroTargets(inputs).rmr).toBe(2070);
  });

  it("palMultiplier = 1.55", () => {
    expect(computeMacroTargets(inputs).palMultiplier).toBe(1.55);
  });

  it("tdee = round(2070 × 1.55) = 3209", () => {
    expect(computeMacroTargets(inputs).tdee).toBe(3209);
  });

  it("targetKcal = 3209 - 550 = 2659", () => {
    expect(computeMacroTargets(inputs).targetKcal).toBe(2659);
  });

  it("direction = LOSE", () => {
    expect(computeMacroTargets(inputs).direction).toBe("LOSE");
  });

  it("deficitKcal = -550", () => {
    expect(computeMacroTargets(inputs).deficitKcal).toBe(-550);
  });

  it("proteinG = round(2.2 × 121) = 266", () => {
    expect(computeMacroTargets(inputs).proteinG).toBe(266);
  });

  it("fatG = 97 (weight-anchored)", () => {
    expect(computeMacroTargets(inputs).fatG).toBe(97);
  });

  it("carbsG = 181 (residual dominates)", () => {
    expect(computeMacroTargets(inputs).carbsG).toBe(181);
  });
});
