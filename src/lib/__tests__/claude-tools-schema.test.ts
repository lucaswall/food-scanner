import { describe, it, expect, vi } from "vitest";
import { REPORT_NUTRITION_TOOL } from "@/lib/claude-tools-schema";

// Mocks required to import chat-tools (it pulls in DB-layer modules)
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/food-log", () => ({
  searchFoods: vi.fn(),
  getDailyNutritionSummary: vi.fn(),
  getDateRangeNutritionSummary: vi.fn(),
  getFoodLogHistory: vi.fn(),
}));
vi.mock("@/lib/fasting", () => ({
  getFastingWindow: vi.fn(),
  getFastingWindows: vi.fn(),
}));
vi.mock("@/lib/daily-goals", () => ({
  getOrComputeDailyGoals: vi.fn(),
}));
vi.mock("@/lib/nutrition-labels", () => ({
  searchLabels: vi.fn(),
  insertLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
  findDuplicateLabel: vi.fn(),
}));

const {
  SEARCH_FOOD_LOG_TOOL,
  GET_NUTRITION_SUMMARY_TOOL,
  GET_FASTING_INFO_TOOL,
  SEARCH_NUTRITION_LABELS_TOOL,
  SAVE_NUTRITION_LABEL_TOOL,
  MANAGE_NUTRITION_LABEL_TOOL,
} = await import("@/lib/chat-tools");

// FOO-1157: Core numeric fields of REPORT_NUTRITION_TOOL must have descriptions
// so Claude understands the expected values and units.
describe("REPORT_NUTRITION_TOOL schema — numeric field descriptions", () => {
  const props = REPORT_NUTRITION_TOOL.input_schema.properties as Record<string, { type: string; description?: string }>;

  const numericFields = ["calories", "protein_g", "carbs_g", "fat_g", "fiber_g", "sodium_mg"] as const;

  for (const field of numericFields) {
    it(`${field} has a non-empty description`, () => {
      expect(props[field]).toBeDefined();
      expect(typeof props[field].description).toBe("string");
      expect((props[field].description as string).length).toBeGreaterThan(0);
    });
  }
});

// FOO-1165: Tools made strict in FOO-1157 must keep strict:true and
// additionalProperties:false so regressions are caught by this suite.
describe("Claude tool strict mode — FOO-1157 regression guard", () => {
  it("REPORT_NUTRITION_TOOL has strict:true", () => {
    expect(REPORT_NUTRITION_TOOL.strict).toBe(true);
  });

  it("REPORT_NUTRITION_TOOL input_schema has additionalProperties:false", () => {
    expect(REPORT_NUTRITION_TOOL.input_schema.additionalProperties).toBe(false);
  });

  it("SEARCH_FOOD_LOG_TOOL has strict:true", () => {
    expect(SEARCH_FOOD_LOG_TOOL.strict).toBe(true);
  });

  it("SEARCH_FOOD_LOG_TOOL input_schema has additionalProperties:false", () => {
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.additionalProperties).toBe(false);
  });

  it("GET_NUTRITION_SUMMARY_TOOL has strict:true", () => {
    expect(GET_NUTRITION_SUMMARY_TOOL.strict).toBe(true);
  });

  it("GET_NUTRITION_SUMMARY_TOOL input_schema has additionalProperties:false", () => {
    expect(GET_NUTRITION_SUMMARY_TOOL.input_schema.additionalProperties).toBe(false);
  });

  it("GET_FASTING_INFO_TOOL has strict:true", () => {
    expect(GET_FASTING_INFO_TOOL.strict).toBe(true);
  });

  it("GET_FASTING_INFO_TOOL input_schema has additionalProperties:false", () => {
    expect(GET_FASTING_INFO_TOOL.input_schema.additionalProperties).toBe(false);
  });

  it("SEARCH_NUTRITION_LABELS_TOOL has strict:true", () => {
    expect(SEARCH_NUTRITION_LABELS_TOOL.strict).toBe(true);
  });

  it("SEARCH_NUTRITION_LABELS_TOOL input_schema has additionalProperties:false", () => {
    expect(SEARCH_NUTRITION_LABELS_TOOL.input_schema.additionalProperties).toBe(false);
  });

  // SAVE_NUTRITION_LABEL_TOOL and MANAGE_NUTRITION_LABEL_TOOL are intentionally
  // non-strict: extra_nutrients is an open key-value dict whose keys vary per product.
  // Strict mode would require additionalProperties:false on ALL nested objects,
  // breaking support for arbitrary nutrient keys. Document this as the expected state.
  it("SAVE_NUTRITION_LABEL_TOOL is intentionally non-strict (open extra_nutrients dict)", () => {
    expect(SAVE_NUTRITION_LABEL_TOOL.strict).toBeFalsy();
  });

  it("MANAGE_NUTRITION_LABEL_TOOL is intentionally non-strict (open extra_nutrients dict)", () => {
    expect(MANAGE_NUTRITION_LABEL_TOOL.strict).toBeFalsy();
  });
});

// FOO-1165: SEARCH_FOOD_LOG_TOOL meal_type restructure for strict-mode compatibility
describe("SEARCH_FOOD_LOG_TOOL meal_type strict-mode compatibility", () => {
  it("meal_type type array includes null so Claude can omit filtering", () => {
    const props = SEARCH_FOOD_LOG_TOOL.input_schema.properties as Record<string, { type: unknown; enum?: unknown[] }>;
    const mealType = props.meal_type;
    expect(Array.isArray(mealType.type)).toBe(true);
    expect((mealType.type as string[]).includes("null")).toBe(true);
  });

  it("meal_type enum includes null as a valid value", () => {
    const props = SEARCH_FOOD_LOG_TOOL.input_schema.properties as Record<string, { type: unknown; enum?: unknown[] }>;
    const mealType = props.meal_type;
    expect(mealType.enum).toBeDefined();
    expect((mealType.enum as unknown[]).includes(null)).toBe(true);
  });
});
