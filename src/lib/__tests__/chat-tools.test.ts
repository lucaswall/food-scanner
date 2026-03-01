import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock food-log functions
const mockSearchFoods = vi.fn();
const mockGetDailyNutritionSummary = vi.fn();
const mockGetDateRangeNutritionSummary = vi.fn();
const mockGetFoodLogHistory = vi.fn();
vi.mock("@/lib/food-log", () => ({
  searchFoods: (...args: unknown[]) => mockSearchFoods(...args),
  getDailyNutritionSummary: (...args: unknown[]) => mockGetDailyNutritionSummary(...args),
  getDateRangeNutritionSummary: (...args: unknown[]) => mockGetDateRangeNutritionSummary(...args),
  getFoodLogHistory: (...args: unknown[]) => mockGetFoodLogHistory(...args),
}));

// Mock fasting functions
const mockGetFastingWindow = vi.fn();
const mockGetFastingWindows = vi.fn();
vi.mock("@/lib/fasting", () => ({
  getFastingWindow: (...args: unknown[]) => mockGetFastingWindow(...args),
  getFastingWindows: (...args: unknown[]) => mockGetFastingWindows(...args),
}));

// Mock lumen functions
const mockGetLumenGoalsByDate = vi.fn();
vi.mock("@/lib/lumen", () => ({
  getLumenGoalsByDate: (...args: unknown[]) => mockGetLumenGoalsByDate(...args),
}));

// Mock nutrition-goals functions
const mockGetCalorieGoalsByDateRange = vi.fn();
vi.mock("@/lib/nutrition-goals", () => ({
  getCalorieGoalsByDateRange: (...args: unknown[]) => mockGetCalorieGoalsByDateRange(...args),
}));

import {
  SEARCH_FOOD_LOG_TOOL,
  GET_NUTRITION_SUMMARY_TOOL,
  GET_FASTING_INFO_TOOL,
  executeTool,
} from "@/lib/chat-tools";

