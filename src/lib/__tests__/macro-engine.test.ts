import { describe, it, expect } from "vitest";
import {
  computeMacroTargets,
  ACTIVITY_MULTIPLIER,
  PROTEIN_COEFFICIENTS,
  CARB_FLOOR_GRAMS,
  FAT_PERCENT_OF_KCAL,
  GOAL_MULTIPLIERS,
} from "@/lib/macro-engine";

describe("macro engine constants", () => {
  it("exports ACTIVITY_MULTIPLIER = 0.85", () => {
    expect(ACTIVITY_MULTIPLIER).toBe(0.85);
  });

  it("exports correct PROTEIN_COEFFICIENTS for all tiers and goals", () => {
    expect(PROTEIN_COEFFICIENTS.lt25.LOSE).toBe(2.2);
    expect(PROTEIN_COEFFICIENTS.lt25.MAINTAIN).toBe(1.6);
    expect(PROTEIN_COEFFICIENTS.lt25.GAIN).toBe(1.8);
    expect(PROTEIN_COEFFICIENTS["25to30"].LOSE).toBe(2.0);
    expect(PROTEIN_COEFFICIENTS["25to30"].MAINTAIN).toBe(1.6);
    expect(PROTEIN_COEFFICIENTS["25to30"].GAIN).toBe(1.8);
    expect(PROTEIN_COEFFICIENTS.ge30.LOSE).toBe(1.8);
    expect(PROTEIN_COEFFICIENTS.ge30.MAINTAIN).toBe(1.6);
    expect(PROTEIN_COEFFICIENTS.ge30.GAIN).toBe(1.6);
  });

  it("exports CARB_FLOOR_GRAMS = 130", () => {
    expect(CARB_FLOOR_GRAMS).toBe(130);
  });

  it("exports FAT_PERCENT_OF_KCAL = 0.25", () => {
    expect(FAT_PERCENT_OF_KCAL).toBe(0.25);
  });

  it("exports correct GOAL_MULTIPLIERS", () => {
    expect(GOAL_MULTIPLIERS.LOSE).toBe(0.80);
    expect(GOAL_MULTIPLIERS.MAINTAIN).toBe(1.00);
    expect(GOAL_MULTIPLIERS.GAIN).toBe(1.10);
  });
});

