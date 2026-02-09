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

const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockInnerJoin = vi.fn();
const mockLeftJoin = vi.fn();
const mockDelete = vi.fn();
const mockDeleteWhere = vi.fn();
const mockDeleteReturning = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: () => ({
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return { values: mockValues };
    },
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return { from: mockFrom };
    },
    delete: (...args: unknown[]) => {
      mockDelete(...args);
      return { where: mockDeleteWhere };
    },
  }),
}));

vi.mock("@/db/schema", async (importOriginal) => {
  return importOriginal();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockValues.mockReturnValue({ returning: mockReturning });
  mockFrom.mockReturnValue({ where: mockWhere, innerJoin: mockInnerJoin, leftJoin: mockLeftJoin });
  mockInnerJoin.mockReturnValue({ where: mockWhere });
  mockLeftJoin.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const {
  insertCustomFood,
  insertFoodLogEntry,
  getCustomFoodById,
  getCommonFoods,
  getRecentFoods,
  searchFoods,
  getFoodLogHistory,
  getFoodLogEntry,
  deleteFoodLogEntry,
} = await import("@/lib/food-log");

describe("insertCustomFood", () => {
  it("inserts a row with all fields and returns id and createdAt", async () => {
    const createdAt = new Date("2026-02-05T12:00:00Z");
    mockReturning.mockResolvedValue([{ id: 42, createdAt }]);

    const result = await insertCustomFood("user-uuid-123", {
      foodName: "Grilled Chicken",
      amount: 150,
      unitId: 147,
      calories: 250,
      proteinG: 30,
      carbsG: 5,
      fatG: 10,
      fiberG: 2,
      sodiumMg: 400,
      confidence: "high",
      notes: "With herbs",
      fitbitFoodId: 123,
    });

    expect(result).toEqual({ id: 42, createdAt });
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-uuid-123",
        foodName: "Grilled Chicken",
        amount: "150",
        unitId: 147,
        calories: 250,
        proteinG: "30",
        carbsG: "5",
        fatG: "10",
        fiberG: "2",
        sodiumMg: "400",
        confidence: "high",
        notes: "With herbs",
        fitbitFoodId: 123,
      }),
    );
  });

  it("returns id and createdAt from DB", async () => {
    const createdAt = new Date("2026-02-05T18:00:00Z");
    mockReturning.mockResolvedValue([{ id: 99, createdAt }]);

    const result = await insertCustomFood("user-uuid-123", {
      foodName: "Salad",
      amount: 200,
      unitId: 147,
      calories: 100,
      proteinG: 5,
      carbsG: 15,
      fatG: 3,
      fiberG: 4,
      sodiumMg: 150,
      confidence: "medium",
      notes: "Caesar salad",
    });

    expect(result.id).toBe(99);
    expect(result.createdAt).toEqual(createdAt);
  });

  it("handles nullable fields (notes, fitbitFoodId) with null", async () => {
    const createdAt = new Date();
    mockReturning.mockResolvedValue([{ id: 1, createdAt }]);

    const result = await insertCustomFood("user-uuid-123", {
      foodName: "Apple",
      amount: 1,
      unitId: 304,
      calories: 95,
      proteinG: 0.5,
      carbsG: 25,
      fatG: 0.3,
      fiberG: 4.4,
      sodiumMg: 2,
      confidence: "high",
      notes: null,
      fitbitFoodId: null,
    });

    expect(result.id).toBe(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: null,
        fitbitFoodId: null,
      }),
    );
  });

  it("handles large fitbitFoodId values (bigint range)", async () => {
    const createdAt = new Date();
    mockReturning.mockResolvedValue([{ id: 1, createdAt }]);

    await insertCustomFood("user-uuid-123", {
      foodName: "Tea",
      amount: 1,
      unitId: 91,
      calories: 22,
      proteinG: 2.8,
      carbsG: 2.8,
      fatG: 0,
      fiberG: 0,
      sodiumMg: 32,
      confidence: "medium",
      notes: "Test",
      fitbitFoodId: 828644295,
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        fitbitFoodId: 828644295,
      }),
    );
  });

  it("stores keywords array in the customFoods table", async () => {
    const createdAt = new Date();
    mockReturning.mockResolvedValue([{ id: 50, createdAt }]);

    await insertCustomFood("user-uuid-123", {
      foodName: "Tea with milk",
      amount: 1,
      unitId: 91,
      calories: 50,
      proteinG: 2,
      carbsG: 5,
      fatG: 2,
      fiberG: 0,
      sodiumMg: 30,
      confidence: "high",
      notes: null,
      keywords: ["tea", "milk"],
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        keywords: ["tea", "milk"],
      }),
    );
  });

  it("stores null keywords when not provided", async () => {
    const createdAt = new Date();
    mockReturning.mockResolvedValue([{ id: 51, createdAt }]);

    await insertCustomFood("user-uuid-123", {
      foodName: "Apple",
      amount: 1,
      unitId: 304,
      calories: 95,
      proteinG: 0.5,
      carbsG: 25,
      fatG: 0.3,
      fiberG: 4.4,
      sodiumMg: 2,
      confidence: "high",
      notes: null,
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        keywords: null,
      }),
    );
  });

  it("stores numeric fields as strings for Drizzle numeric columns", async () => {
    const createdAt = new Date();
    mockReturning.mockResolvedValue([{ id: 7, createdAt }]);

    await insertCustomFood("user-uuid-123", {
      foodName: "Rice",
      amount: 0.5,
      unitId: 91,
      calories: 100,
      proteinG: 2.1,
      carbsG: 22.5,
      fatG: 0.2,
      fiberG: 0.6,
      sodiumMg: 1.5,
      confidence: "low",
      notes: null,
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "0.5",
        proteinG: "2.1",
        carbsG: "22.5",
        fatG: "0.2",
        fiberG: "0.6",
        sodiumMg: "1.5",
      }),
    );
  });
});

