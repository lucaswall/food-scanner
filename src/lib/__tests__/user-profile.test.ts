import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockInnerJoin = vi.fn();
const mockWhere = vi.fn();
const mockGroupBy = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: () => ({
    select: mockSelect,
  }),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((a: unknown, b: unknown) => [a, b]),
  gte: vi.fn((a: unknown, b: unknown) => [a, b]),
  asc: vi.fn((a: unknown) => a),
  desc: vi.fn((a: unknown) => a),
  count: vi.fn(() => "count"),
  sql: vi.fn(),
}));

// Mock dependent modules
const mockGetCalorieGoals = vi.fn();
vi.mock("@/lib/nutrition-goals", () => ({
  getCalorieGoalsByDateRange: (...args: unknown[]) => mockGetCalorieGoals(...args),
}));

const mockGetLumenGoals = vi.fn();
vi.mock("@/lib/lumen", () => ({
  getLumenGoalsByDate: (...args: unknown[]) => mockGetLumenGoals(...args),
}));

const mockGetNutritionSummary = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getDailyNutritionSummary: (...args: unknown[]) => mockGetNutritionSummary(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  startTimer: () => () => 42,
}));

const TEST_USER_ID = "user-123";
const TEST_DATE = "2026-03-09";

function setupDefaultMocks() {
  vi.clearAllMocks();

  // Default: no data (new user)
  mockGetCalorieGoals.mockResolvedValue([]);
  mockGetLumenGoals.mockResolvedValue(null);
  mockGetNutritionSummary.mockResolvedValue({
    date: TEST_DATE,
    meals: [],
    totals: {
      calories: 0, proteinG: 0, carbsG: 0, fatG: 0,
      fiberG: 0, sodiumMg: 0, saturatedFatG: 0, transFatG: 0,
      sugarsG: 0, caloriesFromFat: 0,
    },
  });

  // Default: no food log entries for top foods query
  mockLimit.mockResolvedValue([]);
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockGroupBy.mockReturnValue({ orderBy: mockOrderBy });
  mockWhere.mockReturnValue({ groupBy: mockGroupBy });
  mockInnerJoin.mockReturnValue({ where: mockWhere });
  mockFrom.mockReturnValue({ innerJoin: mockInnerJoin });
  mockSelect.mockReturnValue({ from: mockFrom });
}