describe("Chat Tool Definitions", () => {
  it("SEARCH_FOOD_LOG_TOOL has correct schema", () => {
    expect(SEARCH_FOOD_LOG_TOOL.name).toBe("search_food_log");
    expect(SEARCH_FOOD_LOG_TOOL.description).toContain("Search the user's food log");
    expect(SEARCH_FOOD_LOG_TOOL.description).toContain("mutually exclusive");
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.type).toBe("object");
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.properties).toHaveProperty("keywords");
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.properties).toHaveProperty("date");
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.properties).toHaveProperty("from_date");
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.properties).toHaveProperty("to_date");
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.properties).toHaveProperty("meal_type");
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.properties).toHaveProperty("limit");
  });

  it("GET_NUTRITION_SUMMARY_TOOL has correct schema", () => {
    expect(GET_NUTRITION_SUMMARY_TOOL.name).toBe("get_nutrition_summary");
    expect(GET_NUTRITION_SUMMARY_TOOL.description).toContain("nutrition summary");
    expect(GET_NUTRITION_SUMMARY_TOOL.input_schema.type).toBe("object");
    expect(GET_NUTRITION_SUMMARY_TOOL.input_schema.properties).toHaveProperty("date");
    expect(GET_NUTRITION_SUMMARY_TOOL.input_schema.properties).toHaveProperty("from_date");
    expect(GET_NUTRITION_SUMMARY_TOOL.input_schema.properties).toHaveProperty("to_date");
  });

  it("GET_FASTING_INFO_TOOL has correct schema", () => {
    expect(GET_FASTING_INFO_TOOL.name).toBe("get_fasting_info");
    expect(GET_FASTING_INFO_TOOL.description).toContain("fasting window");
    expect(GET_FASTING_INFO_TOOL.input_schema.type).toBe("object");
    expect(GET_FASTING_INFO_TOOL.input_schema.properties).toHaveProperty("date");
    expect(GET_FASTING_INFO_TOOL.input_schema.properties).toHaveProperty("from_date");
    expect(GET_FASTING_INFO_TOOL.input_schema.properties).toHaveProperty("to_date");
  });

  it("SEARCH_FOOD_LOG_TOOL is non-strict with required array", () => {
    const schema = SEARCH_FOOD_LOG_TOOL.input_schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    // Data query tools are non-strict to stay under the 16 union-type parameter limit
    expect(SEARCH_FOOD_LOG_TOOL).not.toHaveProperty("strict");
    expect(schema).not.toHaveProperty("additionalProperties");
    expect(schema.required).toEqual(["keywords", "date", "from_date", "to_date", "meal_type", "limit"]);

    // keywords should be an array of strings
    expect(props.keywords.type).toBe("array");
    expect((props.keywords as Record<string, unknown>).items).toEqual({ type: "string" });
    expect(props.date.type).toEqual(["string", "null"]);
    expect(props.from_date.type).toEqual(["string", "null"]);
    expect(props.to_date.type).toEqual(["string", "null"]);

    // meal_type should use anyOf with enum and null
    expect(props.meal_type.anyOf).toBeDefined();
    expect(props.meal_type.anyOf).toContainEqual({
      type: "string",
      enum: ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "anytime"],
    });
    expect(props.meal_type.anyOf).toContainEqual({ type: "null" });

    // limit should be nullable number
    expect(props.limit.type).toEqual(["number", "null"]);
  });

  it("GET_NUTRITION_SUMMARY_TOOL is non-strict with required array", () => {
    const schema = GET_NUTRITION_SUMMARY_TOOL.input_schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    expect(GET_NUTRITION_SUMMARY_TOOL).not.toHaveProperty("strict");
    expect(schema).not.toHaveProperty("additionalProperties");
    expect(schema.required).toEqual(["date", "from_date", "to_date"]);

    // All string params should be nullable
    expect(props.date.type).toEqual(["string", "null"]);
    expect(props.from_date.type).toEqual(["string", "null"]);
    expect(props.to_date.type).toEqual(["string", "null"]);
  });

  it("GET_FASTING_INFO_TOOL is non-strict with required array", () => {
    const schema = GET_FASTING_INFO_TOOL.input_schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    expect(GET_FASTING_INFO_TOOL).not.toHaveProperty("strict");
    expect(schema).not.toHaveProperty("additionalProperties");
    expect(schema.required).toEqual(["date", "from_date", "to_date"]);

    // All string params should be nullable
    expect(props.date.type).toEqual(["string", "null"]);
    expect(props.from_date.type).toEqual(["string", "null"]);
    expect(props.to_date.type).toEqual(["string", "null"]);
  });
});

