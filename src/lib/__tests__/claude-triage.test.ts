import { describe, it, expect, vi } from "vitest";

vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  startTimer: vi.fn(() => () => 0),
}));
vi.mock("@/lib/claude-usage", () => ({ recordUsage: vi.fn() }));
vi.mock("@/lib/user-profile", () => ({ buildUserProfile: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/chat-tools", () => ({
  executeTool: vi.fn(),
  SEARCH_FOOD_LOG_TOOL: { name: "search_food_log", input_schema: { type: "object", properties: {} } },
  GET_NUTRITION_SUMMARY_TOOL: { name: "get_nutrition_summary", input_schema: { type: "object", properties: {} } },
  GET_FASTING_INFO_TOOL: { name: "get_fasting_info", input_schema: { type: "object", properties: {} } },
  SEARCH_NUTRITION_LABELS_TOOL: { name: "search_nutrition_labels", input_schema: { type: "object", properties: {} } },
  SAVE_NUTRITION_LABEL_TOOL: { name: "save_nutrition_label", input_schema: { type: "object", properties: {} } },
  MANAGE_NUTRITION_LABEL_TOOL: { name: "manage_nutrition_label", input_schema: { type: "object", properties: {} } },
}));

const {
  validateSessionItems,
  REPORT_SESSION_ITEMS_TOOL,
  TRIAGE_SYSTEM_PROMPT,
} = await import("@/lib/claude");

// Helper to build a valid item for validateSessionItems (as Claude would return it)
function makeValidItem(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    food_name: "Empanada de carne",
    amount: 150,
    unit_id: 147,
    calories: 320,
    protein_g: 12,
    carbs_g: 28,
    fat_g: 18,
    fiber_g: 2,
    sodium_mg: 450,
    saturated_fat_g: 6,
    trans_fat_g: 0,
    sugars_g: 1,
    calories_from_fat: 162,
    confidence: "high",
    notes: "Standard baked empanada",
    description: "Baked beef empanada",
    keywords: ["empanada", "carne"],
    time: "12:30",
    meal_type_id: 3,
    date: "2026-04-09",
    capture_indices: [0, 1],
    ...overrides,
  };
}

describe("validateSessionItems", () => {
  it("validates and returns array of valid items", () => {
    const input = [makeValidItem(), makeValidItem({ food_name: "Ensalada mixta", calories: 120 })];
    const result = validateSessionItems(input);

    expect(result).toHaveLength(2);
    expect(result[0].food_name).toBe("Empanada de carne");
    expect(result[1].food_name).toBe("Ensalada mixta");
  });

  it("filters out invalid items missing required fields", () => {
    const input = [
      makeValidItem(), // valid
      { food_name: "", amount: 100, unit_id: 147, calories: 100, protein_g: 5, carbs_g: 10, fat_g: 3, fiber_g: 1, sodium_mg: 100, confidence: "high", notes: "", description: "", keywords: [], time: "12:30", meal_type_id: 3, date: "2026-04-09", capture_indices: [] }, // invalid: empty food_name
      makeValidItem({ food_name: "Valid item 2", calories: 200 }), // valid
    ];
    const result = validateSessionItems(input);

    expect(result).toHaveLength(2);
    expect(result[0].food_name).toBe("Empanada de carne");
    expect(result[1].food_name).toBe("Valid item 2");
  });

  it("returns empty array for non-array input", () => {
    expect(validateSessionItems(null)).toEqual([]);
    expect(validateSessionItems(undefined)).toEqual([]);
    expect(validateSessionItems("not an array")).toEqual([]);
    expect(validateSessionItems(42)).toEqual([]);
    expect(validateSessionItems({})).toEqual([]);
  });

  it("returns empty array for empty array input", () => {
    expect(validateSessionItems([])).toEqual([]);
  });

  it("strips capture_indices from results (UI-only, not part of FoodAnalysis)", () => {
    const input = [makeValidItem({ capture_indices: [0, 2, 4] })];
    const result = validateSessionItems(input);

    expect(result).toHaveLength(1);
    expect((result[0] as unknown as Record<string, unknown>)["capture_indices"]).toBeUndefined();
  });

  it("reuses validateFoodAnalysis normalization — coerces keywords from food_name when empty", () => {
    const input = [makeValidItem({ keywords: [] })];
    const result = validateSessionItems(input);

    // validateFoodAnalysis derives keywords from food_name when empty
    expect(result).toHaveLength(1);
    expect(result[0].keywords.length).toBeGreaterThan(0);
  });

  it("reuses validateFoodAnalysis normalization — normalizes time format", () => {
    const input = [makeValidItem({ time: "09:05" })];
    const result = validateSessionItems(input);

    expect(result).toHaveLength(1);
    expect(result[0].time).toBe("09:05");
  });

  it("filters out item with invalid time format", () => {
    const input = [
      makeValidItem({ time: "not-a-time" }),
      makeValidItem({ food_name: "Good item" }),
    ];
    const result = validateSessionItems(input);

    // Invalid time causes validateFoodAnalysis to throw → item is filtered out
    expect(result).toHaveLength(1);
    expect(result[0].food_name).toBe("Good item");
  });

  it("filters out item with negative calories", () => {
    const input = [
      makeValidItem({ calories: -100 }),
      makeValidItem({ food_name: "Good item" }),
    ];
    const result = validateSessionItems(input);

    expect(result).toHaveLength(1);
    expect(result[0].food_name).toBe("Good item");
  });
});