describe("buildUserProfile", () => {
  beforeEach(() => {
    setupDefaultMocks();
  });

  it("returns null when user has no data at all (new user)", async () => {
    const { buildUserProfile } = await import("@/lib/user-profile");
    const result = await buildUserProfile(TEST_USER_ID, TEST_DATE);
    expect(result).toBeNull();
  });

  it("returns profile with all sections when user has full data", async () => {
    mockGetCalorieGoals.mockResolvedValue([{ date: TEST_DATE, calorieGoal: 2200 }]);
    mockGetLumenGoals.mockResolvedValue({
      date: TEST_DATE, dayType: "high_carb",
      proteinGoal: 140, carbsGoal: 220, fatGoal: 80,
    });
    mockGetNutritionSummary.mockResolvedValue({
      date: TEST_DATE,
      meals: [
        { mealTypeId: 1, entries: [{ foodName: "Café con leche", calories: 90 }], totals: { calories: 90, proteinG: 5, carbsG: 10, fatG: 3, fiberG: 0, sodiumMg: 50, saturatedFatG: 2, transFatG: 0, sugarsG: 8, caloriesFromFat: 27 } },
        { mealTypeId: 3, entries: [{ foodName: "Milanesa", calories: 650 }], totals: { calories: 650, proteinG: 45, carbsG: 30, fatG: 35, fiberG: 2, sodiumMg: 400, saturatedFatG: 10, transFatG: 1, sugarsG: 2, caloriesFromFat: 315 } },
      ],
      totals: {
        calories: 740, proteinG: 50, carbsG: 40, fatG: 38,
        fiberG: 2, sodiumMg: 450, saturatedFatG: 12, transFatG: 1,
        sugarsG: 10, caloriesFromFat: 342,
      },
    });
    mockLimit.mockResolvedValue([
      { foodName: "Medialunas", calories: 180, count: 32 },
      { foodName: "Café con leche", calories: 90, count: 28 },
      { foodName: "Milanesa con ensalada", calories: 650, count: 15 },
    ]);

    const { buildUserProfile } = await import("@/lib/user-profile");
    const result = await buildUserProfile(TEST_USER_ID, TEST_DATE);

    expect(result).not.toBeNull();
    // Goals section
    expect(result).toContain("2200 cal/day");
    expect(result).toContain("P:140g");
    expect(result).toContain("C:220g");
    expect(result).toContain("F:80g");
    // Progress section
    expect(result).toContain("740 cal");
    expect(result).toContain("34%"); // 740/2200
    // Top foods section
    expect(result).toContain("Medialunas");
    expect(result).toContain("×32");
    expect(result).toContain("Café con leche");
  });

  it("includes calorie goal but omits macro goals when no lumen goals", async () => {
    mockGetCalorieGoals.mockResolvedValue([{ date: TEST_DATE, calorieGoal: 2000 }]);
    mockGetLumenGoals.mockResolvedValue(null);

    const { buildUserProfile } = await import("@/lib/user-profile");
    const result = await buildUserProfile(TEST_USER_ID, TEST_DATE);

    expect(result).not.toBeNull();
    expect(result).toContain("2000 cal/day");
    expect(result).not.toContain("P:");
  });

  it("returns partial profile with only a few foods and no goals", async () => {
    mockLimit.mockResolvedValue([
      { foodName: "Pizza", calories: 300, count: 3 },
    ]);

    const { buildUserProfile } = await import("@/lib/user-profile");
    const result = await buildUserProfile(TEST_USER_ID, TEST_DATE);

    expect(result).not.toBeNull();
    expect(result).toContain("Pizza");
    expect(result).toContain("×3");
  });

  it("omits today's progress when no food logged today", async () => {
    mockGetCalorieGoals.mockResolvedValue([{ date: TEST_DATE, calorieGoal: 2200 }]);

    const { buildUserProfile } = await import("@/lib/user-profile");
    const result = await buildUserProfile(TEST_USER_ID, TEST_DATE);

    expect(result).not.toBeNull();
    expect(result).toContain("2200 cal/day");
    // Should not have a progress section when totals are all 0
    expect(result).not.toMatch(/Today/i);
  });

  it("profile string stays under 1200 characters", async () => {
    mockGetCalorieGoals.mockResolvedValue([{ date: TEST_DATE, calorieGoal: 2200 }]);
    mockGetLumenGoals.mockResolvedValue({
      date: TEST_DATE, dayType: "high_carb",
      proteinGoal: 140, carbsGoal: 220, fatGoal: 80,
    });
    mockGetNutritionSummary.mockResolvedValue({
      date: TEST_DATE,
      meals: [],
      totals: {
        calories: 1450, proteinG: 95, carbsG: 180, fatG: 52,
        fiberG: 15, sodiumMg: 1200, saturatedFatG: 18, transFatG: 2,
        sugarsG: 45, caloriesFromFat: 468,
      },
    });
    // 10 foods with long names
    mockLimit.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        foodName: `Food item with a reasonably long name number ${i + 1}`,
        calories: 100 + i * 50,
        count: 30 - i * 2,
      }))
    );

    const { buildUserProfile } = await import("@/lib/user-profile");
    const result = await buildUserProfile(TEST_USER_ID, TEST_DATE);

    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(1200);
  });

  it("calls all data sources with correct arguments", async () => {
    const { buildUserProfile } = await import("@/lib/user-profile");
    await buildUserProfile(TEST_USER_ID, TEST_DATE);

    expect(mockGetCalorieGoals).toHaveBeenCalledWith(TEST_USER_ID, TEST_DATE, TEST_DATE);
    expect(mockGetLumenGoals).toHaveBeenCalledWith(TEST_USER_ID, TEST_DATE);
    expect(mockGetNutritionSummary).toHaveBeenCalledWith(TEST_USER_ID, TEST_DATE);
  });
});