describe("executeTool - search_food_log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes keyword-only search", async () => {
    mockSearchFoods.mockResolvedValue([
      {
        customFoodId: 1,
        foodName: "Pizza napolitana",
        amount: 300,
        unitId: 147,
        calories: 600,
        proteinG: 25,
        carbsG: 70,
        fatG: 20,
        fiberG: 5,
        sodiumMg: 800,
        saturatedFatG: 8,
        transFatG: null,
        sugarsG: 5,
        caloriesFromFat: null,
        fitbitFoodId: 12345,
        mealTypeId: 3,
      },
    ]);

    const result = await executeTool(
      "search_food_log",
      { keywords: ["pizza"] },
      "user-123",
      "2026-02-15"
    );

    expect(mockSearchFoods).toHaveBeenCalledWith("user-123", ["pizza"], { limit: 10 }, expect.anything());
    expect(result).toContain("[id:1]");
    expect(result).toContain("Pizza napolitana");
    expect(result).toContain("300g");
    expect(result).toContain("600 cal");
    expect(result).toContain("Lunch");
  });

  it("executes keyword search with multiple keywords", async () => {
    mockSearchFoods.mockResolvedValue([
      {
        customFoodId: 5,
        foodName: "Té con leche",
        amount: 250,
        unitId: 209,
        calories: 80,
        proteinG: 4,
        carbsG: 10,
        fatG: 2,
        fiberG: 0,
        sodiumMg: 50,
        saturatedFatG: null,
        transFatG: null,
        sugarsG: null,
        caloriesFromFat: null,
        fitbitFoodId: 555,
        mealTypeId: 1,
      },
    ]);

    const result = await executeTool(
      "search_food_log",
      { keywords: ["te", "leche"] },
      "user-123",
      "2026-02-15"
    );

    expect(mockSearchFoods).toHaveBeenCalledWith("user-123", ["te", "leche"], { limit: 10 }, expect.anything());
    expect(result).toContain("Té con leche");
  });

  it("executes date-only search", async () => {
    mockGetDailyNutritionSummary.mockResolvedValue({
      date: "2026-02-15",
      meals: [
        {
          mealTypeId: 1,
          entries: [
            {
              id: 1,
              customFoodId: 10,
              foodName: "Café con leche",
              time: "08:00:00",
              calories: 100,
              proteinG: 5,
              carbsG: 12,
              fatG: 3,
              fiberG: 0,
              sodiumMg: 50,
              saturatedFatG: null,
              transFatG: null,
              sugarsG: null,
              caloriesFromFat: null,
            },
          ],
          subtotal: {
            calories: 100,
            proteinG: 5,
            carbsG: 12,
            fatG: 3,
            fiberG: 0,
            sodiumMg: 50,
            saturatedFatG: 0,
            transFatG: 0,
            sugarsG: 0,
            caloriesFromFat: 0,
          },
        },
      ],
      totals: {
        calories: 100,
        proteinG: 5,
        carbsG: 12,
        fatG: 3,
        fiberG: 0,
        sodiumMg: 50,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
    });

    const result = await executeTool(
      "search_food_log",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15"
    );

    expect(mockGetDailyNutritionSummary).toHaveBeenCalledWith("user-123", "2026-02-15", expect.anything());
    expect(result).toContain("[id:10]");
    expect(result).toContain("[entry:1]");
    expect(result).toContain("Breakfast");
    expect(result).toContain("Café con leche");
    expect(result).toContain("100 cal");
  });

  it("date search includes [entry:N] marker with food_log_entries.id", async () => {
    mockGetDailyNutritionSummary.mockResolvedValue({
      date: "2026-02-15",
      meals: [
        {
          mealTypeId: 3,
          entries: [
            {
              id: 42,
              customFoodId: 7,
              foodName: "Empanada de carne",
              time: "13:00:00",
              calories: 300,
              proteinG: 15,
              carbsG: 25,
              fatG: 15,
              fiberG: 2,
              sodiumMg: 400,
              saturatedFatG: null,
              transFatG: null,
              sugarsG: null,
              caloriesFromFat: null,
            },
          ],
          subtotal: {
            calories: 300,
            proteinG: 15,
            carbsG: 25,
            fatG: 15,
            fiberG: 2,
            sodiumMg: 400,
            saturatedFatG: 0,
            transFatG: 0,
            sugarsG: 0,
            caloriesFromFat: 0,
          },
        },
      ],
      totals: {
        calories: 300,
        proteinG: 15,
        carbsG: 25,
        fatG: 15,
        fiberG: 2,
        sodiumMg: 400,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
    });

    const result = await executeTool(
      "search_food_log",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15"
    );

    // [id:N] is customFoodId, [entry:N] is food_log_entries.id — must be different values
    expect(result).toContain("[id:7]");
    expect(result).toContain("[entry:42]");
    expect(result).not.toContain("[entry:7]");
  });

  it("executes date search with meal_type filter", async () => {
    mockGetDailyNutritionSummary.mockResolvedValue({
      date: "2026-02-15",
      meals: [
        {
          mealTypeId: 1,
          entries: [
            {
              id: 1,
              customFoodId: 10,
              foodName: "Café con leche",
              time: "08:00:00",
              calories: 100,
              proteinG: 5,
              carbsG: 12,
              fatG: 3,
              fiberG: 0,
              sodiumMg: 50,
              saturatedFatG: null,
              transFatG: null,
              sugarsG: null,
              caloriesFromFat: null,
            },
          ],
          subtotal: {
            calories: 100,
            proteinG: 5,
            carbsG: 12,
            fatG: 3,
            fiberG: 0,
            sodiumMg: 50,
            saturatedFatG: 0,
            transFatG: 0,
            sugarsG: 0,
            caloriesFromFat: 0,
          },
        },
        {
          mealTypeId: 3,
          entries: [
            {
              id: 2,
              customFoodId: 20,
              foodName: "Pizza",
              time: "13:00:00",
              calories: 600,
              proteinG: 25,
              carbsG: 70,
              fatG: 20,
              fiberG: 5,
              sodiumMg: 800,
              saturatedFatG: null,
              transFatG: null,
              sugarsG: null,
              caloriesFromFat: null,
            },
          ],
          subtotal: {
            calories: 600,
            proteinG: 25,
            carbsG: 70,
            fatG: 20,
            fiberG: 5,
            sodiumMg: 800,
            saturatedFatG: 0,
            transFatG: 0,
            sugarsG: 0,
            caloriesFromFat: 0,
          },
        },
      ],
      totals: {
        calories: 700,
        proteinG: 30,
        carbsG: 82,
        fatG: 23,
        fiberG: 5,
        sodiumMg: 850,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
    });

    const result = await executeTool(
      "search_food_log",
      { date: "2026-02-15", meal_type: "lunch" },
      "user-123",
      "2026-02-15"
    );

    expect(result).toContain("Lunch");
    expect(result).toContain("Pizza");
    expect(result).not.toContain("Breakfast");
    expect(result).not.toContain("Café con leche");
  });

  it("executes date range search", async () => {
    mockGetFoodLogHistory.mockResolvedValue([
      {
        id: 1,
        customFoodId: 5,
        foodName: "Pizza",
        calories: 600,
        proteinG: 25,
        carbsG: 70,
        fatG: 20,
        fiberG: 5,
        sodiumMg: 800,
        saturatedFatG: 8,
        transFatG: null,
        sugarsG: 5,
        caloriesFromFat: null,
        amount: 300,
        unitId: 147,
        mealTypeId: 3,
        date: "2026-02-15",
        time: "13:00:00",
        fitbitLogId: 123,
      },
    ]);

    const result = await executeTool(
      "search_food_log",
      { from_date: "2026-02-10", to_date: "2026-02-15" },
      "user-123",
      "2026-02-15"
    );

    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-123", {
      startDate: "2026-02-10",
      endDate: "2026-02-15",
      limit: 100,
    }, expect.anything());
    expect(result).toContain("[id:5]");
    expect(result).toContain("[entry:1]");
    expect(result).toContain("Pizza");
    expect(result).toContain("2026-02-15");
  });

  it("keyword search does NOT include [entry:N] marker", async () => {
    mockSearchFoods.mockResolvedValue([
      {
        customFoodId: 3,
        foodName: "Milanesa",
        amount: 200,
        unitId: 147,
        calories: 400,
        proteinG: 30,
        carbsG: 20,
        fatG: 22,
        fiberG: 1,
        sodiumMg: 500,
        saturatedFatG: null,
        transFatG: null,
        sugarsG: null,
        caloriesFromFat: null,
        fitbitFoodId: 999,
        mealTypeId: 5,
      },
    ]);

    const result = await executeTool(
      "search_food_log",
      { keywords: ["milanesa"] },
      "user-123",
      "2026-02-15"
    );

    expect(result).toContain("[id:3]");
    expect(result).not.toMatch(/\[entry:\d+\]/);
  });

  it("respects user-specified limit for date range output", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      customFoodId: i + 100,
      foodName: `Food ${i + 1}`,
      calories: 200,
      proteinG: 10,
      carbsG: 20,
      fatG: 8,
      fiberG: 2,
      sodiumMg: 300,
      saturatedFatG: null,
      transFatG: null,
      sugarsG: null,
      caloriesFromFat: null,
      amount: 100,
      unitId: 147,
      mealTypeId: 3,
      date: `2026-02-1${i}`,
      time: "12:00:00",
      fitbitLogId: null,
    }));
    mockGetFoodLogHistory.mockResolvedValue(entries);

    const result = await executeTool(
      "search_food_log",
      { from_date: "2026-02-10", to_date: "2026-02-15", limit: 3 },
      "user-123",
      "2026-02-15"
    );

    expect(result).toContain("Found 3 entries");
  });
});