describe("REPORT_SESSION_ITEMS_TOOL", () => {
  it("has correct name", () => {
    expect(REPORT_SESSION_ITEMS_TOOL.name).toBe("report_session_items");
  });

  it("has strict mode enabled", () => {
    expect(REPORT_SESSION_ITEMS_TOOL.strict).toBe(true);
  });

  it("requires an items array", () => {
    const schema = REPORT_SESSION_ITEMS_TOOL.input_schema;
    expect(schema.type).toBe("object");
    expect(schema.required).toContain("items");
    const properties = schema.properties as Record<string, unknown>;
    const itemsProp = properties["items"] as Record<string, unknown>;
    expect(itemsProp.type).toBe("array");
  });

  it("item schema includes all required nutrition fields", () => {
    const schema = REPORT_SESSION_ITEMS_TOOL.input_schema;
    const properties = schema.properties as Record<string, unknown>;
    const itemsProp = properties["items"] as { type: string; items: { required: string[] } };
    const itemRequired = itemsProp.items.required;

    expect(itemRequired).toContain("food_name");
    expect(itemRequired).toContain("amount");
    expect(itemRequired).toContain("unit_id");
    expect(itemRequired).toContain("calories");
    expect(itemRequired).toContain("protein_g");
    expect(itemRequired).toContain("carbs_g");
    expect(itemRequired).toContain("fat_g");
    expect(itemRequired).toContain("fiber_g");
    expect(itemRequired).toContain("sodium_mg");
    expect(itemRequired).toContain("confidence");
    expect(itemRequired).toContain("notes");
    expect(itemRequired).toContain("description");
    expect(itemRequired).toContain("keywords");
  });

  it("item schema includes triage-specific required fields (time, date, meal_type_id)", () => {
    const schema = REPORT_SESSION_ITEMS_TOOL.input_schema;
    const properties = schema.properties as Record<string, unknown>;
    const itemsProp = properties["items"] as { type: string; items: { required: string[] } };
    const itemRequired = itemsProp.items.required;

    expect(itemRequired).toContain("time");
    expect(itemRequired).toContain("date");
    expect(itemRequired).toContain("meal_type_id");
    expect(itemRequired).toContain("capture_indices");
  });

  it("item schema does NOT include source_custom_food_id or editing_entry_id", () => {
    const schema = REPORT_SESSION_ITEMS_TOOL.input_schema;
    const properties = schema.properties as Record<string, unknown>;
    const itemsProp = properties["items"] as { type: string; items: { properties: Record<string, unknown> } };
    const itemProperties = itemsProp.items.properties;

    expect(itemProperties).not.toHaveProperty("source_custom_food_id");
    expect(itemProperties).not.toHaveProperty("editing_entry_id");
  });

  it("has additionalProperties false at the top level", () => {
    expect(REPORT_SESSION_ITEMS_TOOL.input_schema.additionalProperties).toBe(false);
  });
});

describe("TRIAGE_SYSTEM_PROMPT", () => {
  it("instructs to analyze a collection of food captures", () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain("capture");
  });

  it("instructs NOT to use data tools", () => {
    // Should mention not using search_food_log or data tools
    expect(TRIAGE_SYSTEM_PROMPT.toLowerCase()).toMatch(/do not use|don't use|no data tool/);
  });

  it("instructs to always call report_session_items", () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain("report_session_items");
  });

  it("mentions capture timestamps for context", () => {
    expect(TRIAGE_SYSTEM_PROMPT.toLowerCase()).toContain("timestamp");
  });

  it("explains menu photo context", () => {
    expect(TRIAGE_SYSTEM_PROMPT.toLowerCase()).toContain("menu");
  });

  it("instructs to assign meal_type_id based on capture times", () => {
    expect(TRIAGE_SYSTEM_PROMPT).toContain("meal_type_id");
  });
});
