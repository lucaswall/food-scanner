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
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.type).toBe("object");
    expect(SEARCH_FOOD_LOG_TOOL.input_schema.properties).toHaveProperty("query");
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

  it("SEARCH_FOOD_LOG_TOOL has additionalProperties: false and required array", () => {
    const schema = SEARCH_FOOD_LOG_TOOL.input_schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["query", "date", "from_date", "to_date", "meal_type", "limit"]);

    // All string params should be nullable
    expect(props.query.type).toEqual(["string", "null"]);
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

  it("GET_NUTRITION_SUMMARY_TOOL has additionalProperties: false and required array", () => {
    const schema = GET_NUTRITION_SUMMARY_TOOL.input_schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["date", "from_date", "to_date"]);

    // All string params should be nullable
    expect(props.date.type).toEqual(["string", "null"]);
    expect(props.from_date.type).toEqual(["string", "null"]);
    expect(props.to_date.type).toEqual(["string", "null"]);
  });

  it("GET_FASTING_INFO_TOOL has additionalProperties: false and required array", () => {
    const schema = GET_FASTING_INFO_TOOL.input_schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    expect(schema.additionalProperties).toBe(false);
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

  it("executes query-only search", async () => {
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
      { query: "pizza" },
      "user-123",
      "2026-02-15"
    );

    expect(mockSearchFoods).toHaveBeenCalledWith("user-123", "pizza", { limit: 10 });
    expect(result).toContain("Pizza napolitana");
    expect(result).toContain("300g");
    expect(result).toContain("600 cal");
    expect(result).toContain("Lunch");
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

    expect(mockGetDailyNutritionSummary).toHaveBeenCalledWith("user-123", "2026-02-15");
    expect(result).toContain("Breakfast");
    expect(result).toContain("Café con leche");
    expect(result).toContain("100 cal");
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
    });
    expect(result).toContain("Pizza");
    expect(result).toContain("2026-02-15");
  });

  it("respects user-specified limit for date range output", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
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

    expect(mockGetDailyNutritionSummary).toHaveBeenCalledWith("user-123", "2026-02-15");
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

    expect(mockGetDateRangeNutritionSummary).toHaveBeenCalledWith("user-123", "2026-02-10", "2026-02-11");
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

    expect(mockGetFastingWindow).toHaveBeenCalledWith("user-123", "2026-02-15");
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

    expect(mockGetFastingWindows).toHaveBeenCalledWith("user-123", "2026-02-10", "2026-02-11");
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

    expect(mockGetFastingWindow).toHaveBeenCalledWith("user-123", "2026-02-15");
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
    ).rejects.toThrow("At least one of query, date, or from_date+to_date must be provided");
  });

  it("throws error for get_nutrition_summary without required parameters", async () => {
    await expect(
      executeTool("get_nutrition_summary", {}, "user-123", "2026-02-15")
    ).rejects.toThrow("At least one of date or from_date+to_date must be provided");
  });

  it("search_food_log accepts null parameters (falsy check works)", async () => {
    mockSearchFoods.mockResolvedValue([]);

    // All params null except query - should work
    const result = await executeTool(
      "search_food_log",
      { query: "pizza", date: null, from_date: null, to_date: null, meal_type: null, limit: null },
      "user-123",
      "2026-02-15"
    );

    expect(result).toContain("No foods found");
    expect(mockSearchFoods).toHaveBeenCalledWith("user-123", "pizza", { limit: 10 });
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
    expect(mockGetDailyNutritionSummary).toHaveBeenCalledWith("user-123", "2026-02-15");
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
    expect(mockGetFastingWindow).toHaveBeenCalledWith("user-123", "2026-02-15");
  });
});