describe("executeTool - get_nutrition_summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes single date summary", async () => {
    mockGetDailyNutritionSummary.mockResolvedValue({
      date: "2026-02-15",
      meals: [],
      totals: {
        calories: 1800,
        proteinG: 90,
        carbsG: 200,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        saturatedFatG: 20,
        transFatG: 0,
        sugarsG: 40,
        caloriesFromFat: 540,
      },
    });

    mockGetLumenGoalsByDate.mockResolvedValue({
      date: "2026-02-15",
      dayType: "High Carb",
      proteinGoal: 100,
      carbsGoal: 250,
      fatGoal: 50,
    });

    mockGetCalorieGoalsByDateRange.mockResolvedValue([
      { date: "2026-02-15", calorieGoal: 2000 },
    ]);

    const result = await executeTool(
      "get_nutrition_summary",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15"
    );

    expect(mockGetDailyNutritionSummary).toHaveBeenCalledWith("user-123", "2026-02-15", expect.anything());
    expect(mockGetLumenGoalsByDate).toHaveBeenCalledWith("user-123", "2026-02-15");
    expect(mockGetCalorieGoalsByDateRange).toHaveBeenCalledWith("user-123", "2026-02-15", "2026-02-15");
    expect(result).toContain("1800 cal");
    expect(result).toContain("2000 cal");
    expect(result).toContain("90%");
  });

  it("executes date range summary", async () => {
    mockGetDateRangeNutritionSummary.mockResolvedValue([
      {
        date: "2026-02-10",
        calories: 1800,
        proteinG: 90,
        carbsG: 200,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
        proteinGoalG: 100,
        carbsGoalG: 250,
        fatGoalG: 50,
      },
      {
        date: "2026-02-11",
        calories: 2100,
        proteinG: 110,
        carbsG: 220,
        fatG: 70,
        fiberG: 30,
        sodiumMg: 2200,
        calorieGoal: 2000,
        proteinGoalG: 100,
        carbsGoalG: 250,
        fatGoalG: 50,
      },
    ]);

    const result = await executeTool(
      "get_nutrition_summary",
      { from_date: "2026-02-10", to_date: "2026-02-11" },
      "user-123",
      "2026-02-15"
    );

    expect(mockGetDateRangeNutritionSummary).toHaveBeenCalledWith("user-123", "2026-02-10", "2026-02-11", expect.anything());
    expect(result).toContain("2026-02-10");
    expect(result).toContain("1800 cal");
    expect(result).toContain("2026-02-11");
    expect(result).toContain("2100 cal");
  });
});

