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
  }),
}));

vi.mock("@/db/schema", async (importOriginal) => {
  return importOriginal();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockValues.mockReturnValue({ returning: mockReturning });
  mockFrom.mockReturnValue({ where: mockWhere });
});

const { insertCustomFood, insertFoodLogEntry, getCustomFoodById } = await import(
  "@/lib/food-log"
);

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
    });

    expect(result.id).toBe(77);
    expect(result.loggedAt).toEqual(loggedAt);
  });

  it("handles nullable fields (time, fitbitLogId) with null", async () => {
    const loggedAt = new Date();
    mockReturning.mockResolvedValue([{ id: 1, loggedAt }]);

    const result = await insertFoodLogEntry("test@example.com", {
      customFoodId: 5,
      mealTypeId: 2,
      amount: 1,
      unitId: 304,
      date: "2026-02-05",
      time: null,
      fitbitLogId: null,
    });

    expect(result.id).toBe(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        time: null,
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
