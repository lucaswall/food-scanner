import { describe, it, expect, vi, beforeEach } from "vitest";

const mockWhere = vi.fn();
const mockOrderBy = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (...args: unknown[]) => {
          mockWhere(...args);
          return { orderBy: (...a: unknown[]) => mockOrderBy(...a) };
        },
      }),
    }),
  }),
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ op: "and", args }),
  between: (...args: unknown[]) => ({ op: "between", args }),
  eq: (...args: unknown[]) => ({ op: "eq", args }),
  asc: (...args: unknown[]) => ({ op: "asc", args }),
  isNotNull: (col: unknown) => ({ op: "isNotNull", col }),
}));

describe("getDailyGoalsByDateRange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes invalidated rows (proteinGoal IS NOT NULL)", async () => {
    const rows = [{ date: "2026-02-10", calorieGoal: 2000, proteinGoal: 150, carbsGoal: 200, fatGoal: 60 }];
    mockOrderBy.mockResolvedValue(rows);
    const { getDailyGoalsByDateRange } = await import("@/lib/nutrition-goals");
    const result = await getDailyGoalsByDateRange("user-1", "2026-02-08", "2026-02-10");
    expect(result).toEqual(rows);
    const where = mockWhere.mock.calls[0][0] as { args: Array<{ op: string }> };
    expect(where.args.some((a) => a.op === "isNotNull")).toBe(true);
  });
});