describe("executeTool - get_fasting_info", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executes single date fasting", async () => {
    mockGetFastingWindow.mockResolvedValue({
      date: "2026-02-15",
      lastMealTime: "20:00:00",
      firstMealTime: "08:00:00",
      durationMinutes: 720,
    });

    const result = await executeTool(
      "get_fasting_info",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15"
    );

    expect(mockGetFastingWindow).toHaveBeenCalledWith("user-123", "2026-02-15", expect.anything());
    expect(result).toContain("12 hours");
    expect(result).toContain("20:00");
    expect(result).toContain("08:00");
  });

  it("executes single date fasting with null firstMealTime (ongoing fast)", async () => {
    mockGetFastingWindow.mockResolvedValue({
      date: "2026-02-15",
      lastMealTime: "20:00:00",
      firstMealTime: null,
      durationMinutes: null,
    });

    const result = await executeTool(
      "get_fasting_info",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15"
    );

    expect(result).toContain("Currently fasting");
    expect(result).toContain("20:00");
  });

  it("executes date range fasting", async () => {
    mockGetFastingWindows.mockResolvedValue([
      {
        date: "2026-02-10",
        lastMealTime: "20:00:00",
        firstMealTime: "08:00:00",
        durationMinutes: 720,
      },
      {
        date: "2026-02-11",
        lastMealTime: "21:00:00",
        firstMealTime: "09:00:00",
        durationMinutes: 720,
      },
    ]);

    const result = await executeTool(
      "get_fasting_info",
      { from_date: "2026-02-10", to_date: "2026-02-11" },
      "user-123",
      "2026-02-15"
    );

    expect(mockGetFastingWindows).toHaveBeenCalledWith("user-123", "2026-02-10", "2026-02-11", expect.anything());
    expect(result).toContain("2026-02-10");
    expect(result).toContain("12 hours");
    expect(result).toContain("2026-02-11");
  });

  it("defaults to current date when no date provided", async () => {
    mockGetFastingWindow.mockResolvedValue({
      date: "2026-02-15",
      lastMealTime: "20:00:00",
      firstMealTime: "08:00:00",
      durationMinutes: 720,
    });

    await executeTool(
      "get_fasting_info",
      {},
      "user-123",
      "2026-02-15"
    );

    expect(mockGetFastingWindow).toHaveBeenCalledWith("user-123", "2026-02-15", expect.anything());
  });
});

