import { describe, it, expect } from "vitest";
import {
  SERVING_UNITS,
  getUnitLabel,
  coerceServingUnit,
  LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT,
  MEAL_TYPE_LABELS,
} from "@/types";
import type {
  ErrorCode,
  ServingUnit,
  FoodAnalysis,
  CommonFood,
} from "@/types";

describe("SERVING_UNITS", () => {
  it("contains all eight serving-unit keys with name + plural", () => {
    const keys: ServingUnit[] = [
      "g", "oz", "cup", "tbsp", "tsp", "ml", "slice", "serving",
    ];
    for (const key of keys) {
      expect(SERVING_UNITS[key]).toBeDefined();
      expect(typeof SERVING_UNITS[key].name).toBe("string");
      expect(typeof SERVING_UNITS[key].plural).toBe("string");
    }
  });

  it("carries no numeric Fitbit id", () => {
    // Registry is now keyed by the internal string enum, no `id` field.
    expect(SERVING_UNITS.cup).toEqual({ name: "cup", plural: "cups" });
  });
});

describe("getUnitLabel", () => {
  it("formats grams without space", () => {
    expect(getUnitLabel("g", 150)).toBe("150g");
  });

  it("formats cups with space and singular", () => {
    expect(getUnitLabel("cup", 1)).toBe("1 cup");
  });

  it("formats cups with space and plural", () => {
    expect(getUnitLabel("cup", 2)).toBe("2 cups");
  });

  it("formats slices with plural", () => {
    expect(getUnitLabel("slice", 2)).toBe("2 slices");
  });

  it("formats tbsp without space", () => {
    expect(getUnitLabel("tbsp", 3)).toBe("3tbsp");
  });

  it("formats a single serving with space", () => {
    expect(getUnitLabel("serving", 1)).toBe("1 serving");
  });

  it("coerces an unknown unit to a safe servings label", () => {
    expect(getUnitLabel("bogus", 3)).toBe("3 servings");
  });

  it("handles decimal amounts", () => {
    expect(getUnitLabel("cup", 1.5)).toBe("1.5 cups");
  });
});

describe("coerceServingUnit", () => {
  it("passes through valid serving-unit strings", () => {
    expect(coerceServingUnit("cup")).toBe("cup");
    expect(coerceServingUnit("g")).toBe("g");
  });

  it("maps each legacy Fitbit numeric unit id to the correct string", () => {
    expect(coerceServingUnit(147)).toBe("g");
    expect(coerceServingUnit(226)).toBe("oz");
    expect(coerceServingUnit(91)).toBe("cup");
    expect(coerceServingUnit(349)).toBe("tbsp");
    expect(coerceServingUnit(364)).toBe("tsp");
    expect(coerceServingUnit(209)).toBe("ml");
    expect(coerceServingUnit(311)).toBe("slice");
    expect(coerceServingUnit(304)).toBe("serving");
  });

  it("maps a numeric legacy id passed as a string", () => {
    expect(coerceServingUnit("147")).toBe("g");
  });

  it("defaults unknown values to serving", () => {
    expect(coerceServingUnit("nonsense")).toBe("serving");
    expect(coerceServingUnit(9999)).toBe("serving");
    expect(coerceServingUnit(null)).toBe("serving");
    expect(coerceServingUnit(undefined)).toBe("serving");
  });

  it("exposes the legacy id map for the migration backfill", () => {
    expect(LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT[147]).toBe("g");
    expect(Object.keys(LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT)).toHaveLength(8);
  });

  it("maps every legacy id to a valid ServingUnit (migration backfill invariant)", () => {
    for (const [id, unit] of Object.entries(LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT)) {
      // every mapped target must be a real serving unit (the migration USING-clause
      // and coerceServingUnit both rely on this — a typo here corrupts portion labels)
      expect(SERVING_UNITS[unit]).toBeDefined();
      // round-trip: coercing the numeric id yields the same unit
      expect(coerceServingUnit(Number(id))).toBe(unit);
    }
  });
});

describe("ServingUnit typing on data shapes", () => {
  it("accepts string serving units and rejects legacy numeric ids", () => {
    const analysisOk: Pick<FoodAnalysis, "unit_id"> = { unit_id: "g" };
    expect(analysisOk.unit_id).toBe("g");

    const foodOk: Pick<CommonFood, "unitId"> = { unitId: "cup" };
    expect(foodOk.unitId).toBe("cup");

    // @ts-expect-error legacy numeric unit ids no longer compile
    const analysisBad: Pick<FoodAnalysis, "unit_id"> = { unit_id: 147 };
    void analysisBad;

    // @ts-expect-error legacy numeric unit ids no longer compile
    const foodBad: Pick<CommonFood, "unitId"> = { unitId: 91 };
    void foodBad;
  });
});

describe("ErrorCode union", () => {
  it("contains the HEALTH_* codes", () => {
    const codes: ErrorCode[] = [
      "HEALTH_NOT_CONNECTED",
      "HEALTH_TOKEN_INVALID",
      "HEALTH_SCOPE_MISSING",
      "HEALTH_RATE_LIMIT",
      "HEALTH_RATE_LIMIT_LOW",
      "HEALTH_TIMEOUT",
      "HEALTH_REFRESH_TRANSIENT",
      "HEALTH_TOKEN_SAVE_FAILED",
      "HEALTH_API_ERROR",
    ];
    expect(codes).toHaveLength(9);
  });

  it("no longer contains FITBIT_* codes", () => {
    // @ts-expect-error FITBIT_* error codes were removed in the Google Health cutover
    const removed: ErrorCode = "FITBIT_RATE_LIMIT_LOW";
    void removed;
  });
});

describe("MEAL_TYPE_LABELS", () => {
  it("exposes the renamed label map", () => {
    expect(MEAL_TYPE_LABELS[1]).toBe("Breakfast");
    expect(MEAL_TYPE_LABELS[7]).toBe("Anytime");
  });
});