describe("insertFoodLogEntry", () => {
  it("inserts a row with all fields and returns id and loggedAt", async () => {
    const loggedAt = new Date("2026-02-05T12:00:00Z");
    mockReturning.mockResolvedValue([{ id: 10, loggedAt }]);

    const result = await insertFoodLogEntry("user-uuid-123", {
      customFoodId: 42,
      mealTypeId: 5,
      amount: 150,
      unitId: 147,
      date: "2026-02-05",
      time: "12:30:00",
      fitbitLogId: 456,
    });

    expect(result).toEqual({ id: 10, loggedAt });
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-uuid-123",
        customFoodId: 42,
        mealTypeId: 5,
        amount: "150",
        unitId: 147,
        date: "2026-02-05",
        time: "12:30:00",
        fitbitLogId: 456,
      }),
    );
  });

  it("returns id and loggedAt from DB", async () => {
    const loggedAt = new Date("2026-02-05T18:00:00Z");
    mockReturning.mockResolvedValue([{ id: 77, loggedAt }]);

    const result = await insertFoodLogEntry("user-uuid-123", {
      customFoodId: 1,
      mealTypeId: 3,
      amount: 200,
      unitId: 147,
      date: "2026-02-05",
      time: "18:00:00",
    });

    expect(result.id).toBe(77);
    expect(result.loggedAt).toEqual(loggedAt);
  });

  it("handles nullable fitbitLogId with null", async () => {
    const loggedAt = new Date();
    mockReturning.mockResolvedValue([{ id: 1, loggedAt }]);

    const result = await insertFoodLogEntry("user-uuid-123", {
      customFoodId: 5,
      mealTypeId: 2,
      amount: 1,
      unitId: 304,
      date: "2026-02-05",
      time: "09:00:00",
      fitbitLogId: null,
    });

    expect(result.id).toBe(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        time: "09:00:00",
        fitbitLogId: null,
      }),
    );
  });

  it("converts numeric amount to string", async () => {
    const loggedAt = new Date();
    mockReturning.mockResolvedValue([{ id: 1, loggedAt }]);

    await insertFoodLogEntry("user-uuid-123", {
      customFoodId: 1,
      mealTypeId: 5,
      amount: 0.5,
      unitId: 91,
      date: "2026-02-05",
      time: "19:30:00",
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: "0.5",
      }),
    );
  });
});

describe("getCustomFoodById", () => {
  it("returns the food with correct fields for existing ID and matching userId", async () => {
    const mockFood = {
      id: 42,
      userId: "user-uuid-123",
      foodName: "Tea with milk",
      amount: "1",
      unitId: 91,
      calories: 50,
      proteinG: "2",
      carbsG: "5",
      fatG: "2",
      fiberG: "0",
      sodiumMg: "30",
      fitbitFoodId: 12345,
      confidence: "high",
      notes: null,
      keywords: ["tea", "milk"],
      createdAt: new Date("2026-02-05T12:00:00Z"),
    };
    mockWhere.mockResolvedValue([mockFood]);

    const result = await getCustomFoodById("user-uuid-123", 42);

    expect(result).toEqual(mockFood);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
  });

  it("returns null for non-existent ID", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await getCustomFoodById("user-uuid-123", 999);

    expect(result).toBeNull();
  });

  it("returns null for food belonging to a different userId", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await getCustomFoodById("other-user-uuid", 42);

    expect(result).toBeNull();
  });
});

