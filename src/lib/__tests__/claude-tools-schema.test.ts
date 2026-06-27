import { describe, it, expect, vi } from "vitest";
import { REPORT_NUTRITION_TOOL, REPORT_SESSION_ITEMS_TOOL, WEB_SEARCH_TOOL } from "@/lib/claude-tools-schema";

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

// Strict mode is for data-WRITING tools only. The data-QUERY tools
// (search_food_log, get_nutrition_summary, get_fasting_info) MUST stay non-strict:
// strict mode 400s POST /api/analyze-food via the 16-union-param cap and the
// nullable-enum rejection (FOOD-SCANNER-6). This has regressed 3× (PR #90/#113/#144);
// these assertions are the guard against a 4th.
describe("Claude tool strict mode — FOOD-SCANNER-6 regression guard", () => {
  it("REPORT_NUTRITION_TOOL has strict:true", () => {
    expect(REPORT_NUTRITION_TOOL.strict).toBe(true);
  });

  it("REPORT_NUTRITION_TOOL input_schema has additionalProperties:false", () => {
    expect(REPORT_NUTRITION_TOOL.input_schema.additionalProperties).toBe(false);
  });

  it("SEARCH_FOOD_LOG_TOOL is NOT strict (would 400 analyze-food)", () => {
    expect(SEARCH_FOOD_LOG_TOOL.strict).toBeFalsy();
  });

  it("SEARCH_FOOD_LOG_TOOL input_schema does NOT set additionalProperties:false", () => {
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.additionalProperties).toBeUndefined();
  });

  it("GET_NUTRITION_SUMMARY_TOOL is NOT strict (would 400 analyze-food)", () => {
    expect(GET_NUTRITION_SUMMARY_TOOL.strict).toBeFalsy();
  });

  it("GET_NUTRITION_SUMMARY_TOOL input_schema does NOT set additionalProperties:false", () => {
    expect(GET_NUTRITION_SUMMARY_TOOL.input_schema.additionalProperties).toBeUndefined();
  });

  it("GET_FASTING_INFO_TOOL is NOT strict (would 400 analyze-food)", () => {
    expect(GET_FASTING_INFO_TOOL.strict).toBeFalsy();
  });

  it("GET_FASTING_INFO_TOOL input_schema does NOT set additionalProperties:false", () => {
    expect(GET_FASTING_INFO_TOOL.input_schema.additionalProperties).toBeUndefined();
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

  // FOO-1170: REPORT_SESSION_ITEMS_TOOL is a custom-schema tool with strict mode;
  // guard against a regression dropping it.
  it("REPORT_SESSION_ITEMS_TOOL has strict:true", () => {
    expect(REPORT_SESSION_ITEMS_TOOL.strict).toBe(true);
  });

  it("REPORT_SESSION_ITEMS_TOOL input_schema has additionalProperties:false", () => {
    expect((REPORT_SESSION_ITEMS_TOOL.input_schema as { additionalProperties?: unknown }).additionalProperties).toBe(false);
  });

  // FOO-1170: WEB_SEARCH_TOOL is a server-side built-in tool (type "web_search_*"),
  // not a custom JSON-schema tool — it has no input_schema, so strict /
  // additionalProperties do not apply. Lock in that it stays a server tool.
  it("WEB_SEARCH_TOOL is a server-side tool with no custom input schema (intentionally excluded from strict mode)", () => {
    expect(WEB_SEARCH_TOOL.type).toMatch(/^web_search_/);
    expect((WEB_SEARCH_TOOL as { input_schema?: unknown }).input_schema).toBeUndefined();
    expect((WEB_SEARCH_TOOL as { strict?: unknown }).strict).toBeUndefined();
  });
});

// FOOD-SCANNER-6: meal_type uses anyOf[string-enum, null] (the non-strict form).
// A `type: ["string","null"]` + string `enum` combo is rejected by the API under
// strict mode, so the nullable enum must be expressed via anyOf instead.
describe("SEARCH_FOOD_LOG_TOOL meal_type nullable enum", () => {
  it("meal_type uses anyOf with a string-enum branch and a null branch", () => {
    const props = SEARCH_FOOD_LOG_TOOL.input_schema.properties as Record<string, { type?: unknown; enum?: unknown[]; anyOf?: Array<{ type?: unknown; enum?: unknown[] }> }>;
    const mealType = props.meal_type;
    expect(Array.isArray(mealType.anyOf)).toBe(true);
    const branches = mealType.anyOf!;
    const enumBranch = branches.find((b) => Array.isArray(b.enum));
    const nullBranch = branches.find((b) => b.type === "null");
    expect(enumBranch).toBeDefined();
    expect(nullBranch).toBeDefined();
    expect(enumBranch!.enum).toContain("breakfast");
    // The enum branch must NOT itself include null — null is expressed by the separate branch.
    expect((enumBranch!.enum as unknown[]).includes(null)).toBe(false);
  });
});