describe("executeTool - error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error for unknown tool", async () => {
    await expect(
      executeTool("unknown_tool", {}, "user-123", "2026-02-15")
    ).rejects.toThrow("Unknown tool: unknown_tool");
  });

  it("throws error for search_food_log without required parameters", async () => {
    await expect(
      executeTool("search_food_log", {}, "user-123", "2026-02-15")
    ).rejects.toThrow("At least one of keywords, date, or from_date+to_date must be provided");
  });

  it("throws error for search_food_log with empty keywords array and no date", async () => {
    await expect(
      executeTool("search_food_log", { keywords: [], date: null, from_date: null, to_date: null }, "user-123", "2026-02-15")
    ).rejects.toThrow("At least one of keywords, date, or from_date+to_date must be provided");
  });

  it("throws error for get_nutrition_summary without required parameters", async () => {
    await expect(
      executeTool("get_nutrition_summary", {}, "user-123", "2026-02-15")
    ).rejects.toThrow("At least one of date or from_date+to_date must be provided");
  });

  it("search_food_log accepts null parameters (falsy check works)", async () => {
    mockSearchFoods.mockResolvedValue([]);

    // All params null except keywords - should work
    const result = await executeTool(
      "search_food_log",
      { keywords: ["pizza"], date: null, from_date: null, to_date: null, meal_type: null, limit: null },
      "user-123",
      "2026-02-15"
    );

    expect(result).toContain("No foods found");
    expect(mockSearchFoods).toHaveBeenCalledWith("user-123", ["pizza"], { limit: 10 }, expect.anything());
  });

  it("get_nutrition_summary accepts null parameters", async () => {
    mockGetDailyNutritionSummary.mockResolvedValue({
      date: "2026-02-15",
      meals: [],
      totals: {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sodiumMg: 0,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
    });

    mockGetLumenGoalsByDate.mockResolvedValue(null);
    mockGetCalorieGoalsByDateRange.mockResolvedValue([]);

    // date provided, from_date and to_date null - should work
    const result = await executeTool(
      "get_nutrition_summary",
      { date: "2026-02-15", from_date: null, to_date: null },
      "user-123",
      "2026-02-15"
    );

    expect(result).toContain("Nutrition summary");
    expect(mockGetDailyNutritionSummary).toHaveBeenCalledWith("user-123", "2026-02-15", expect.anything());
  });

  it("get_fasting_info accepts null parameters", async () => {
    mockGetFastingWindow.mockResolvedValue({
      date: "2026-02-15",
      lastMealTime: "20:00:00",
      firstMealTime: "08:00:00",
      durationMinutes: 720,
    });

    // date provided, from_date and to_date null - should work
    const result = await executeTool(
      "get_fasting_info",
      { date: "2026-02-15", from_date: null, to_date: null },
      "user-123",
      "2026-02-15"
    );

    expect(result).toContain("12 hours");
    expect(mockGetFastingWindow).toHaveBeenCalledWith("user-123", "2026-02-15", expect.anything());
  });
});

