import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the database
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockAnd = vi.fn();
const mockBetween = vi.fn();
const mockEq = vi.fn();
const mockAsc = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: () => ({
    insert: mockInsert,
    select: mockSelect,
  }),
}));

vi.mock("drizzle-orm", () => ({
  and: mockAnd,
  between: mockBetween,
  eq: mockEq,
  asc: mockAsc,
}));

function setupMocks() {
  vi.clearAllMocks();
  mockInsert.mockReset();
  mockSelect.mockReset();
  mockFrom.mockReset();
  mockOnConflictDoUpdate.mockReset();
  mockValues.mockReset();
  mockWhere.mockReset();
  mockOrderBy.mockReset();
  mockAnd.mockReset();
  mockBetween.mockReset();
  mockEq.mockReset();
  mockAsc.mockReset();

  // Setup default mock chain for insert
  mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  mockInsert.mockReturnValue({ values: mockValues });

  // Setup default mock chain for select
  mockOrderBy.mockResolvedValue([]);
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

describe("upsertCalorieGoal", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("calls insert with onConflictDoUpdate for new goal", async () => {
    mockOnConflictDoUpdate.mockResolvedValueOnce([{ id: 1 }]);

    const { upsertCalorieGoal } = await import("@/lib/nutrition-goals");
    await upsertCalorieGoal("user-123", "2026-02-10", 2000);

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        date: "2026-02-10",
        calorieGoal: 2000,
      })
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
  });

  it("updates existing goal on conflict", async () => {
    mockOnConflictDoUpdate.mockResolvedValueOnce([{ id: 1 }]);

    const { upsertCalorieGoal } = await import("@/lib/nutrition-goals");
    await upsertCalorieGoal("user-123", "2026-02-10", 2200);

    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith({
      target: expect.anything(),
      set: expect.objectContaining({
        calorieGoal: 2200,
      }),
    });
  });
});

describe("getCalorieGoalsByDateRange", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns goals within date range ordered by date", async () => {
    mockOrderBy.mockResolvedValueOnce([
      {
        date: "2026-02-08",
        calorieGoal: 1800,
      },
      {
        date: "2026-02-09",
        calorieGoal: 2000,
      },
      {
        date: "2026-02-10",
        calorieGoal: 2200,
      },
    ]);

    const { getCalorieGoalsByDateRange } = await import("@/lib/nutrition-goals");
    const result = await getCalorieGoalsByDateRange("user-123", "2026-02-08", "2026-02-10");

    expect(result).toEqual([
      {
        date: "2026-02-08",
        calorieGoal: 1800,
      },
      {
        date: "2026-02-09",
        calorieGoal: 2000,
      },
      {
        date: "2026-02-10",
        calorieGoal: 2200,
      },
    ]);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
    expect(mockOrderBy).toHaveBeenCalled();
  });

  it("returns empty array when no goals in range", async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    const { getCalorieGoalsByDateRange } = await import("@/lib/nutrition-goals");
    const result = await getCalorieGoalsByDateRange("user-123", "2026-02-08", "2026-02-10");

    expect(result).toEqual([]);
  });

  it("queries with correct userId and date range", async () => {
    mockAnd.mockReturnValue("mocked-and-condition");
    mockEq.mockReturnValue("mocked-eq-condition");
    mockBetween.mockReturnValue("mocked-between-condition");
    mockOrderBy.mockResolvedValueOnce([]);

    const { getCalorieGoalsByDateRange } = await import("@/lib/nutrition-goals");
    await getCalorieGoalsByDateRange("user-123", "2026-02-08", "2026-02-10");

    expect(mockEq).toHaveBeenCalled();
    expect(mockBetween).toHaveBeenCalled();
    expect(mockAnd).toHaveBeenCalled();
  });
});
