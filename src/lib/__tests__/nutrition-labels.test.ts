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
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockUpdateReturning = vi.fn();
const mockDelete = vi.fn();
const mockDeleteWhere = vi.fn();
const mockDeleteReturning = vi.fn();

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
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return { set: mockUpdateSet };
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
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
  mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const {
  searchLabels,
  insertLabel,
  updateLabel,
  deleteLabel,
  getLabelById,
  getAllLabels,
  findDuplicateLabel,
} = await import("@/lib/nutrition-labels");

const USER_A = "user-a-uuid";
const USER_B = "user-b-uuid";

const SAMPLE_LABEL = {
  id: 1,
  userId: USER_A,
  brand: "La Serenisima",
  productName: "Leche Entera",
  variant: null,
  servingSizeG: 200,
  servingSizeLabel: "1 vaso (200ml)",
  calories: 130,
  proteinG: 6.4,
  carbsG: 9.6,
  fatG: 6.8,
  fiberG: 0,
  sodiumMg: 100,
  saturatedFatG: 4.2,
  transFatG: 0,
  sugarsG: 9.6,
  extraNutrients: null,
  source: "photo_scan",
  notes: null,
  createdAt: new Date("2026-03-01T10:00:00Z"),
  updatedAt: new Date("2026-03-01T10:00:00Z"),
};

describe("searchLabels", () => {
  it("returns labels matching any search term across brand/productName/variant/notes", async () => {
    mockLimit.mockResolvedValue([SAMPLE_LABEL]);

    const result = await searchLabels(USER_A, ["serenisima", "leche"]);
    expect(result).toHaveLength(1);
    expect(result[0].brand).toBe("La Serenisima");
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
  });

  it("returns empty array when no matches found", async () => {
    mockLimit.mockResolvedValue([]);

    const result = await searchLabels(USER_A, ["nonexistent"]);
    expect(result).toHaveLength(0);
  });

  it("returns results sorted by updatedAt DESC with limit 10", async () => {
    const labels = [SAMPLE_LABEL, { ...SAMPLE_LABEL, id: 2 }];
    mockLimit.mockResolvedValue(labels);

    const result = await searchLabels(USER_A, ["leche"]);
    expect(result).toHaveLength(2);
    expect(mockOrderBy).toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledWith(10);
  });
});

describe("insertLabel", () => {
  it("creates a label and returns id and createdAt", async () => {
    const createdAt = new Date("2026-03-01T10:00:00Z");
    mockReturning.mockResolvedValue([{ id: 42, createdAt }]);

    const result = await insertLabel(USER_A, {
      brand: "La Serenisima",
      productName: "Leche Entera",
      variant: null,
      servingSizeG: 200,
      servingSizeLabel: "1 vaso (200ml)",
      calories: 130,
      proteinG: 6.4,
      carbsG: 9.6,
      fatG: 6.8,
      fiberG: 0,
      sodiumMg: 100,
      saturatedFatG: 4.2,
      transFatG: 0,
      sugarsG: 9.6,
      extraNutrients: null,
      source: "photo_scan",
      notes: null,
    });

    expect(result.id).toBe(42);
    expect(result.createdAt).toEqual(createdAt);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalled();
  });
});

describe("updateLabel", () => {
  it("updates label and returns updated record", async () => {
    const updatedAt = new Date();
    mockUpdateReturning.mockResolvedValue([{ ...SAMPLE_LABEL, calories: 140, updatedAt }]);

    const result = await updateLabel(USER_A, 1, { calories: 140 });
    expect(result.calories).toBe(140);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalled();
    expect(mockUpdateWhere).toHaveBeenCalled();
  });

  it("throws if label not found or wrong userId", async () => {
    mockUpdateReturning.mockResolvedValue([]);

    await expect(updateLabel(USER_B, 1, { calories: 140 })).rejects.toThrow("Label not found");
  });
});

describe("deleteLabel", () => {
  it("returns true when label is deleted", async () => {
    mockDeleteReturning.mockResolvedValue([{ id: 1 }]);

    const result = await deleteLabel(USER_A, 1);
    expect(result).toBe(true);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteWhere).toHaveBeenCalled();
  });

  it("returns false when label not found or wrong userId", async () => {
    mockDeleteReturning.mockResolvedValue([]);

    const result = await deleteLabel(USER_B, 1);
    expect(result).toBe(false);
  });
});

describe("getLabelById", () => {
  it("returns the label when found for the correct user", async () => {
    // getLabelById chains: select -> from -> where -> limit -> [0]
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([SAMPLE_LABEL]);

    const result = await getLabelById(USER_A, 1);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(1);
    expect(result!.userId).toBe(USER_A);
  });

  it("returns null when not found or wrong userId", async () => {
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([]);

    const result = await getLabelById(USER_B, 1);
    expect(result).toBeNull();
  });
});

describe("getAllLabels", () => {
  it("returns all labels for user sorted by updatedAt DESC", async () => {
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValueOnce([SAMPLE_LABEL]);

    const result = await getAllLabels(USER_A);
    expect(result).toHaveLength(1);
    expect(result[0].userId).toBe(USER_A);
    expect(mockOrderBy).toHaveBeenCalled();
  });

  it("filters labels by optional text query", async () => {
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValueOnce([SAMPLE_LABEL]);

    const result = await getAllLabels(USER_A, "serenisima");
    expect(result).toHaveLength(1);
    expect(mockWhere).toHaveBeenCalled();
  });

  it("returns empty array when no labels exist", async () => {
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValueOnce([]);

    const result = await getAllLabels(USER_A);
    expect(result).toHaveLength(0);
  });
});

describe("findDuplicateLabel", () => {
  it("returns matching labels for same brand and productName", async () => {
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValueOnce([SAMPLE_LABEL]);

    const result = await findDuplicateLabel(USER_A, "La Serenisima", "Leche Entera");
    expect(result).toHaveLength(1);
    expect(result[0].brand).toBe("La Serenisima");
  });

  it("returns empty array when no duplicates found", async () => {
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValueOnce([]);

    const result = await findDuplicateLabel(USER_A, "Danone", "Activia");
    expect(result).toHaveLength(0);
  });

  it("filters by userId to enforce ownership isolation", async () => {
    mockWhere.mockReturnValueOnce({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValueOnce([]);

    // User B searching for User A's labels
    const result = await findDuplicateLabel(USER_B, "La Serenisima", "Leche Entera");
    expect(result).toHaveLength(0);
    expect(mockWhere).toHaveBeenCalled();
  });
});

describe("Ownership isolation", () => {
  it("updateLabel: user B cannot update user A's label", async () => {
    mockUpdateReturning.mockResolvedValue([]);
    await expect(updateLabel(USER_B, 1, { calories: 999 })).rejects.toThrow("Label not found");
  });

  it("deleteLabel: user B cannot delete user A's label", async () => {
    mockDeleteReturning.mockResolvedValue([]);
    const result = await deleteLabel(USER_B, 1);
    expect(result).toBe(false);
  });

  it("getLabelById: user B cannot read user A's label", async () => {
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([]);
    const result = await getLabelById(USER_B, 1);
    expect(result).toBeNull();
  });
});