describe("executeTool - division-by-zero protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("single-date: does not produce Infinity when calorieGoal is 0", async () => {
    mockGetDailyNutritionSummary.mockResolvedValue({
      date: "2026-02-15",
      meals: [],
      totals: {
        calories: 1500,
        proteinG: 80,
        carbsG: 180,
        fatG: 55,
        fiberG: 20,
        sodiumMg: 1800,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
    });

    mockGetLumenGoalsByDate.mockResolvedValue(null);
    mockGetCalorieGoalsByDateRange.mockResolvedValue([
      { date: "2026-02-15", calorieGoal: 0 },
    ]);

    const result = await executeTool(
      "get_nutrition_summary",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15"
    );

    expect(result).not.toContain("Infinity");
  });

  it("single-date: does not produce Infinity when macro goals are 0", async () => {
    mockGetDailyNutritionSummary.mockResolvedValue({
      date: "2026-02-15",
      meals: [],
      totals: {
        calories: 1500,
        proteinG: 80,
        carbsG: 180,
        fatG: 55,
        fiberG: 20,
        sodiumMg: 1800,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
    });

    mockGetLumenGoalsByDate.mockResolvedValue({
      date: "2026-02-15",
      dayType: "Low Carb",
      proteinGoal: 0,
      carbsGoal: 0,
      fatGoal: 0,
    });

    mockGetCalorieGoalsByDateRange.mockResolvedValue([]);

    const result = await executeTool(
      "get_nutrition_summary",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15"
    );

    expect(result).not.toContain("Infinity");
  });

  it("date-range: does not produce Infinity when calorieGoal is 0", async () => {
    mockGetDateRangeNutritionSummary.mockResolvedValue([
      {
        date: "2026-02-15",
        calories: 1500,
        proteinG: 80,
        carbsG: 180,
        fatG: 55,
        fiberG: 20,
        sodiumMg: 1800,
        calorieGoal: 0,
        proteinGoalG: null,
        carbsGoalG: null,
        fatGoalG: null,
      },
    ]);

    const result = await executeTool(
      "get_nutrition_summary",
      { from_date: "2026-02-15", to_date: "2026-02-15" },
      "user-123",
      "2026-02-15"
    );

    expect(result).not.toContain("Infinity");
  });

  it("date-range: does not produce Infinity when macro goals are 0", async () => {
    mockGetDateRangeNutritionSummary.mockResolvedValue([
      {
        date: "2026-02-15",
        calories: 1500,
        proteinG: 80,
        carbsG: 180,
        fatG: 55,
        fiberG: 20,
        sodiumMg: 1800,
        calorieGoal: 2000,
        proteinGoalG: 0,
        carbsGoalG: 0,
        fatGoalG: 0,
      },
    ]);

    const result = await executeTool(
      "get_nutrition_summary",
      { from_date: "2026-02-15", to_date: "2026-02-15" },
      "user-123",
      "2026-02-15"
    );

    expect(result).not.toContain("Infinity");
  });
});
