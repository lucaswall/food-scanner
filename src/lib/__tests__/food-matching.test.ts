import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock DB for findMatchingFoods tests
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockLeftJoin = vi.fn();
const mockWhere = vi.fn();
const mockGroupBy = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: () => ({
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return { from: mockFrom };
    },
  }),
}));

vi.mock("@/db/schema", async (importOriginal) => {
  return importOriginal();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReturnValue({ leftJoin: mockLeftJoin });
  mockLeftJoin.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ groupBy: mockGroupBy });
  mockGroupBy.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const { computeMatchRatio, checkNutrientTolerance, findMatchingFoods } =
  await import("@/lib/food-matching");

describe("computeMatchRatio", () => {
  it('returns 1.0 when all new keywords exist in existing: ["tea", "milk"] vs ["tea", "milk", "honey"]', () => {
    expect(computeMatchRatio(["tea", "milk"], ["tea", "milk", "honey"])).toBe(1.0);
  });

  it('returns 1.0 when single new keyword matches: ["tea"] vs ["tea", "milk"]', () => {
    expect(computeMatchRatio(["tea"], ["tea", "milk"])).toBe(1.0);
  });

  it('returns 0.5 when half keywords match: ["pizza", "margherita"] vs ["pizza", "pepperoni"]', () => {
    expect(computeMatchRatio(["pizza", "margherita"], ["pizza", "pepperoni"])).toBe(0.5);
  });

  it('returns 0.0 when no keywords match: ["pizza", "margherita"] vs ["tea", "milk"]', () => {
    expect(computeMatchRatio(["pizza", "margherita"], ["tea", "milk"])).toBe(0.0);
  });

  it("returns 0 for empty new keywords (edge case)", () => {
    expect(computeMatchRatio([], ["tea", "milk"])).toBe(0);
  });
});

describe("checkNutrientTolerance", () => {
  it("returns true when nutrients are within thresholds", () => {
    const result = checkNutrientTolerance(
      { calories: 500, proteinG: 30, carbsG: 60, fatG: 20 },
      { calories: 510, proteinG: 31, carbsG: 62, fatG: 21 },
    );
    expect(result).toBe(true);
  });

  it("returns false when calories are outside ±20%/±25kcal", () => {
    // 800 cal vs 500 cal: diff=300, max(500*0.2=100, 25)=100, 300>100 → false
    const result = checkNutrientTolerance(
      { calories: 800, proteinG: 30, carbsG: 60, fatG: 20 },
      { calories: 500, proteinG: 30, carbsG: 60, fatG: 20 },
    );
    expect(result).toBe(false);
  });

  it("returns false when protein is outside ±25%/±3g", () => {
    // 50g vs 30g: diff=20, max(30*0.25=7.5, 3)=7.5, 20>7.5 → false
    const result = checkNutrientTolerance(
      { calories: 500, proteinG: 50, carbsG: 60, fatG: 20 },
      { calories: 500, proteinG: 30, carbsG: 60, fatG: 20 },
    );
    expect(result).toBe(false);
  });

  it("returns false when carbs are outside ±25%/±5g", () => {
    // 100g vs 60g: diff=40, max(60*0.25=15, 5)=15, 40>15 → false
    const result = checkNutrientTolerance(
      { calories: 500, proteinG: 30, carbsG: 100, fatG: 20 },
      { calories: 500, proteinG: 30, carbsG: 60, fatG: 20 },
    );
    expect(result).toBe(false);
  });

  it("returns false when fat is outside ±25%/±3g", () => {
    // 40g vs 20g: diff=20, max(20*0.25=5, 3)=5, 20>5 → false
    const result = checkNutrientTolerance(
      { calories: 500, proteinG: 30, carbsG: 60, fatG: 40 },
      { calories: 500, proteinG: 30, carbsG: 60, fatG: 20 },
    );
    expect(result).toBe(false);
  });

  it("uses absolute band for low-value nutrients (e.g., 10 cal ±25kcal passes for 30 cal)", () => {
    // 10 vs 30: diff=20, max(30*0.2=6, 25)=25, 20<=25 → true
    const result = checkNutrientTolerance(
      { calories: 10, proteinG: 2, carbsG: 3, fatG: 1 },
      { calories: 30, proteinG: 2, carbsG: 3, fatG: 1 },
    );
    expect(result).toBe(true);
  });

  it("uses percentage band for high-value nutrients (e.g., 800 cal ±20% passes for 700 cal)", () => {
    // 800 vs 700: diff=100, max(700*0.2=140, 25)=140, 100<=140 → true
    const result = checkNutrientTolerance(
      { calories: 800, proteinG: 30, carbsG: 60, fatG: 20 },
      { calories: 700, proteinG: 30, carbsG: 60, fatG: 20 },
    );
    expect(result).toBe(true);
  });

  it("returns false when only one nutrient is out of tolerance (all four must pass)", () => {
    // All close except fat: 40g vs 20g → fail
    const result = checkNutrientTolerance(
      { calories: 500, proteinG: 30, carbsG: 60, fatG: 40 },
      { calories: 505, proteinG: 31, carbsG: 62, fatG: 20 },
    );
    expect(result).toBe(false);
  });
});

