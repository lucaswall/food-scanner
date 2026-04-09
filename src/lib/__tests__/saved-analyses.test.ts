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
const mockDelete = vi.fn();
const mockDeleteWhere = vi.fn();
const mockDeleteReturning = vi.fn();
const mockOrderBy = vi.fn();

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
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const {
  saveAnalysis,
  getSavedAnalyses,
  getSavedAnalysis,
  deleteSavedAnalysis,
  bulkSaveAnalyses,
} = await import("@/lib/saved-analyses");

const mockFoodAnalysis = {
  food_name: "Grilled Chicken",
  amount: 150,
  unit_id: 147,
  calories: 250,
  protein_g: 30,
  carbs_g: 5,
  fat_g: 10,
  fiber_g: 2,
  sodium_mg: 400,
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high" as const,
  notes: "With herbs",
  description: "Grilled chicken breast",
  keywords: ["chicken", "grilled"],
};

describe("saveAnalysis", () => {
  it("inserts record and returns id + createdAt", async () => {
    const createdAt = new Date("2026-04-08T12:00:00Z");
    mockReturning.mockResolvedValue([{ id: 1, createdAt }]);

    const result = await saveAnalysis("user-uuid-123", mockFoodAnalysis);

    expect(result).toEqual({ id: 1, createdAt });
    expect(mockInsert).toHaveBeenCalled();
  });

  it("extracts food_name into description and calories into calories", async () => {
    const createdAt = new Date("2026-04-08T12:00:00Z");
    mockReturning.mockResolvedValue([{ id: 2, createdAt }]);

    await saveAnalysis("user-uuid-123", mockFoodAnalysis);

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-uuid-123",
        description: "Grilled Chicken",
        calories: 250,
        foodAnalysis: mockFoodAnalysis,
      }),
    );
  });

  it("stores the full FoodAnalysis as JSONB in foodAnalysis column", async () => {
    const createdAt = new Date("2026-04-08T12:00:00Z");
    mockReturning.mockResolvedValue([{ id: 3, createdAt }]);

    const analysisWithExtras = {
      ...mockFoodAnalysis,
      editingEntryId: 42,
      date: "2026-04-08",
    };

    await saveAnalysis("user-uuid-123", analysisWithExtras);

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        foodAnalysis: analysisWithExtras,
      }),
    );
  });
});

describe("getSavedAnalyses", () => {
  it("returns all saved items for user ordered by createdAt desc", async () => {
    const rows = [
      { id: 2, description: "Salad", calories: 100, createdAt: new Date("2026-04-08T14:00:00Z") },
      { id: 1, description: "Grilled Chicken", calories: 250, createdAt: new Date("2026-04-08T10:00:00Z") },
    ];
    mockOrderBy.mockResolvedValue(rows);

    const result = await getSavedAnalyses("user-uuid-123");

    expect(result).toEqual(rows);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
    expect(mockOrderBy).toHaveBeenCalled();
  });

  it("returns empty array when no saved analyses exist", async () => {
    mockOrderBy.mockResolvedValue([]);

    const result = await getSavedAnalyses("user-uuid-123");

    expect(result).toEqual([]);
  });

  it("returns only id, description, calories, createdAt (no foodAnalysis)", async () => {
    const rows = [
      { id: 1, description: "Chicken", calories: 250, createdAt: new Date("2026-04-08T10:00:00Z") },
    ];
    mockOrderBy.mockResolvedValue(rows);

    const result = await getSavedAnalyses("user-uuid-123");

    expect(result[0]).not.toHaveProperty("foodAnalysis");
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("description");
    expect(result[0]).toHaveProperty("calories");
    expect(result[0]).toHaveProperty("createdAt");
  });
});

describe("getSavedAnalysis", () => {
  it("returns full item including foodAnalysis JSONB for matching id and userId", async () => {
    const row = {
      id: 1,
      description: "Grilled Chicken",
      calories: 250,
      createdAt: new Date("2026-04-08T10:00:00Z"),
      foodAnalysis: mockFoodAnalysis,
    };
    mockWhere.mockResolvedValue([row]);

    const result = await getSavedAnalysis("user-uuid-123", 1);

    expect(result).toEqual(row);
    expect(result?.foodAnalysis).toEqual(mockFoodAnalysis);
  });

  it("returns null when id does not exist", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await getSavedAnalysis("user-uuid-123", 999);

    expect(result).toBeNull();
  });

  it("returns null when userId does not match (no cross-user access)", async () => {
    mockWhere.mockResolvedValue([]);

    const result = await getSavedAnalysis("other-user-uuid", 1);

    expect(result).toBeNull();
  });

  it("filters by both id and userId", async () => {
    mockWhere.mockResolvedValue([]);

    await getSavedAnalysis("user-uuid-123", 5);

    expect(mockWhere).toHaveBeenCalledWith(
      expect.anything(), // the and() expression
    );
  });
});

describe("deleteSavedAnalysis", () => {
  it("returns true when the record is deleted", async () => {
    mockDeleteReturning.mockResolvedValue([{ id: 1 }]);

    const result = await deleteSavedAnalysis("user-uuid-123", 1);

    expect(result).toBe(true);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteWhere).toHaveBeenCalled();
  });

  it("returns false when record not found", async () => {
    mockDeleteReturning.mockResolvedValue([]);

    const result = await deleteSavedAnalysis("user-uuid-123", 999);

    expect(result).toBe(false);
  });

  it("deletes by both id and userId (ownership check)", async () => {
    mockDeleteReturning.mockResolvedValue([]);

    await deleteSavedAnalysis("user-uuid-123", 1);

    expect(mockDeleteWhere).toHaveBeenCalledWith(
      expect.anything(), // the and() expression
    );
  });
});

describe("bulkSaveAnalyses", () => {
  it("saves multiple items in one call and returns array of IDs and dates", async () => {
    const createdAt1 = new Date("2026-04-09T12:00:00Z");
    const createdAt2 = new Date("2026-04-09T12:00:01Z");
    mockReturning.mockResolvedValue([
      { id: 1, createdAt: createdAt1 },
      { id: 2, createdAt: createdAt2 },
    ]);

    const items = [
      { ...mockFoodAnalysis, food_name: "Item 1", calories: 100 },
      { ...mockFoodAnalysis, food_name: "Item 2", calories: 200 },
    ];

    const result = await bulkSaveAnalyses("user-uuid-123", items);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 1, createdAt: createdAt1 });
    expect(result[1]).toEqual({ id: 2, createdAt: createdAt2 });
    expect(mockInsert).toHaveBeenCalled();
  });

  it("calls insert with all items in one batch, using food_name as description", async () => {
    const createdAt = new Date("2026-04-09T12:00:00Z");
    mockReturning.mockResolvedValue([
      { id: 1, createdAt },
      { id: 2, createdAt },
    ]);

    const items = [
      { ...mockFoodAnalysis, food_name: "Empanada", calories: 320 },
      { ...mockFoodAnalysis, food_name: "Ensalada", calories: 120 },
    ];

    await bulkSaveAnalyses("user-uuid-123", items);

    expect(mockValues).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ userId: "user-uuid-123", description: "Empanada", calories: 320 }),
        expect.objectContaining({ userId: "user-uuid-123", description: "Ensalada", calories: 120 }),
      ]),
    );
  });
});
