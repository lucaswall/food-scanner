import { describe, it, expect, vi } from "vitest";
import {
  computeMacroTargets,
  ACTIVITY_MULTIPLIER,
  GOAL_MULTIPLIERS,
  MACRO_PROFILE_MUSCLE_PRESERVE,
  MACRO_PROFILE_METABOLIC_FLEX,
  MACRO_PROFILES_BY_KEY,
  DEFAULT_MACRO_PROFILE,
  isMacroProfileKey,
  getMacroProfile,
  describeProfile,
} from "@/lib/macro-engine";

describe("macro engine constants", () => {
  it("exports ACTIVITY_MULTIPLIER = 0.85", () => {
    expect(ACTIVITY_MULTIPLIER).toBe(0.85);
  });

  it("exports correct GOAL_MULTIPLIERS", () => {
    expect(GOAL_MULTIPLIERS.LOSE).toBe(0.80);
    expect(GOAL_MULTIPLIERS.MAINTAIN).toBe(1.00);
    expect(GOAL_MULTIPLIERS.GAIN).toBe(1.10);
  });

  it("default profile is muscle-preserve (preserves prior behavior)", () => {
    expect(DEFAULT_MACRO_PROFILE).toBe(MACRO_PROFILE_MUSCLE_PRESERVE);
  });

  it("muscle-preserve coefficients match the original engine values", () => {
    const c = MACRO_PROFILE_MUSCLE_PRESERVE.proteinCoefficients;
    expect(c.lt25.LOSE).toBe(2.2);
    expect(c.lt25.MAINTAIN).toBe(1.6);
    expect(c.lt25.GAIN).toBe(1.8);
    expect(c["25to30"].LOSE).toBe(2.0);
    expect(c["25to30"].MAINTAIN).toBe(1.6);
    expect(c["25to30"].GAIN).toBe(1.8);
    expect(c.ge30.LOSE).toBe(1.8);
    expect(c.ge30.MAINTAIN).toBe(1.6);
    expect(c.ge30.GAIN).toBe(1.6);
    expect(MACRO_PROFILE_MUSCLE_PRESERVE.carbGrams).toBe(130);
    expect(MACRO_PROFILE_MUSCLE_PRESERVE.residualMacro).toBe("carbs");
  });

  it("metabolic-flex coefficients match Lumen-style profile", () => {
    const c = MACRO_PROFILE_METABOLIC_FLEX.proteinCoefficients;
    expect(c.lt25.LOSE).toBe(1.4);
    expect(c.ge30.LOSE).toBe(1.2);
    expect(MACRO_PROFILE_METABOLIC_FLEX.carbGrams).toBe(80);
    expect(MACRO_PROFILE_METABOLIC_FLEX.residualMacro).toBe("fat");
  });

  it("MACRO_PROFILES_BY_KEY exposes both profiles", () => {
    expect(MACRO_PROFILES_BY_KEY.muscle_preserve).toBe(MACRO_PROFILE_MUSCLE_PRESERVE);
    expect(MACRO_PROFILES_BY_KEY.metabolic_flex).toBe(MACRO_PROFILE_METABOLIC_FLEX);
  });
});

describe("isMacroProfileKey", () => {
  it("accepts known keys", () => {
    expect(isMacroProfileKey("muscle_preserve")).toBe(true);
    expect(isMacroProfileKey("metabolic_flex")).toBe(true);
  });

  it("rejects unknown values", () => {
    expect(isMacroProfileKey("foo")).toBe(false);
    expect(isMacroProfileKey(null)).toBe(false);
    expect(isMacroProfileKey(undefined)).toBe(false);
    expect(isMacroProfileKey(42)).toBe(false);
  });
});

