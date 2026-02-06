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

vi.mock("@/db/index", () => ({
  getDb: () => ({
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return { values: mockValues };
    },
  }),
}));

vi.mock("@/db/schema", async (importOriginal) => {
  return importOriginal();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockValues.mockReturnValue({ returning: mockReturning });
});

const { insertFoodLog } = await import("@/lib/food-log");

describe("insertFoodLog", () => {
  it("inserts a row with all fields and returns id and loggedAt", async () => {
    const loggedAt = new Date("2026-02-05T12:00:00Z");
    mockReturning.mockResolvedValue([{ id: 42, loggedAt }]);

    const result = await insertFoodLog("test@example.com", {
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
      mealTypeId: 5,
      date: "2026-02-05",
      time: "12:30:00",
      fitbitFoodId: 123,
      fitbitLogId: 456,
    });

    expect(result).toEqual({ id: 42, loggedAt });
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
        mealTypeId: 5,
        date: "2026-02-05",
        time: "12:30:00",
        fitbitFoodId: 123,
        fitbitLogId: 456,
      }),
    );
  });

  it("returns id and loggedAt from DB", async () => {
    const loggedAt = new Date("2026-02-05T18:00:00Z");
    mockReturning.mockResolvedValue([{ id: 99, loggedAt }]);

    const result = await insertFoodLog("test@example.com", {
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
      mealTypeId: 3,
      date: "2026-02-05",
    });

    expect(result.id).toBe(99);
    expect(result.loggedAt).toEqual(loggedAt);
  });

  it("handles nullable fields (time, fitbitFoodId, fitbitLogId) with null", async () => {
    const loggedAt = new Date();
    mockReturning.mockResolvedValue([{ id: 1, loggedAt }]);

    const result = await insertFoodLog("test@example.com", {
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
      mealTypeId: 2,
      date: "2026-02-05",
      time: null,
      fitbitFoodId: null,
      fitbitLogId: null,
    });

    expect(result.id).toBe(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: null,
        time: null,
        fitbitFoodId: null,
        fitbitLogId: null,
      }),
    );
  });

  it("handles large fitbitLogId values (bigint range)", async () => {
    const loggedAt = new Date();
    mockReturning.mockResolvedValue([{ id: 1, loggedAt }]);

    await insertFoodLog("test@example.com", {
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
      mealTypeId: 2,
      date: "2026-02-06",
      fitbitFoodId: 828644295,
      fitbitLogId: 38042351280,
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        fitbitLogId: 38042351280,
        fitbitFoodId: 828644295,
      }),
    );
  });

  it("stores numeric fields as strings for Drizzle numeric columns", async () => {
    const loggedAt = new Date();
    mockReturning.mockResolvedValue([{ id: 7, loggedAt }]);

    await insertFoodLog("test@example.com", {
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
      mealTypeId: 5,
      date: "2026-02-05",
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
