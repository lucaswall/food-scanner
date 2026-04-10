import { describe, it, expect } from "vitest";
import { isValidFoodAnalysisFields } from "@/lib/food-validation";

const validBody: Record<string, unknown> = {
  food_name: "Grilled Chicken",
  amount: 150,
  unit_id: 147,
  calories: 250,
  protein_g: 30,
  carbs_g: 5,
  fat_g: 10,
  fiber_g: 2,
  sodium_mg: 400,
  notes: "",
  description: "A healthy grilled chicken breast",
  confidence: "high",
};

describe("isValidFoodAnalysisFields", () => {
  it("returns true for a valid complete FoodAnalysis body", () => {
    expect(isValidFoodAnalysisFields(validBody)).toBe(true);
  });

  it("returns false when food_name is missing", () => {
    const { food_name: _, ...body } = validBody;
    expect(isValidFoodAnalysisFields(body)).toBe(false);
  });

  it("returns false when food_name is empty string", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, food_name: "" })).toBe(false);
  });

  it("returns false when food_name exceeds 500 chars", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, food_name: "a".repeat(501) })).toBe(false);
  });

  it("returns true when food_name is exactly 500 chars", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, food_name: "a".repeat(500) })).toBe(true);
  });

  it("returns false when calories is negative", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, calories: -1 })).toBe(false);
  });

  it("returns false when protein_g is negative", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, protein_g: -1 })).toBe(false);
  });

  it("returns false when carbs_g is negative", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, carbs_g: -1 })).toBe(false);
  });

  it("returns false when fat_g is negative", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, fat_g: -1 })).toBe(false);
  });

  it("returns false when fiber_g is negative", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, fiber_g: -1 })).toBe(false);
  });

  it("returns false when sodium_mg is negative", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, sodium_mg: -1 })).toBe(false);
  });

  it("returns false when amount is 0", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, amount: 0 })).toBe(false);
  });

  it("returns false when amount is negative", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, amount: -5 })).toBe(false);
  });

  it("returns false when confidence is invalid", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, confidence: "extreme" })).toBe(false);
  });

  it("returns true for confidence 'medium'", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, confidence: "medium" })).toBe(true);
  });

  it("returns true for confidence 'low'", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, confidence: "low" })).toBe(true);
  });

  it("returns false when notes exceeds 2000 chars", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, notes: "a".repeat(2001) })).toBe(false);
  });

  it("returns false when description exceeds 2000 chars", () => {
    expect(isValidFoodAnalysisFields({ ...validBody, description: "a".repeat(2001) })).toBe(false);
  });

  describe("Tier 1 nutrients", () => {
    it("returns true when tier1 fields are null", () => {
      expect(isValidFoodAnalysisFields({
        ...validBody,
        saturated_fat_g: null,
        trans_fat_g: null,
        sugars_g: null,
        calories_from_fat: null,
      })).toBe(true);
    });

    it("returns true when tier1 fields are positive numbers", () => {
      expect(isValidFoodAnalysisFields({
        ...validBody,
        saturated_fat_g: 2,
        trans_fat_g: 0.5,
        sugars_g: 3,
        calories_from_fat: 90,
      })).toBe(true);
    });

    it("returns false when saturated_fat_g is negative", () => {
      expect(isValidFoodAnalysisFields({ ...validBody, saturated_fat_g: -1 })).toBe(false);
    });

    it("returns false when trans_fat_g is negative", () => {
      expect(isValidFoodAnalysisFields({ ...validBody, trans_fat_g: -1 })).toBe(false);
    });

    it("returns false when sugars_g is negative", () => {
      expect(isValidFoodAnalysisFields({ ...validBody, sugars_g: -1 })).toBe(false);
    });

    it("returns false when calories_from_fat is negative", () => {
      expect(isValidFoodAnalysisFields({ ...validBody, calories_from_fat: -1 })).toBe(false);
    });

    it("returns false when a tier1 field is a non-number (string)", () => {
      expect(isValidFoodAnalysisFields({ ...validBody, saturated_fat_g: "2" })).toBe(false);
    });
  });

  describe("keywords", () => {
    it("returns true when keywords is an array of strings", () => {
      expect(isValidFoodAnalysisFields({ ...validBody, keywords: ["chicken", "grilled"] })).toBe(true);
    });

    it("returns true when keywords is an empty array", () => {
      expect(isValidFoodAnalysisFields({ ...validBody, keywords: [] })).toBe(true);
    });

    it("returns false when a keyword exceeds 100 chars", () => {
      expect(isValidFoodAnalysisFields({ ...validBody, keywords: ["a".repeat(101)] })).toBe(false);
    });

    it("returns false when keywords has more than 20 elements", () => {
      expect(isValidFoodAnalysisFields({ ...validBody, keywords: Array(21).fill("tag") })).toBe(false);
    });

    it("returns true when keywords is undefined (optional)", () => {
      const { keywords: _, ...body } = { ...validBody, keywords: ["tag"] };
      expect(isValidFoodAnalysisFields(body)).toBe(true);
    });
  });
});