describe("findMatchingFoods", () => {
  it("returns empty array when no custom foods exist", async () => {
    mockGroupBy.mockResolvedValue([]);

    const result = await findMatchingFoods("user-uuid-123", {
      food_name: "Tea with milk",
      amount: 1,
      unit_id: 91,
      calories: 50,
      protein_g: 2,
      carbs_g: 5,
      fat_g: 2,
      fiber_g: 0,
      sodium_mg: 10,
      saturated_fat_g: null,
      trans_fat_g: null,
      sugars_g: null,
      calories_from_fat: null,
      confidence: "high",
      notes: "",
      description: "",
      keywords: ["tea", "milk"],
    });

    expect(result).toEqual([]);
  });

  it("returns empty array when no keywords match at >= 0.5", async () => {
    mockGroupBy.mockResolvedValue([
      {
        custom_foods: {
          id: 1,
          foodName: "Pizza Margherita",
          calories: 300,
          proteinG: "12",
          carbsG: "35",
          fatG: "10",
          fitbitFoodId: 100,
          keywords: ["pizza", "margherita"],
          createdAt: new Date("2026-01-01"),
          amount: "1",
          unitId: 304,
        },
        lastLoggedAt: new Date("2026-01-15"),
      },
    ]);

    const result = await findMatchingFoods("user-uuid-123", {
      food_name: "Tea with milk",
      amount: 1,
      unit_id: 91,
      calories: 50,
      protein_g: 2,
      carbs_g: 5,
      fat_g: 2,
      fiber_g: 0,
      sodium_mg: 10,
      saturated_fat_g: null,
      trans_fat_g: null,
      sugars_g: null,
      calories_from_fat: null,
      confidence: "high",
      notes: "",
      description: "",
      keywords: ["tea", "milk"],
    });

    expect(result).toEqual([]);
  });

  it("returns empty array when keywords match but nutrients differ", async () => {
    mockGroupBy.mockResolvedValue([
      {
        custom_foods: {
          id: 1,
          foodName: "Tea with milk",
          calories: 500, // way off from 50
          proteinG: "30",
          carbsG: "60",
          fatG: "20",
          fitbitFoodId: 100,
          keywords: ["tea", "milk"],
          createdAt: new Date("2026-01-01"),
          amount: "1",
          unitId: 91,
        },
        lastLoggedAt: new Date("2026-01-15"),
      },
    ]);

    const result = await findMatchingFoods("user-uuid-123", {
      food_name: "Tea with milk",
      amount: 1,
      unit_id: 91,
      calories: 50,
      protein_g: 2,
      carbs_g: 5,
      fat_g: 2,
      fiber_g: 0,
      sodium_mg: 10,
      saturated_fat_g: null,
      trans_fat_g: null,
      sugars_g: null,
      calories_from_fat: null,
      confidence: "high",
      notes: "",
      description: "",
      keywords: ["tea", "milk"],
    });

    expect(result).toEqual([]);
  });

  it("returns matches ranked by match_ratio desc, then by most recently created", async () => {
    mockGroupBy.mockResolvedValue([
      {
        custom_foods: {
          id: 1,
          foodName: "Tea with milk",
          calories: 50,
          proteinG: "2",
          carbsG: "5",
          fatG: "2",
          fitbitFoodId: 100,
          keywords: ["tea", "milk"],
          createdAt: new Date("2026-01-01"),
          amount: "1",
          unitId: 91,
        },
        lastLoggedAt: new Date("2026-01-10"),
      },
      {
        custom_foods: {
          id: 2,
          foodName: "Tea with milk and honey",
          calories: 55,
          proteinG: "2",
          carbsG: "6",
          fatG: "2",
          fitbitFoodId: 101,
          keywords: ["tea", "milk", "honey"],
          createdAt: new Date("2026-01-15"),
          amount: "1",
          unitId: 91,
        },
        lastLoggedAt: new Date("2026-01-20"),
      },
      {
        custom_foods: {
          id: 3,
          foodName: "Tea",
          calories: 45,
          proteinG: "1",
          carbsG: "4",
          fatG: "1",
          fitbitFoodId: 102,
          keywords: ["tea"],
          createdAt: new Date("2026-01-05"),
          amount: "1",
          unitId: 91,
        },
        lastLoggedAt: new Date("2026-01-25"),
      },
    ]);

    const result = await findMatchingFoods("user-uuid-123", {
      food_name: "Tea with milk",
      amount: 1,
      unit_id: 91,
      calories: 50,
      protein_g: 2,
      carbs_g: 5,
      fat_g: 2,
      fiber_g: 0,
      sodium_mg: 10,
      saturated_fat_g: null,
      trans_fat_g: null,
      sugars_g: null,
      calories_from_fat: null,
      confidence: "high",
      notes: "",
      description: "",
      keywords: ["tea", "milk"],
    });

    // id=1: ratio=1.0 (both match), id=2: ratio=1.0 (both match), id=3: ratio=0.5 (only "tea")
    // Ranked by match_ratio desc, then lastLoggedAt desc
    expect(result).toHaveLength(3);
    expect(result[0].customFoodId).toBe(2); // ratio=1.0, lastLoggedAt=Jan 20
    expect(result[0].matchRatio).toBe(1.0);
    expect(result[1].customFoodId).toBe(1); // ratio=1.0, lastLoggedAt=Jan 10
    expect(result[1].matchRatio).toBe(1.0);
    expect(result[2].customFoodId).toBe(3); // ratio=0.5
    expect(result[2].matchRatio).toBe(0.5);
  });

  it("returns max 3 matches", async () => {
    const foods = Array.from({ length: 5 }, (_, i) => ({
      custom_foods: {
        id: i + 1,
        foodName: `Tea variant ${i + 1}`,
        calories: 50,
        proteinG: "2",
        carbsG: "5",
        fatG: "2",
        fitbitFoodId: 100 + i,
        keywords: ["tea", "milk"],
        createdAt: new Date(`2026-01-0${i + 1}`),
        amount: "1",
        unitId: 91,
      },
      lastLoggedAt: new Date(`2026-01-${10 + i}`),
    }));
    mockGroupBy.mockResolvedValue(foods);

    const result = await findMatchingFoods("user-uuid-123", {
      food_name: "Tea with milk",
      amount: 1,
      unit_id: 91,
      calories: 50,
      protein_g: 2,
      carbs_g: 5,
      fat_g: 2,
      fiber_g: 0,
      sodium_mg: 10,
      saturated_fat_g: null,
      trans_fat_g: null,
      sugars_g: null,
      calories_from_fat: null,
      confidence: "high",
      notes: "",
      description: "",
      keywords: ["tea", "milk"],
    });

    expect(result).toHaveLength(3);
  });

  it("ignores custom foods without keywords (null keywords)", async () => {
    mockGroupBy.mockResolvedValue([
      {
        custom_foods: {
          id: 1,
          foodName: "Tea with milk",
          calories: 50,
          proteinG: "2",
          carbsG: "5",
          fatG: "2",
          fitbitFoodId: 100,
          keywords: null,
          createdAt: new Date("2026-01-01"),
          amount: "1",
          unitId: 91,
        },
        lastLoggedAt: new Date("2026-01-15"),
      },
    ]);

    const result = await findMatchingFoods("user-uuid-123", {
      food_name: "Tea with milk",
      amount: 1,
      unit_id: 91,
      calories: 50,
      protein_g: 2,
      carbs_g: 5,
      fat_g: 2,
      fiber_g: 0,
      sodium_mg: 10,
      saturated_fat_g: null,
      trans_fat_g: null,
      sugars_g: null,
      calories_from_fat: null,
      confidence: "high",
      notes: "",
      description: "",
      keywords: ["tea", "milk"],
    });

    expect(result).toEqual([]);
  });

  describe("FITBIT_DRY_RUN=true", () => {
    it("includes foods with null fitbitFoodId", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockGroupBy.mockResolvedValue([
        {
          custom_foods: {
            id: 1,
            foodName: "Tea with milk",
            calories: 50,
            proteinG: "2",
            carbsG: "5",
            fatG: "2",
            fitbitFoodId: null,
            keywords: ["tea", "milk"],
            createdAt: new Date("2026-01-01"),
            amount: "1",
            unitId: 91,
          },
          lastLoggedAt: new Date("2026-01-15"),
        },
      ]);

      const result = await findMatchingFoods("user-uuid-123", {
        food_name: "Tea with milk",
        amount: 1,
        unit_id: 91,
        calories: 50,
        protein_g: 2,
        carbs_g: 5,
        fat_g: 2,
        fiber_g: 0,
        sodium_mg: 10,
        saturated_fat_g: null,
        trans_fat_g: null,
        sugars_g: null,
        calories_from_fat: null,
        confidence: "high",
        notes: "",
        description: "",
        keywords: ["tea", "milk"],
      });

      expect(result).toHaveLength(1);
      expect(result[0].foodName).toBe("Tea with milk");
      expect(result[0].fitbitFoodId).toBeNull();
    });
  });
});