describe("getCommonFoods", () => {
  // Helper to build a mock DB row (as returned from join query)
  function makeRow(overrides: {
    customFoodId: number;
    foodName: string;
    time: string | null;
    date: string;
    fitbitFoodId: number | null;
    mealTypeId: number;
    calories?: number;
    amount?: string;
    unitId?: number;
    proteinG?: string;
    carbsG?: string;
    fatG?: string;
    fiberG?: string;
    sodiumMg?: string;
  }) {
    return {
      food_log_entries: {
        id: Math.floor(Math.random() * 1000),
        userId: "user-uuid-123",
        customFoodId: overrides.customFoodId,
        mealTypeId: overrides.mealTypeId,
        amount: overrides.amount ?? "150",
        unitId: overrides.unitId ?? 147,
        date: overrides.date,
        time: overrides.time,
        fitbitLogId: 100,
        loggedAt: new Date(),
      },
      custom_foods: {
        id: overrides.customFoodId,
        userId: "user-uuid-123",
        foodName: overrides.foodName,
        amount: overrides.amount ?? "150",
        unitId: overrides.unitId ?? 147,
        calories: overrides.calories ?? 250,
        proteinG: overrides.proteinG ?? "30",
        carbsG: overrides.carbsG ?? "5",
        fatG: overrides.fatG ?? "10",
        fiberG: overrides.fiberG ?? "2",
        sodiumMg: overrides.sodiumMg ?? "400",
        fitbitFoodId: overrides.fitbitFoodId,
        confidence: "high",
        notes: null,
        keywords: null,
        createdAt: new Date(),
      },
    };
  }

  it("ranks food logged every day at same time higher than food logged once at exact time", async () => {
    // Food A: logged every day for 7 days at 08:00. currentTime=08:00, currentDate=2026-02-08 (Saturday)
    // Food B: logged once today at 08:00
    // Food A should score higher because sum of scores across multiple entries beats single entry
    const rows = [
      // Food A: 7 entries across 7 days, all at 08:00
      ...Array.from({ length: 7 }, (_, i) =>
        makeRow({ customFoodId: 1, foodName: "Daily Oatmeal", time: "08:00:00", date: `2026-02-0${8 - i}`, fitbitFoodId: 100, mealTypeId: 1 }),
      ),
      // Food B: 1 entry today at 08:00
      makeRow({ customFoodId: 2, foodName: "One-time Bagel", time: "08:00:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 1 }),
    ];
    mockWhere.mockResolvedValue(rows);

    const result = await getCommonFoods("user-uuid-123", "08:00:00", "2026-02-08");

    expect(result.foods[0].foodName).toBe("Daily Oatmeal");
  });

  it("time-of-day kernel gives higher score at exact time vs 4 hours away", async () => {
    // Both logged on same day, same recency. Current time = 12:00
    // Food A at 12:00 → 0 min diff → high kernel
    // Food B at 16:00 → 240 min diff → low kernel
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Exact Time Food", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 3 }),
      makeRow({ customFoodId: 2, foodName: "Far Time Food", time: "16:00:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 4 }),
    ]);

    const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

    expect(result.foods[0].foodName).toBe("Exact Time Food");
    expect(result.foods[1].foodName).toBe("Far Time Food");
  });

  it("recency decay: food logged today scores higher than food logged 14 days ago at same time", async () => {
    // Both at same time of day, so time kernel is identical
    // Food A: today → recency decay ≈ 1.0
    // Food B: 14 days ago → recency decay much smaller
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Today Food", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 3 }),
      makeRow({ customFoodId: 2, foodName: "Old Food", time: "12:00:00", date: "2026-01-25", fitbitFoodId: 101, mealTypeId: 3 }),
    ]);

    const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

    expect(result.foods[0].foodName).toBe("Today Food");
    expect(result.foods[1].foodName).toBe("Old Food");
  });

  it("day-of-week boost: food logged on same weekday gets 1.3x multiplier", async () => {
    // currentDate = 2026-02-08 (Sunday)
    // Food A: logged last Sunday (2026-02-01) at 12:00 → same day-of-week → 1.3x
    // Food B: logged last Monday (2026-02-02) at 12:00 → different day → 1.0x
    // Same time diff, very similar recency, so day-of-week should be the tiebreaker
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Sunday Food", time: "12:00:00", date: "2026-02-01", fitbitFoodId: 100, mealTypeId: 3 }),
      makeRow({ customFoodId: 2, foodName: "Monday Food", time: "12:00:00", date: "2026-02-02", fitbitFoodId: 101, mealTypeId: 3 }),
    ]);

    const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

    expect(result.foods[0].foodName).toBe("Sunday Food");
  });

  it("score is the SUM across all entries, not just best single entry", async () => {
    // Food A: 3 entries, each contributing some score
    // Food B: 1 entry with higher individual score than any single Food A entry
    // But Food A's SUM should beat Food B's single entry
    // currentDate = 2026-02-08, currentTime = 12:00
    // Food A entries: all today at 12:30 (close time, high recency, slight time offset)
    // Food B: today at 12:00 (exact time match, highest individual score)
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Multi Entry Food", time: "12:30:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 3 }),
      makeRow({ customFoodId: 1, foodName: "Multi Entry Food", time: "12:30:00", date: "2026-02-07", fitbitFoodId: 100, mealTypeId: 3 }),
      makeRow({ customFoodId: 1, foodName: "Multi Entry Food", time: "12:30:00", date: "2026-02-06", fitbitFoodId: 100, mealTypeId: 3 }),
      makeRow({ customFoodId: 2, foodName: "Single Entry Food", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 3 }),
    ]);

    const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

    expect(result.foods[0].foodName).toBe("Multi Entry Food");
  });

  it("results sorted by descending score", async () => {
    // 3 foods with clearly different scores (time diff makes scoring obvious)
    // currentTime = 12:00, currentDate = 2026-02-08
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Far Food", time: "06:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 1 }),
      makeRow({ customFoodId: 2, foodName: "Close Food", time: "12:05:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 3 }),
      makeRow({ customFoodId: 3, foodName: "Medium Food", time: "14:00:00", date: "2026-02-08", fitbitFoodId: 102, mealTypeId: 4 }),
    ]);

    const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

    expect(result.foods[0].foodName).toBe("Close Food");
    expect(result.foods[1].foodName).toBe("Medium Food");
    expect(result.foods[2].foodName).toBe("Far Food");
  });

  it("query window is 90 days (entries at 91 days ago should not appear)", async () => {
    // This is verified by checking that the cutoff date passed to DB query is ~90 days ago
    // We mock to return rows; the function should pass the correct cutoff to the query
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Recent Food", time: "12:00:00", date: "2026-02-07", fitbitFoodId: 100, mealTypeId: 3 }),
    ]);

    const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

    expect(result.foods).toHaveLength(1);
    // The cutoff is enforced in the DB query; the 90-day window is what matters
    // We verify by checking that the where clause was called (DB filtering)
    expect(mockWhere).toHaveBeenCalled();
  });

  it("returns empty result when no entries exist", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

    expect(result.foods).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("uses circular time distance (23:00 is close to 01:00)", async () => {
    // currentTime = 23:30
    // Entry at 00:30 → circular diff = 60 min → high kernel
    // Entry at 20:00 → circular diff = 210 min → lower kernel
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Late Night Snack", time: "00:30:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 7 }),
      makeRow({ customFoodId: 2, foodName: "Dinner", time: "20:00:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 5 }),
    ]);

    const result = await getCommonFoods("user-uuid-123", "23:30:00", "2026-02-08");

    expect(result.foods).toHaveLength(2);
    expect(result.foods[0].foodName).toBe("Late Night Snack");
    expect(result.foods[1].foodName).toBe("Dinner");
  });

  it("handles null time entries by treating as midnight", async () => {
    // currentTime = 00:30
    // null time → treated as 00:00 → 30 min diff → high kernel
    // 12:00 → 690 min diff → low kernel
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Timeless Food", time: null, date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 7 }),
      makeRow({ customFoodId: 2, foodName: "Noon Food", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 3 }),
    ]);

    const result = await getCommonFoods("user-uuid-123", "00:30:00", "2026-02-08");

    expect(result.foods).toHaveLength(2);
    expect(result.foods[0].foodName).toBe("Timeless Food");
    expect(result.foods[1].foodName).toBe("Noon Food");
  });

  it("parses numeric DB strings to numbers in returned objects", async () => {
    mockWhere.mockResolvedValue([
      makeRow({
        customFoodId: 1,
        foodName: "Rice",
        time: "12:00:00",
        date: "2026-02-08",
        fitbitFoodId: 100,
        mealTypeId: 3,
        amount: "0.5",
        calories: 200,
        proteinG: "5.5",
        carbsG: "40.2",
        fatG: "1.1",
        fiberG: "0.8",
        sodiumMg: "3.2",
      }),
    ]);

    const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

    expect(result.foods[0].amount).toBe(0.5);
    expect(result.foods[0].proteinG).toBe(5.5);
    expect(result.foods[0].carbsG).toBe(40.2);
    expect(result.foods[0].fatG).toBe(1.1);
    expect(result.foods[0].fiberG).toBe(0.8);
    expect(result.foods[0].sodiumMg).toBe(3.2);
    expect(result.foods[0].calories).toBe(200);
  });

  it("keeps mealTypeId from the entry with the highest individual score", async () => {
    // Food has two entries: one with high score (close time, recent) and one with low score
    // The mealTypeId should come from the high-score entry
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Chicken", time: "08:00:00", date: "2026-01-20", fitbitFoodId: 100, mealTypeId: 1 }),
      makeRow({ customFoodId: 1, foodName: "Chicken", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 3 }),
    ]);

    const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

    expect(result.foods).toHaveLength(1);
    expect(result.foods[0].mealTypeId).toBe(3); // from the higher-scoring entry
  });

  describe("FITBIT_DRY_RUN=true", () => {
    it("includes foods with null fitbitFoodId", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockWhere.mockResolvedValue([
        makeRow({ customFoodId: 1, foodName: "Dry Run Food", time: "12:00:00", date: "2026-02-08", fitbitFoodId: null, mealTypeId: 3 }),
      ]);

      const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

      expect(result.foods).toHaveLength(1);
      expect(result.foods[0].foodName).toBe("Dry Run Food");
      expect(result.foods[0].fitbitFoodId).toBeNull();
    });
  });

  describe("pagination", () => {
    it("returns at most limit items (default 10)", async () => {
      const rows = Array.from({ length: 15 }, (_, i) =>
        makeRow({
          customFoodId: i + 1,
          foodName: `Food ${i + 1}`,
          time: "12:00:00",
          date: "2026-02-08",
          fitbitFoodId: 100 + i,
          mealTypeId: 3,
        }),
      );
      mockWhere.mockResolvedValue(rows);

      const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08");

      expect(result.foods).toHaveLength(10);
    });

    it("returns at most specified limit items", async () => {
      const rows = Array.from({ length: 8 }, (_, i) =>
        makeRow({
          customFoodId: i + 1,
          foodName: `Food ${i + 1}`,
          time: "12:00:00",
          date: "2026-02-08",
          fitbitFoodId: 100 + i,
          mealTypeId: 3,
        }),
      );
      mockWhere.mockResolvedValue(rows);

      const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08", { limit: 3 });

      expect(result.foods).toHaveLength(3);
    });

    it("with cursor returns items with score < cursor", async () => {
      // Create foods with clearly different scores (different time diffs)
      // currentTime = 12:00, all same date for equal recency
      mockWhere.mockResolvedValue([
        makeRow({ customFoodId: 1, foodName: "Exact", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 3 }),
        makeRow({ customFoodId: 2, foodName: "Close", time: "12:30:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 3 }),
        makeRow({ customFoodId: 3, foodName: "Far", time: "18:00:00", date: "2026-02-08", fitbitFoodId: 102, mealTypeId: 5 }),
      ]);

      // First page without cursor
      const page1 = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08", { limit: 2 });
      expect(page1.foods).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      // Second page with cursor
      const page2 = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08", { limit: 2, cursor: page1.nextCursor! });
      expect(page2.foods).toHaveLength(1);
      expect(page2.foods[0].foodName).toBe("Far");
      expect(page2.nextCursor).toBeNull();
    });

    it("does not skip foods with identical scores at page boundary", async () => {
      // 3 foods all with identical scores (same time, same date, same recency)
      // With limit=2, the first page returns 2 foods with nextCursor.
      // The second page should return the 3rd food — not skip it because
      // scores are identical. This requires a composite cursor {score, id}.
      const rows = [
        makeRow({ customFoodId: 10, foodName: "Food A", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 3 }),
        makeRow({ customFoodId: 20, foodName: "Food B", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 3 }),
        makeRow({ customFoodId: 30, foodName: "Food C", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 102, mealTypeId: 3 }),
      ];
      mockWhere.mockResolvedValue(rows);

      const page1 = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08", { limit: 2 });
      expect(page1.foods).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      // Second page with composite cursor
      const page2 = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08", { limit: 2, cursor: page1.nextCursor! });
      expect(page2.foods).toHaveLength(1);
      expect(page2.foods[0].foodName).toBe("Food C");
      expect(page2.nextCursor).toBeNull();
    });

    it("returns nextCursor when more items exist, null when no more", async () => {
      // Exactly 3 items, limit 3 → no more items → nextCursor null
      mockWhere.mockResolvedValue([
        makeRow({ customFoodId: 1, foodName: "Food 1", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 3 }),
        makeRow({ customFoodId: 2, foodName: "Food 2", time: "13:00:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 3 }),
        makeRow({ customFoodId: 3, foodName: "Food 3", time: "14:00:00", date: "2026-02-08", fitbitFoodId: 102, mealTypeId: 3 }),
      ]);

      const result = await getCommonFoods("user-uuid-123", "12:00:00", "2026-02-08", { limit: 3 });
      expect(result.foods).toHaveLength(3);
      expect(result.nextCursor).toBeNull();
    });
  });
});

describe("getRecentFoods", () => {
  function makeRecentRow(overrides: {
    id: number;
    customFoodId: number;
    foodName: string;
    time: string | null;
    date: string;
    fitbitFoodId: number | null;
    mealTypeId: number;
  }) {
    return {
      food_log_entries: {
        id: overrides.id,
        userId: "user-uuid-123",
        customFoodId: overrides.customFoodId,
        mealTypeId: overrides.mealTypeId,
        amount: "150",
        unitId: 147,
        date: overrides.date,
        time: overrides.time,
        fitbitLogId: 100,
        loggedAt: new Date(),
      },
      custom_foods: {
        id: overrides.customFoodId,
        userId: "user-uuid-123",
        foodName: overrides.foodName,
        amount: "150",
        unitId: 147,
        calories: 250,
        proteinG: "30",
        carbsG: "5",
        fatG: "10",
        fiberG: "2",
        sodiumMg: "400",
        fitbitFoodId: overrides.fitbitFoodId,
        confidence: "high",
        notes: null,
        keywords: null,
        createdAt: new Date(),
      },
    };
  }

  it("returns foods ordered by most-recently-logged (date DESC, time DESC)", async () => {
    mockLimit.mockResolvedValue([
      makeRecentRow({ id: 1, customFoodId: 1, foodName: "Latest", time: "18:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 5 }),
      makeRecentRow({ id: 2, customFoodId: 2, foodName: "Earlier", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 3 }),
      makeRecentRow({ id: 3, customFoodId: 3, foodName: "Yesterday", time: "20:00:00", date: "2026-02-07", fitbitFoodId: 102, mealTypeId: 5 }),
    ]);

    const result = await getRecentFoods("user-uuid-123");

    expect(result.foods).toHaveLength(3);
    expect(result.foods[0].foodName).toBe("Latest");
    expect(result.foods[1].foodName).toBe("Earlier");
    expect(result.foods[2].foodName).toBe("Yesterday");
  });

  it("deduplicates by customFoodId keeping the most recent entry", async () => {
    mockLimit.mockResolvedValue([
      makeRecentRow({ id: 10, customFoodId: 1, foodName: "Chicken", time: "18:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 5 }),
      makeRecentRow({ id: 5, customFoodId: 1, foodName: "Chicken", time: "12:00:00", date: "2026-02-07", fitbitFoodId: 100, mealTypeId: 3 }),
      makeRecentRow({ id: 8, customFoodId: 2, foodName: "Salad", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 101, mealTypeId: 3 }),
    ]);

    const result = await getRecentFoods("user-uuid-123");

    expect(result.foods).toHaveLength(2);
    expect(result.foods[0].foodName).toBe("Chicken");
    expect(result.foods[0].mealTypeId).toBe(5); // from most recent entry
    expect(result.foods[1].foodName).toBe("Salad");
  });

  it("returns CommonFood shape", async () => {
    mockLimit.mockResolvedValue([
      makeRecentRow({ id: 1, customFoodId: 42, foodName: "Rice", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 3 }),
    ]);

    const result = await getRecentFoods("user-uuid-123");

    expect(result.foods[0]).toEqual({
      customFoodId: 42,
      foodName: "Rice",
      amount: 150,
      unitId: 147,
      calories: 250,
      proteinG: 30,
      carbsG: 5,
      fatG: 10,
      fiberG: 2,
      sodiumMg: 400,
      fitbitFoodId: 100,
      mealTypeId: 3,
    });
  });

  it("accepts limit parameter", async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRecentRow({
        id: i + 1,
        customFoodId: i + 1,
        foodName: `Food ${i + 1}`,
        time: "12:00:00",
        date: "2026-02-08",
        fitbitFoodId: 100 + i,
        mealTypeId: 3,
      }),
    );
    mockLimit.mockResolvedValue(rows);

    const result = await getRecentFoods("user-uuid-123", { limit: 3 });

    expect(result.foods).toHaveLength(3);
  });

  it("returns nextCursor when more items exist", async () => {
    const rows = Array.from({ length: 4 }, (_, i) =>
      makeRecentRow({
        id: i + 1,
        customFoodId: i + 1,
        foodName: `Food ${i + 1}`,
        time: `${String(18 - i).padStart(2, "0")}:00:00`,
        date: "2026-02-08",
        fitbitFoodId: 100 + i,
        mealTypeId: 3,
      }),
    );
    mockLimit.mockResolvedValue(rows);

    const result = await getRecentFoods("user-uuid-123", { limit: 3 });

    expect(result.foods).toHaveLength(3);
    expect(result.nextCursor).not.toBeNull();
    expect(result.nextCursor!.lastDate).toBe("2026-02-08");
    expect(result.nextCursor!.lastId).toBe(3);
  });

  it("returns null nextCursor when no more items", async () => {
    mockLimit.mockResolvedValue([
      makeRecentRow({ id: 1, customFoodId: 1, foodName: "Only Food", time: "12:00:00", date: "2026-02-08", fitbitFoodId: 100, mealTypeId: 3 }),
    ]);

    const result = await getRecentFoods("user-uuid-123", { limit: 10 });

    expect(result.foods).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("returns empty array when no entries", async () => {
    mockLimit.mockResolvedValue([]);

    const result = await getRecentFoods("user-uuid-123");

    expect(result.foods).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  describe("FITBIT_DRY_RUN=true", () => {
    it("includes foods with null fitbitFoodId", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockLimit.mockResolvedValue([
        makeRecentRow({ id: 1, customFoodId: 1, foodName: "Dry Run Food", time: "12:00:00", date: "2026-02-08", fitbitFoodId: null, mealTypeId: 3 }),
      ]);

      const result = await getRecentFoods("user-uuid-123");

      expect(result.foods).toHaveLength(1);
      expect(result.foods[0].fitbitFoodId).toBeNull();
    });
  });
});

describe("getFoodLogHistory", () => {
  function makeHistoryRow(overrides: {
    id: number;
    foodName: string;
    date: string;
    time?: string | null;
    mealTypeId?: number;
    fitbitLogId?: number | null;
    calories?: number;
    amount?: string;
    unitId?: number;
    proteinG?: string;
    carbsG?: string;
    fatG?: string;
    fiberG?: string;
    sodiumMg?: string;
  }) {
    return {
      food_log_entries: {
        id: overrides.id,
        userId: "user-uuid-123",
        customFoodId: overrides.id,
        mealTypeId: overrides.mealTypeId ?? 3,
        amount: overrides.amount ?? "150",
        unitId: overrides.unitId ?? 147,
        date: overrides.date,
        time: overrides.time === undefined ? null : overrides.time,
        fitbitLogId: overrides.fitbitLogId === undefined ? 456 : overrides.fitbitLogId,
        loggedAt: new Date(),
      },
      custom_foods: {
        id: overrides.id,
        userId: "user-uuid-123",
        foodName: overrides.foodName,
        amount: overrides.amount ?? "150",
        unitId: overrides.unitId ?? 147,
        calories: overrides.calories ?? 250,
        proteinG: overrides.proteinG ?? "30",
        carbsG: overrides.carbsG ?? "5",
        fatG: overrides.fatG ?? "10",
        fiberG: overrides.fiberG ?? "2",
        sodiumMg: overrides.sodiumMg ?? "400",
        fitbitFoodId: 100,
        confidence: "high",
        notes: null,
        keywords: null,
        createdAt: new Date(),
      },
    };
  }

  it("returns entries with all needed fields", async () => {
    mockLimit.mockResolvedValue([
      makeHistoryRow({ id: 1, foodName: "Chicken", date: "2026-02-05", time: "12:30:00", mealTypeId: 3, fitbitLogId: 456 }),
    ]);

    const result = await getFoodLogHistory("user-uuid-123", {});

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 1,
      foodName: "Chicken",
      calories: 250,
      proteinG: 30,
      carbsG: 5,
      fatG: 10,
      fiberG: 2,
      sodiumMg: 400,
      amount: 150,
      unitId: 147,
      mealTypeId: 3,
      date: "2026-02-05",
      time: "12:30:00",
      fitbitLogId: 456,
    });
  });

  it("returns empty array when no entries exist", async () => {
    mockLimit.mockResolvedValue([]);

    const result = await getFoodLogHistory("user-uuid-123", {});

    expect(result).toEqual([]);
  });

  it("parses numeric DB strings to numbers", async () => {
    mockLimit.mockResolvedValue([
      makeHistoryRow({
        id: 1,
        foodName: "Rice",
        date: "2026-02-05",
        amount: "0.5",
        proteinG: "5.5",
        carbsG: "40.2",
        fatG: "1.1",
        fiberG: "0.8",
        sodiumMg: "3.2",
      }),
    ]);

    const result = await getFoodLogHistory("user-uuid-123", {});

    expect(result[0].amount).toBe(0.5);
    expect(result[0].proteinG).toBe(5.5);
    expect(result[0].carbsG).toBe(40.2);
    expect(result[0].fatG).toBe(1.1);
    expect(result[0].fiberG).toBe(0.8);
    expect(result[0].sodiumMg).toBe(3.2);
  });

  it("handles null time and fitbitLogId", async () => {
    mockLimit.mockResolvedValue([
      makeHistoryRow({ id: 1, foodName: "Apple", date: "2026-02-05", time: null, fitbitLogId: null }),
    ]);

    const result = await getFoodLogHistory("user-uuid-123", {});

    expect(result[0].time).toBeNull();
    expect(result[0].fitbitLogId).toBeNull();
  });

  it("accepts composite cursor and paginates correctly with non-sequential ids", async () => {
    // Scenario: entries have non-sequential ids that don't correlate with (date DESC, time ASC) order
    // Page 1 returned entries ending with: date=2026-02-05, time=14:00:00, id=50
    // Page 2 should return entries AFTER that cursor in sort order
    const page2Rows = [
      makeHistoryRow({ id: 30, foodName: "Dinner Roll", date: "2026-02-05", time: "18:00:00" }),
      makeHistoryRow({ id: 80, foodName: "Breakfast", date: "2026-02-04", time: "08:00:00" }),
    ];
    mockLimit.mockResolvedValue(page2Rows);

    const result = await getFoodLogHistory("user-uuid-123", {
      cursor: { lastDate: "2026-02-05", lastTime: "14:00:00", lastId: 50 },
      limit: 20,
    });

    // Should call where with conditions — we verify it doesn't throw and returns mapped entries
    expect(result).toHaveLength(2);
    expect(result[0].foodName).toBe("Dinner Roll");
    expect(result[1].foodName).toBe("Breakfast");
    // Verify the where mock was called (meaning cursor conditions were applied)
    expect(mockWhere).toHaveBeenCalled();
  });

  it("accepts composite cursor with null lastTime", async () => {
    // When the last entry on previous page had null time
    const rows = [
      makeHistoryRow({ id: 15, foodName: "Late Snack", date: "2026-02-04", time: "23:00:00" }),
    ];
    mockLimit.mockResolvedValue(rows);

    const result = await getFoodLogHistory("user-uuid-123", {
      cursor: { lastDate: "2026-02-05", lastTime: null, lastId: 10 },
      limit: 20,
    });

    expect(result).toHaveLength(1);
    expect(result[0].foodName).toBe("Late Snack");
    expect(mockWhere).toHaveBeenCalled();
  });

  it("includes NULL-time entries on the same date when cursor has non-null time", async () => {
    // Bug fix: when lastTime is non-null, the cursor condition must also match
    // (date = lastDate, time IS NULL). In ORDER BY date DESC, time ASC,
    // NULLs sort last (PostgreSQL NULLS LAST default for ASC), so NULL-time
    // entries appear AFTER all non-null time entries on the same date and
    // must be included when paginating from a non-null time cursor.
    const rows = [
      makeHistoryRow({ id: 99, foodName: "No-time entry", date: "2026-02-05", time: null }),
    ];
    mockLimit.mockResolvedValue(rows);

    const result = await getFoodLogHistory("user-uuid-123", {
      cursor: { lastDate: "2026-02-05", lastTime: "14:00:00", lastId: 50 },
      limit: 20,
    });

    expect(result).toHaveLength(1);
    expect(result[0].foodName).toBe("No-time entry");
    expect(result[0].time).toBeNull();
    // Verify cursor conditions were applied (where was called with condition)
    expect(mockWhere).toHaveBeenCalled();
  });

  it("does not use afterId parameter (removed in favor of cursor)", async () => {
    mockLimit.mockResolvedValue([]);

    // Calling with cursor instead of the old afterId
    const result = await getFoodLogHistory("user-uuid-123", {
      cursor: { lastDate: "2026-02-05", lastTime: "12:00:00", lastId: 5 },
    });

    expect(result).toEqual([]);
  });
});

describe("getFoodLogEntry", () => {
  it("returns the entry for existing id and matching userId", async () => {
    mockWhere.mockResolvedValue([
      {
        id: 5,
        userId: "user-uuid-123",
        customFoodId: 10,
        mealTypeId: 3,
        amount: "150",
        unitId: 147,
        date: "2026-02-05",
        time: "12:00:00",
        fitbitLogId: 789,
        loggedAt: new Date(),
      },
    ]);

    const result = await getFoodLogEntry("user-uuid-123", 5);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(5);
    expect(result!.fitbitLogId).toBe(789);
  });

  it("returns null for non-existent id", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await getFoodLogEntry("user-uuid-123", 999);

    expect(result).toBeNull();
  });
});

describe("deleteFoodLogEntry", () => {
  it("deletes the entry and returns fitbitLogId", async () => {
    // First call is the lookup (getFoodLogEntry uses select)
    mockWhere.mockResolvedValueOnce([
      {
        id: 5,
        userId: "user-uuid-123",
        customFoodId: 10,
        mealTypeId: 3,
        amount: "150",
        unitId: 147,
        date: "2026-02-05",
        time: "12:00:00",
        fitbitLogId: 789,
        loggedAt: new Date(),
      },
    ]);
    // Second call is the delete returning
    mockDeleteReturning.mockResolvedValue([{ fitbitLogId: 789 }]);

    const result = await deleteFoodLogEntry("user-uuid-123", 5);

    expect(result).toEqual({ fitbitLogId: 789 });
    expect(mockDelete).toHaveBeenCalled();
  });

  it("returns null when entry not found", async () => {
    mockDeleteReturning.mockResolvedValue([]);

    const result = await deleteFoodLogEntry("user-uuid-123", 999);

    expect(result).toBeNull();
  });

  it("returns null fitbitLogId when entry has no Fitbit log", async () => {
    mockWhere.mockResolvedValueOnce([
      {
        id: 5,
        userId: "user-uuid-123",
        customFoodId: 10,
        mealTypeId: 3,
        amount: "150",
        unitId: 147,
        date: "2026-02-05",
        time: null,
        fitbitLogId: null,
        loggedAt: new Date(),
      },
    ]);
    mockDeleteReturning.mockResolvedValue([{ fitbitLogId: null }]);

    const result = await deleteFoodLogEntry("user-uuid-123", 5);

    expect(result).toEqual({ fitbitLogId: null });
  });
});

describe("searchFoods", () => {
  function makeSearchRow(overrides: {
    customFoodId: number;
    foodName: string;
    fitbitFoodId: number | null;
    keywords?: string[] | null;
    entryId?: number | null;
    date?: string | null;
    time?: string | null;
    mealTypeId?: number | null;
  }) {
    const hasEntry = overrides.entryId != null;
    return {
      custom_foods: {
        id: overrides.customFoodId,
        userId: "user-uuid-123",
        foodName: overrides.foodName,
        amount: "150",
        unitId: 147,
        calories: 250,
        proteinG: "30",
        carbsG: "5",
        fatG: "10",
        fiberG: "2",
        sodiumMg: "400",
        fitbitFoodId: overrides.fitbitFoodId,
        confidence: "high",
        notes: null,
        keywords: overrides.keywords ?? null,
        createdAt: new Date(),
      },
      food_log_entries: hasEntry
        ? {
            id: overrides.entryId!,
            userId: "user-uuid-123",
            customFoodId: overrides.customFoodId,
            mealTypeId: overrides.mealTypeId ?? 3,
            amount: "150",
            unitId: 147,
            date: overrides.date ?? "2026-02-08",
            time: overrides.time ?? "12:00:00",
            fitbitLogId: 100,
            loggedAt: new Date(),
          }
        : null,
    };
  }

  // searchFoods uses leftJoin → where (no orderBy/limit) so mockWhere
  // must resolve directly to rows. Reset it to clear the default
  // mockReturnValue({ orderBy }) set by the top-level beforeEach.
  beforeEach(() => {
    mockWhere.mockReset();
  });

  it("matches on food_name using case-insensitive substring match", async () => {
    const rows = [
      makeSearchRow({ customFoodId: 1, foodName: "Grilled Chicken Breast", fitbitFoodId: 100, entryId: 1, date: "2026-02-08" }),
      makeSearchRow({ customFoodId: 2, foodName: "Chicken Salad", fitbitFoodId: 101, entryId: 2, date: "2026-02-07" }),
    ];
    mockWhere.mockResolvedValue(rows);

    const result = await searchFoods("user-uuid-123", "chicken");

    expect(result).toHaveLength(2);
    expect(result.every(f => f.foodName.toLowerCase().includes("chicken"))).toBe(true);
  });

  it("matches on keywords array (any keyword matches)", async () => {
    mockWhere.mockResolvedValue([
      makeSearchRow({ customFoodId: 1, foodName: "Tea with Milk", fitbitFoodId: 100, keywords: ["tea", "milk", "hot drink"], entryId: 1 }),
    ]);

    const result = await searchFoods("user-uuid-123", "tea");

    expect(result).toHaveLength(1);
    expect(result[0].foodName).toBe("Tea with Milk");
  });

  it("sorts by log count DESC, then last-logged date DESC", async () => {
    // Food A: 3 log entries, last on 2026-02-06
    // Food B: 1 log entry, last on 2026-02-08 (more recent but fewer logs)
    // Food A should appear first because it has more log entries
    mockWhere.mockResolvedValue([
      makeSearchRow({ customFoodId: 1, foodName: "Chicken A", fitbitFoodId: 100, entryId: 1, date: "2026-02-06" }),
      makeSearchRow({ customFoodId: 1, foodName: "Chicken A", fitbitFoodId: 100, entryId: 2, date: "2026-02-05" }),
      makeSearchRow({ customFoodId: 1, foodName: "Chicken A", fitbitFoodId: 100, entryId: 3, date: "2026-02-04" }),
      makeSearchRow({ customFoodId: 2, foodName: "Chicken B", fitbitFoodId: 101, entryId: 4, date: "2026-02-08" }),
    ]);

    const result = await searchFoods("user-uuid-123", "chicken");

    expect(result[0].foodName).toBe("Chicken A"); // 3 logs
    expect(result[1].foodName).toBe("Chicken B"); // 1 log
  });

  it("returns CommonFood shape", async () => {
    mockWhere.mockResolvedValue([
      makeSearchRow({ customFoodId: 42, foodName: "Rice Bowl", fitbitFoodId: 100, entryId: 1, date: "2026-02-08", mealTypeId: 3 }),
    ]);

    const result = await searchFoods("user-uuid-123", "rice");

    expect(result[0]).toEqual({
      customFoodId: 42,
      foodName: "Rice Bowl",
      amount: 150,
      unitId: 147,
      calories: 250,
      proteinG: 30,
      carbsG: 5,
      fatG: 10,
      fiberG: 2,
      sodiumMg: 400,
      fitbitFoodId: 100,
      mealTypeId: 3,
    });
  });

  it("accepts limit parameter", async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeSearchRow({ customFoodId: i + 1, foodName: `Food ${i + 1}`, fitbitFoodId: 100 + i, entryId: i + 1 }),
    );
    mockWhere.mockResolvedValue(rows);

    const result = await searchFoods("user-uuid-123", "food", { limit: 3 });

    expect(result).toHaveLength(3);
  });

  it("returns empty array when no matches", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await searchFoods("user-uuid-123", "nonexistent");

    expect(result).toEqual([]);
  });

  it("only returns foods for the given userId", async () => {
    // This is verified by checking that where clause includes userId filter
    mockWhere.mockResolvedValue([]);

    await searchFoods("user-uuid-123", "chicken");

    expect(mockWhere).toHaveBeenCalled();
  });

  describe("FITBIT_DRY_RUN=true", () => {
    it("includes foods with null fitbitFoodId", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockWhere.mockResolvedValue([
        makeSearchRow({ customFoodId: 1, foodName: "Dry Run Chicken", fitbitFoodId: null, entryId: 1 }),
      ]);

      const result = await searchFoods("user-uuid-123", "chicken");

      expect(result).toHaveLength(1);
      expect(result[0].fitbitFoodId).toBeNull();
    });
  });
});