describe("getMacroProfile", () => {
  it("returns the profile for a known key", () => {
    expect(getMacroProfile("muscle_preserve")).toBe(MACRO_PROFILE_MUSCLE_PRESERVE);
    expect(getMacroProfile("metabolic_flex")).toBe(MACRO_PROFILE_METABOLIC_FLEX);
  });

  it("falls back to DEFAULT_MACRO_PROFILE for null/undefined", () => {
    expect(getMacroProfile(null)).toBe(DEFAULT_MACRO_PROFILE);
    expect(getMacroProfile(undefined)).toBe(DEFAULT_MACRO_PROFILE);
  });

  it("logs a warning when stored key is invalid (FOO-1001)", () => {
    const warn = vi.fn();
    const fakeLogger = {
      info: vi.fn(),
      warn,
      error: vi.fn(),
      debug: vi.fn(),
    };
    const result = getMacroProfile("foo" as never, fakeLogger as never);
    expect(result).toBe(DEFAULT_MACRO_PROFILE);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "macro_profile_invalid_key", key: "foo" }),
      expect.any(String),
    );
  });

  it("does NOT log when key is null/undefined (legitimate unset state)", () => {
    const warn = vi.fn();
    const fakeLogger = {
      info: vi.fn(),
      warn,
      error: vi.fn(),
      debug: vi.fn(),
    };
    getMacroProfile(null, fakeLogger as never);
    getMacroProfile(undefined, fakeLogger as never);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("describeProfile (FOO-1006)", () => {
  it("muscle-preserve description references current coefficients", () => {
    const desc = describeProfile(MACRO_PROFILE_MUSCLE_PRESERVE);
    expect(desc).toContain("1.6"); // min from lt25.MAINTAIN
    expect(desc).toContain("2.2"); // max from lt25.LOSE
    expect(desc).toContain("130"); // carb floor
    expect(desc).toMatch(/muscle-preservation/i);
  });

  it("metabolic-flex description references current coefficients", () => {
    const desc = describeProfile(MACRO_PROFILE_METABOLIC_FLEX);
    expect(desc).toContain("1.0"); // min from ge30.MAINTAIN
    expect(desc).toContain("1.4"); // max from lt25.LOSE
    expect(desc).toContain("80"); // carbs
    expect(desc).toMatch(/metabolic-flexibility/i);
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

  describe("invalid profile data — throws INVALID_PROFILE_DATA", () => {
    const baseInputs = {
      ageYears: 30,
      sex: "MALE" as const,
      heightCm: 175,
      weightKg: 70,
      caloriesOut: 2500,
      goalType: "MAINTAIN" as const,
    };

    it("throws when heightCm is 0", () => {
      expect(() => computeMacroTargets({ ...baseInputs, heightCm: 0 })).toThrow(
        "INVALID_PROFILE_DATA",
      );
    });

    it("throws when weightKg is 0", () => {
      expect(() => computeMacroTargets({ ...baseInputs, weightKg: 0 })).toThrow(
        "INVALID_PROFILE_DATA",
      );
    });

    it("throws when ageYears is negative", () => {
      expect(() => computeMacroTargets({ ...baseInputs, ageYears: -1 })).toThrow(
        "INVALID_PROFILE_DATA",
      );
    });

    it("throws on NaN weight", () => {
      expect(() => computeMacroTargets({ ...baseInputs, weightKg: Number.NaN })).toThrow(
        "INVALID_PROFILE_DATA",
      );
    });

    it("throws on Infinity height", () => {
      expect(() =>
        computeMacroTargets({ ...baseInputs, heightCm: Number.POSITIVE_INFINITY }),
      ).toThrow("INVALID_PROFILE_DATA");
    });
  });

  describe("invalid activity data — throws INVALID_ACTIVITY_DATA (FOO-998)", () => {
    const baseInputs = {
      ageYears: 30,
      sex: "MALE" as const,
      heightCm: 175,
      weightKg: 70,
      caloriesOut: 2500,
      goalType: "MAINTAIN" as const,
    };

    it("throws on NaN caloriesOut", () => {
      expect(() => computeMacroTargets({ ...baseInputs, caloriesOut: Number.NaN })).toThrow(
        "INVALID_ACTIVITY_DATA",
      );
    });

    it("throws on Infinity caloriesOut", () => {
      expect(() =>
        computeMacroTargets({ ...baseInputs, caloriesOut: Number.POSITIVE_INFINITY }),
      ).toThrow("INVALID_ACTIVITY_DATA");
    });

    it("throws on negative caloriesOut", () => {
      expect(() => computeMacroTargets({ ...baseInputs, caloriesOut: -100 })).toThrow(
        "INVALID_ACTIVITY_DATA",
      );
    });

    it("accepts caloriesOut up to 30000", () => {
      expect(() => computeMacroTargets({ ...baseInputs, caloriesOut: 30000 })).not.toThrow();
    });

    it("throws above 30000", () => {
      expect(() => computeMacroTargets({ ...baseInputs, caloriesOut: 30001 })).toThrow(
        "INVALID_ACTIVITY_DATA",
      );
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

    it("returns activityKcal = 0 when caloriesOut is less than RMR", () => {
      const result = computeMacroTargets({
        ageYears: 30,
        sex: "MALE",
        heightCm: 175,
        weightKg: 70,
        caloriesOut: 1000,
        goalType: "MAINTAIN",
      });
      expect(result.activityKcal).toBe(0);
    });
  });

  describe("muscle-preserve profile (default)", () => {
    // Scenario: 49y/M/176cm/121kg/LOSE/3000 caloriesOut
    // RMR = 10*121 + 6.25*176 - 5*49 + 5 = 2070
    // activity_kcal = round(max(0, 3000-2070)*0.85) = round(790.5) = 791
    // tdee = 2861, target = round(2861*0.80) = 2289
    // BMI ≈ 39.07 → ge30; protein = round(121*1.8) = 218
    // fat = round(max(121*0.8, 2289*0.25/9)) = round(96.8) = 97
    // carbs = round(max((2289-872-873)/4, 130, 57.225)) = round(136) = 136

    const inputs = {
      ageYears: 49,
      sex: "MALE" as const,
      heightCm: 176,
      weightKg: 121,
      caloriesOut: 3000,
      goalType: "LOSE" as const,
    };

    it("matches the original engine for the canonical scenario", () => {
      const result = computeMacroTargets(inputs, MACRO_PROFILE_MUSCLE_PRESERVE);
      expect(result.rmr).toBe(2070);
      expect(result.activityKcal).toBe(791);
      expect(result.tdee).toBe(2861);
      expect(result.targetKcal).toBe(2289);
      expect(result.bmiTier).toBe("ge30");
      expect(result.proteinG).toBe(218);
      expect(result.fatG).toBe(97);
      expect(result.carbsG).toBe(136);
    });

    it("default profile equals muscle-preserve for this scenario", () => {
      const explicit = computeMacroTargets(inputs, MACRO_PROFILE_MUSCLE_PRESERVE);
      const defaulted = computeMacroTargets(inputs);
      expect(defaulted).toEqual(explicit);
    });

    it("enforces 130g carb floor on aggressive cuts", () => {
      const result = computeMacroTargets(
        {
          ageYears: 25,
          sex: "FEMALE",
          heightCm: 150,
          weightKg: 40,
          caloriesOut: 1200,
          goalType: "LOSE",
        },
        MACRO_PROFILE_MUSCLE_PRESERVE,
      );
      expect(result.carbsG).toBeGreaterThanOrEqual(130);
    });
  });

  describe("metabolic-flex profile (Lumen-style)", () => {
    // Same scenario as above: 49y/M/176cm/121kg/LOSE/3000 caloriesOut → target 2289 kcal
    // protein = round(121*1.2) = 145
    // carbs = 80 (fixed)
    // fat = round(max(0, (2289 - 145*4 - 80*4)/9)) = round((2289-580-320)/9) = round(1389/9) = round(154.33) = 154

    it("computes lower protein, fixed carbs, higher fat", () => {
      const result = computeMacroTargets(
        {
          ageYears: 49,
          sex: "MALE",
          heightCm: 176,
          weightKg: 121,
          caloriesOut: 3000,
          goalType: "LOSE",
        },
        MACRO_PROFILE_METABOLIC_FLEX,
      );
      expect(result.proteinG).toBe(145);
      expect(result.carbsG).toBe(80);
      expect(result.fatG).toBe(154);
    });

    it("rmr/tdee/targetKcal do not depend on profile", () => {
      const inputs = {
        ageYears: 30,
        sex: "FEMALE" as const,
        heightCm: 165,
        weightKg: 60,
        caloriesOut: 2200,
        goalType: "MAINTAIN" as const,
      };
      const muscle = computeMacroTargets(inputs, MACRO_PROFILE_MUSCLE_PRESERVE);
      const flex = computeMacroTargets(inputs, MACRO_PROFILE_METABOLIC_FLEX);
      expect(flex.rmr).toBe(muscle.rmr);
      expect(flex.tdee).toBe(muscle.tdee);
      expect(flex.targetKcal).toBe(muscle.targetKcal);
      expect(flex.bmiTier).toBe(muscle.bmiTier);
    });

    it("clamps fat to 0 when protein+carbs already exceed target", () => {
      // Tiny target with high protein coeff would yield negative residual
      const result = computeMacroTargets(
        {
          ageYears: 30,
          sex: "FEMALE",
          heightCm: 150,
          weightKg: 100,
          caloriesOut: 1000,
          goalType: "LOSE",
        },
        MACRO_PROFILE_METABOLIC_FLEX,
      );
      expect(result.fatG).toBeGreaterThanOrEqual(0);
    });
  });

  describe("BMI tier boundaries", () => {
    it("assigns 25to30 tier for BMI exactly 25", () => {
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
    it("computes correct targetKcal for GAIN goal (muscle-preserve)", () => {
      const result = computeMacroTargets({
        ageYears: 25,
        sex: "MALE",
        heightCm: 180,
        weightKg: 75,
        caloriesOut: 2600,
        goalType: "GAIN",
      });
      expect(result.targetKcal).toBe(2720);
    });
  });
});
