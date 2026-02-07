import { describe, it, expect, vi, beforeEach } from "vitest";

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
  mockFrom.mockReturnValue({ where: mockWhere, innerJoin: mockInnerJoin });
  mockInnerJoin.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning });
});

const {
  insertCustomFood,
  insertFoodLogEntry,
  getCustomFoodById,
  getCommonFoods,
  getFoodLogHistory,
  getFoodLogEntry,
  deleteFoodLogEntry,
} = await import("@/lib/food-log");

describe("insertCustomFood", () => {
  it("inserts a row with all fields and returns id and createdAt", async () => {
    const createdAt = new Date("2026-02-05T12:00:00Z");
    mockReturning.mockResolvedValue([{ id: 42, createdAt }]);

    const result = await insertCustomFood("test@example.com", {
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
        email: "test@example.com",
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

    const result = await insertCustomFood("test@example.com", {
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

    const result = await insertCustomFood("test@example.com", {
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

    await insertCustomFood("test@example.com", {
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

    await insertCustomFood("test@example.com", {
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

    await insertCustomFood("test@example.com", {
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

    await insertCustomFood("test@example.com", {
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

    const result = await insertFoodLogEntry("test@example.com", {
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
        email: "test@example.com",
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

    const result = await insertFoodLogEntry("test@example.com", {
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

    const result = await insertFoodLogEntry("test@example.com", {
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

    await insertFoodLogEntry("test@example.com", {
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
  it("returns the food with correct fields for existing ID", async () => {
    const mockFood = {
      id: 42,
      email: "test@example.com",
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

    const result = await getCustomFoodById(42);

    expect(result).toEqual(mockFood);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
  });

  it("returns null for non-existent ID", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await getCustomFoodById(999);

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
    fitbitFoodId: number;
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
        email: "test@example.com",
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
        email: "test@example.com",
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

  it("returns foods ranked by ascending time difference", async () => {
    // Current time is 12:00 (720 minutes)
    // Entry at 12:30 → diff = 30 min
    // Entry at 08:00 → diff = 240 min
    // Entry at 11:00 → diff = 60 min
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Lunch Chicken", time: "12:30:00", date: "2026-02-05", fitbitFoodId: 100, mealTypeId: 3 }),
      makeRow({ customFoodId: 2, foodName: "Breakfast Eggs", time: "08:00:00", date: "2026-02-05", fitbitFoodId: 101, mealTypeId: 1 }),
      makeRow({ customFoodId: 3, foodName: "Late Morning Snack", time: "11:00:00", date: "2026-02-05", fitbitFoodId: 102, mealTypeId: 2 }),
    ]);

    const result = await getCommonFoods("test@example.com", "12:00:00");

    expect(result).toHaveLength(3);
    expect(result[0].foodName).toBe("Lunch Chicken");       // 30 min diff
    expect(result[1].foodName).toBe("Late Morning Snack");  // 60 min diff
    expect(result[2].foodName).toBe("Breakfast Eggs");       // 240 min diff
  });

  it("deduplicates by customFoodId keeping entry with smallest time diff", async () => {
    // Two entries for same customFoodId=1, at different times
    // Current time 12:00
    // Entry 1 at 08:00 → 240 min
    // Entry 2 at 11:45 → 15 min (keep this one)
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Chicken", time: "08:00:00", date: "2026-02-01", fitbitFoodId: 100, mealTypeId: 1 }),
      makeRow({ customFoodId: 1, foodName: "Chicken", time: "11:45:00", date: "2026-02-03", fitbitFoodId: 100, mealTypeId: 3 }),
      makeRow({ customFoodId: 2, foodName: "Salad", time: "12:30:00", date: "2026-02-05", fitbitFoodId: 101, mealTypeId: 3 }),
    ]);

    const result = await getCommonFoods("test@example.com", "12:00:00");

    expect(result).toHaveLength(2);
    // Chicken should use the 11:45 entry (15 min diff) with mealTypeId 3
    const chicken = result.find(f => f.foodName === "Chicken");
    expect(chicken).toBeDefined();
    expect(chicken!.mealTypeId).toBe(3);
  });

  it("limits to 5 results", async () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      makeRow({
        customFoodId: i + 1,
        foodName: `Food ${i + 1}`,
        time: `${String(12 + i).padStart(2, "0")}:00:00`,
        date: "2026-02-05",
        fitbitFoodId: 100 + i,
        mealTypeId: 3,
      }),
    );
    mockWhere.mockResolvedValue(rows);

    const result = await getCommonFoods("test@example.com", "12:00:00");

    expect(result).toHaveLength(5);
  });

  it("returns empty array when no entries exist", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await getCommonFoods("test@example.com", "12:00:00");

    expect(result).toEqual([]);
  });

  it("uses circular time distance (23:00 is close to 01:00)", async () => {
    // Current time 23:30 (1410 minutes)
    // Entry at 00:30 → circular: min(1380, 60) = 60 min
    // Entry at 20:00 → circular: min(210, 1230) = 210 min
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Late Night Snack", time: "00:30:00", date: "2026-02-05", fitbitFoodId: 100, mealTypeId: 7 }),
      makeRow({ customFoodId: 2, foodName: "Dinner", time: "20:00:00", date: "2026-02-05", fitbitFoodId: 101, mealTypeId: 5 }),
    ]);

    const result = await getCommonFoods("test@example.com", "23:30:00");

    expect(result).toHaveLength(2);
    expect(result[0].foodName).toBe("Late Night Snack"); // 60 min circular
    expect(result[1].foodName).toBe("Dinner");           // 210 min
  });

  it("parses numeric DB strings to numbers in returned objects", async () => {
    mockWhere.mockResolvedValue([
      makeRow({
        customFoodId: 1,
        foodName: "Rice",
        time: "12:00:00",
        date: "2026-02-05",
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

    const result = await getCommonFoods("test@example.com", "12:00:00");

    expect(result[0].amount).toBe(0.5);
    expect(result[0].proteinG).toBe(5.5);
    expect(result[0].carbsG).toBe(40.2);
    expect(result[0].fatG).toBe(1.1);
    expect(result[0].fiberG).toBe(0.8);
    expect(result[0].sodiumMg).toBe(3.2);
    expect(result[0].calories).toBe(200);
  });

  it("handles entries with null time by treating as midnight", async () => {
    // Current time 00:30 (30 minutes)
    // Entry with null time → treated as 00:00 → diff = 30 min
    // Entry at 12:00 → diff = min(690, 750) = 690 min
    mockWhere.mockResolvedValue([
      makeRow({ customFoodId: 1, foodName: "Timeless Food", time: null, date: "2026-02-05", fitbitFoodId: 100, mealTypeId: 7 }),
      makeRow({ customFoodId: 2, foodName: "Noon Food", time: "12:00:00", date: "2026-02-05", fitbitFoodId: 101, mealTypeId: 3 }),
    ]);

    const result = await getCommonFoods("test@example.com", "00:30:00");

    expect(result).toHaveLength(2);
    expect(result[0].foodName).toBe("Timeless Food"); // 30 min diff
    expect(result[1].foodName).toBe("Noon Food");     // 690 min diff
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
        email: "test@example.com",
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
        email: "test@example.com",
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

    const result = await getFoodLogHistory("test@example.com", {});

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

    const result = await getFoodLogHistory("test@example.com", {});

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

    const result = await getFoodLogHistory("test@example.com", {});

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

    const result = await getFoodLogHistory("test@example.com", {});

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

    const result = await getFoodLogHistory("test@example.com", {
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

    const result = await getFoodLogHistory("test@example.com", {
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

    const result = await getFoodLogHistory("test@example.com", {
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
    const result = await getFoodLogHistory("test@example.com", {
      cursor: { lastDate: "2026-02-05", lastTime: "12:00:00", lastId: 5 },
    });

    expect(result).toEqual([]);
  });
});

describe("getFoodLogEntry", () => {
  it("returns the entry for existing id and matching email", async () => {
    mockWhere.mockResolvedValue([
      {
        id: 5,
        email: "test@example.com",
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

    const result = await getFoodLogEntry("test@example.com", 5);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(5);
    expect(result!.fitbitLogId).toBe(789);
  });

  it("returns null for non-existent id", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await getFoodLogEntry("test@example.com", 999);

    expect(result).toBeNull();
  });
});

describe("deleteFoodLogEntry", () => {
  it("deletes the entry and returns fitbitLogId", async () => {
    // First call is the lookup (getFoodLogEntry uses select)
    mockWhere.mockResolvedValueOnce([
      {
        id: 5,
        email: "test@example.com",
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

    const result = await deleteFoodLogEntry("test@example.com", 5);

    expect(result).toEqual({ fitbitLogId: 789 });
    expect(mockDelete).toHaveBeenCalled();
  });

  it("returns null when entry not found", async () => {
    mockDeleteReturning.mockResolvedValue([]);

    const result = await deleteFoodLogEntry("test@example.com", 999);

    expect(result).toBeNull();
  });

  it("returns null fitbitLogId when entry has no Fitbit log", async () => {
    mockWhere.mockResolvedValueOnce([
      {
        id: 5,
        email: "test@example.com",
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

    const result = await deleteFoodLogEntry("test@example.com", 5);

    expect(result).toEqual({ fitbitLogId: null });
  });
});