describe("computeMacroTargets", () => {
  describe("sex NA — returns error", () => {
    it("throws when sex is NA", () => {
      expect(() =>
        computeMacroTargets({
          ageYears: 30,
          sex: "NA",
          heightCm: 170,
          weightKg: 70,
          caloriesOut: 2500,
          goalType: "MAINTAIN",
        })
      ).toThrow("SEX_UNSET");
    });
  });

  describe("activity_kcal clamps to 0 when caloriesOut <= RMR", () => {
    it("returns activityKcal = 0 when caloriesOut is 0", () => {
      const result = computeMacroTargets({
        ageYears: 30,
        sex: "MALE",
        heightCm: 175,
        weightKg: 70,
        caloriesOut: 0,
        goalType: "MAINTAIN",
      });
      expect(result.activityKcal).toBe(0);
    });

    it("returns activityKcal = 0 when caloriesOut is negative", () => {
      const result = computeMacroTargets({
        ageYears: 30,
        sex: "MALE",
        heightCm: 175,
        weightKg: 70,
        caloriesOut: -100,
        goalType: "MAINTAIN",
      });
      expect(result.activityKcal).toBe(0);
    });

    it("returns activityKcal = 0 when caloriesOut is less than RMR", () => {
      // RMR for 30y/M/175cm/70kg = 10*70 + 6.25*175 - 5*30 + 5 = 700+1093.75-150+5 = 1648.75
      const result = computeMacroTargets({
        ageYears: 30,
        sex: "MALE",
        heightCm: 175,
        weightKg: 70,
        caloriesOut: 1000, // less than RMR
        goalType: "MAINTAIN",
      });
      expect(result.activityKcal).toBe(0);
    });
  });

  describe("carb floor binds at 130 for aggressive cut", () => {
    it("enforces CARB_FLOOR_GRAMS when target is very low", () => {
      // Very low weight, LOSE goal to create aggressive cut
      const result = computeMacroTargets({
        ageYears: 25,
        sex: "FEMALE",
        heightCm: 150,
        weightKg: 40,
        caloriesOut: 1200,
        goalType: "LOSE",
      });
      expect(result.carbsG).toBeGreaterThanOrEqual(CARB_FLOOR_GRAMS);
    });
  });

  describe("scenario: 49y/M/176cm/121kg/LOSE/3000 caloriesOut", () => {
    // RMR (male) = 10*121 + 6.25*176 - 5*49 + 5 = 1210 + 1100 - 245 + 5 = 2070
    // activity_kcal = max(0, 3000 - 2070) * 0.85 = 930 * 0.85 = 790.5
    // tdee = 2070 + 790.5 = 2860.5
    // target_kcal = round(2860.5 * 0.80) = round(2288.4) = 2288
    // BMI = 121 / (1.76^2) = 121 / 3.0976 ≈ 39.07 → "ge30"
    // protein_g = round(121 * 1.8) = round(217.8) = 218
    // fat_g = round(max(121 * 0.8, 2288 * 0.25 / 9)) = round(max(96.8, 63.56)) = round(96.8) = 97
    // carbs_residual = (2288 - 218*4 - 97*9) / 4 = (2288 - 872 - 873) / 4 = 543/4 = 135.75
    // carbs_floor_10pct = 0.10 * 2288 / 4 = 57.2
    // carbs_g = round(max(135.75, 130, 57.2)) = 136

    it("computes correct rmr", () => {
      const result = computeMacroTargets({
        ageYears: 49,
        sex: "MALE",
        heightCm: 176,
        weightKg: 121,
        caloriesOut: 3000,
        goalType: "LOSE",
      });
      expect(result.rmr).toBe(2070);
    });

    it("computes correct activityKcal", () => {
      const result = computeMacroTargets({
        ageYears: 49,
        sex: "MALE",
        heightCm: 176,
        weightKg: 121,
        caloriesOut: 3000,
        goalType: "LOSE",
      });
      // activity_kcal = max(0, 3000-2070)*0.85 = 930*0.85 = 790.5 → round to int: 791
      expect(result.activityKcal).toBe(791);
    });

    it("computes correct tdee", () => {
      const result = computeMacroTargets({
        ageYears: 49,
        sex: "MALE",
        heightCm: 176,
        weightKg: 121,
        caloriesOut: 3000,
        goalType: "LOSE",
      });
      // tdee = 2070 + 791 = 2861
      expect(result.tdee).toBe(2861);
    });

    it("computes correct targetKcal", () => {
      const result = computeMacroTargets({
        ageYears: 49,
        sex: "MALE",
        heightCm: 176,
        weightKg: 121,
        caloriesOut: 3000,
        goalType: "LOSE",
      });
      // targetKcal = round(2861 * 0.80) = round(2288.8) = 2289
      expect(result.targetKcal).toBe(2289);
    });

    it("identifies bmiTier as ge30", () => {
      const result = computeMacroTargets({
        ageYears: 49,
        sex: "MALE",
        heightCm: 176,
        weightKg: 121,
        caloriesOut: 3000,
        goalType: "LOSE",
      });
      expect(result.bmiTier).toBe("ge30");
    });

    it("computes correct proteinG", () => {
      const result = computeMacroTargets({
        ageYears: 49,
        sex: "MALE",
        heightCm: 176,
        weightKg: 121,
        caloriesOut: 3000,
        goalType: "LOSE",
      });
      // protein_g = round(121 * 1.8) = round(217.8) = 218
      expect(result.proteinG).toBe(218);
    });

    it("computes correct fatG", () => {
      const result = computeMacroTargets({
        ageYears: 49,
        sex: "MALE",
        heightCm: 176,
        weightKg: 121,
        caloriesOut: 3000,
        goalType: "LOSE",
      });
      // fat_g = round(max(121*0.8, 2289*0.25/9)) = round(max(96.8, 63.58)) = round(96.8) = 97
      expect(result.fatG).toBe(97);
    });

    it("computes correct carbsG", () => {
      const result = computeMacroTargets({
        ageYears: 49,
        sex: "MALE",
        heightCm: 176,
        weightKg: 121,
        caloriesOut: 3000,
        goalType: "LOSE",
      });
      // carbsResidual = (2289 - 218*4 - 97*9) / 4 = (2289 - 872 - 873) / 4 = 544/4 = 136
      expect(result.carbsG).toBe(136);
    });
  });

  describe("scenario: 44y/F/162cm/65kg/MAINTAIN/2200 caloriesOut", () => {
    // RMR (female) = 10*65 + 6.25*162 - 5*44 - 161 = 650 + 1012.5 - 220 - 161 = 1281.5 → 1282
    // activity_kcal = max(0, 2200 - 1282) * 0.85 = 918 * 0.85 = 780.3 → 780
    // tdee = 1282 + 780 = 2062
    // target_kcal = round(2062 * 1.00) = 2062
    // BMI = 65 / (1.62^2) = 65 / 2.6244 ≈ 24.77 → "lt25"
    // protein_g = round(65 * 1.6) = round(104) = 104
    // fat_g = round(max(65*0.8, 2062*0.25/9)) = round(max(52, 57.28)) = round(57.28) = 57
    // carbs_residual = (2062 - 104*4 - 57*9) / 4 = (2062 - 416 - 513) / 4 = 1133/4 = 283.25
    // carbs_floor_10pct = 0.10 * 2062 / 4 = 51.55
    // carbs_g = round(max(283.25, 130, 51.55)) = 283

    it("identifies bmiTier as lt25", () => {
      const result = computeMacroTargets({
        ageYears: 44,
        sex: "FEMALE",
        heightCm: 162,
        weightKg: 65,
        caloriesOut: 2200,
        goalType: "MAINTAIN",
      });
      expect(result.bmiTier).toBe("lt25");
    });

    it("computes correct rmr for female", () => {
      const result = computeMacroTargets({
        ageYears: 44,
        sex: "FEMALE",
        heightCm: 162,
        weightKg: 65,
        caloriesOut: 2200,
        goalType: "MAINTAIN",
      });
      // RMR = 10*65 + 6.25*162 - 5*44 - 161 = 650 + 1012.5 - 220 - 161 = 1281.5 → 1282
      expect(result.rmr).toBe(1282);
    });

    it("computes correct proteinG for lt25/MAINTAIN", () => {
      const result = computeMacroTargets({
        ageYears: 44,
        sex: "FEMALE",
        heightCm: 162,
        weightKg: 65,
        caloriesOut: 2200,
        goalType: "MAINTAIN",
      });
      expect(result.proteinG).toBe(104);
    });

    it("computes all outputs for female scenario", () => {
      const result = computeMacroTargets({
        ageYears: 44,
        sex: "FEMALE",
        heightCm: 162,
        weightKg: 65,
        caloriesOut: 2200,
        goalType: "MAINTAIN",
      });
      expect(result.rmr).toBe(1282);
      expect(result.bmiTier).toBe("lt25");
      expect(result.proteinG).toBe(104);
      expect(result.fatG).toBe(57);
      expect(result.carbsG).toBe(283);
    });
  });

  describe("BMI tier boundaries", () => {
    it("assigns 25to30 tier for BMI exactly 25", () => {
      // BMI = 25 → weight = 25 * height^2
      // height = 1.70m → weight = 25 * 2.89 = 72.25 kg
      const result = computeMacroTargets({
        ageYears: 30,
        sex: "MALE",
        heightCm: 170,
        weightKg: 72.25,
        caloriesOut: 2500,
        goalType: "MAINTAIN",
      });
      expect(result.bmiTier).toBe("25to30");
    });

    it("assigns ge30 tier for BMI exactly 30", () => {
      // BMI = 30 → weight = 30 * (1.70)^2 = 30 * 2.89 = 86.7 kg
      const result = computeMacroTargets({
        ageYears: 30,
        sex: "MALE",
        heightCm: 170,
        weightKg: 86.7,
        caloriesOut: 2500,
        goalType: "MAINTAIN",
      });
      expect(result.bmiTier).toBe("ge30");
    });
  });

  describe("GAIN goal", () => {
    it("computes correct targetKcal for GAIN goal", () => {
      const result = computeMacroTargets({
        ageYears: 25,
        sex: "MALE",
        heightCm: 180,
        weightKg: 75,
        caloriesOut: 2600,
        goalType: "GAIN",
      });
      // RMR = 10*75 + 6.25*180 - 5*25 + 5 = 750 + 1125 - 125 + 5 = 1755
      // activity_kcal = max(0, 2600 - 1755) * 0.85 = 845 * 0.85 = 718.25 → 718
      // tdee = 1755 + 718 = 2473
      // target = round(2473 * 1.10) = round(2720.3) = 2720
      expect(result.targetKcal).toBe(2720);
    });
  });
});
