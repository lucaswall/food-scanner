import { describe, it, expect } from "vitest";
import {
  FITBIT_UNITS,
  getUnitById,
  getUnitLabel,
} from "@/types";
import type { FitbitUnitKey } from "@/types";

describe("FITBIT_UNITS", () => {
  it("contains all expected unit keys", () => {
    const expectedKeys: FitbitUnitKey[] = [
      "g", "oz", "cup", "tbsp", "tsp", "ml", "slice", "piece", "serving",
    ];
    for (const key of expectedKeys) {
      expect(FITBIT_UNITS[key]).toBeDefined();
    }
  });

  it("each entry has id, name, and plural", () => {
    for (const key of Object.keys(FITBIT_UNITS) as FitbitUnitKey[]) {
      const unit = FITBIT_UNITS[key];
      expect(typeof unit.id).toBe("number");
      expect(typeof unit.name).toBe("string");
      expect(typeof unit.plural).toBe("string");
    }
  });

  it("has correct well-known Fitbit unit IDs", () => {
    expect(FITBIT_UNITS.g.id).toBe(147);
    expect(FITBIT_UNITS.oz.id).toBe(226);
    expect(FITBIT_UNITS.cup.id).toBe(91);
    expect(FITBIT_UNITS.tbsp.id).toBe(349);
    expect(FITBIT_UNITS.tsp.id).toBe(364);
    expect(FITBIT_UNITS.ml.id).toBe(211);
    expect(FITBIT_UNITS.slice.id).toBe(311);
    expect(FITBIT_UNITS.piece.id).toBe(256);
    expect(FITBIT_UNITS.serving.id).toBe(304);
  });
});

describe("getUnitById", () => {
  it("returns the unit entry for a valid id", () => {
    const unit = getUnitById(147);
    expect(unit).toEqual({ id: 147, name: "g", plural: "g" });
  });

  it("returns undefined for an unknown id", () => {
    expect(getUnitById(9999)).toBeUndefined();
  });
});

describe("getUnitLabel", () => {
  it("formats grams without space", () => {
    expect(getUnitLabel(147, 150)).toBe("150g");
  });

  it("formats cups with space and singular", () => {
    expect(getUnitLabel(91, 1)).toBe("1 cup");
  });

  it("formats cups with space and plural", () => {
    expect(getUnitLabel(91, 2)).toBe("2 cups");
  });

  it("formats slices with plural", () => {
    expect(getUnitLabel(311, 3)).toBe("3 slices");
  });

  it("formats ml without space", () => {
    expect(getUnitLabel(211, 250)).toBe("250ml");
  });

  it("formats oz without space", () => {
    expect(getUnitLabel(226, 8)).toBe("8oz");
  });

  it("formats tbsp without space", () => {
    expect(getUnitLabel(349, 2)).toBe("2tbsp");
  });

  it("returns fallback for unknown unit id", () => {
    expect(getUnitLabel(9999, 5)).toBe("5 units");
  });

  it("handles decimal amounts", () => {
    expect(getUnitLabel(91, 1.5)).toBe("1.5 cups");
  });
});

