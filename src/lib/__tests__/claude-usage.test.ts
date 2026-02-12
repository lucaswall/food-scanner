import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
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
const mockGroupBy = vi.fn();
const mockOrderBy = vi.fn();
const mockLimit = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
    select: mockSelect,
  })),
}));

vi.mock("@/db/schema", () => ({
  claudeUsage: {
    id: "id",
    userId: "user_id",
    model: "model",
    operation: "operation",
    inputTokens: "input_tokens",
    outputTokens: "output_tokens",
    cacheCreationTokens: "cache_creation_tokens",
    cacheReadTokens: "cache_read_tokens",
    inputPricePerMToken: "input_price_per_m_token",
    outputPricePerMToken: "output_price_per_m_token",
    costUsd: "cost_usd",
    createdAt: "created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, _type: "eq" })),
  sql: vi.fn((parts, ...values) => ({ parts, values, _type: "sql" })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([]);
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ groupBy: mockGroupBy });
  mockGroupBy.mockReturnValue({ orderBy: mockOrderBy });
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockLimit.mockResolvedValue([]);
});

describe("MODEL_PRICING", () => {
  it("exports pricing for claude-sonnet-4-20250514", async () => {
    const { MODEL_PRICING } = await import("@/lib/claude-usage");
    const pricing = MODEL_PRICING["claude-sonnet-4-20250514"];

    expect(pricing).toBeDefined();
    expect(pricing.inputPricePerMToken).toBe(3);
    expect(pricing.outputPricePerMToken).toBe(15);
  });

  it("exports pricing for claude-haiku-4-5-20251001", async () => {
    const { MODEL_PRICING } = await import("@/lib/claude-usage");
    const pricing = MODEL_PRICING["claude-haiku-4-5-20251001"];

    expect(pricing).toBeDefined();
    expect(pricing.inputPricePerMToken).toBe(0.8);
    expect(pricing.outputPricePerMToken).toBe(4);
  });
});

describe("computeCost", () => {
  it("computes cost for basic input and output tokens", async () => {
    const { computeCost } = await import("@/lib/claude-usage");

    // 1000 input tokens at $3/M + 500 output tokens at $15/M
    // = (1000/1000000 * 3) + (500/1000000 * 15)
    // = 0.003 + 0.0075 = 0.010500
    const cost = computeCost(
      { inputTokens: 1000, outputTokens: 500 },
      { inputPricePerMToken: 3, outputPricePerMToken: 15 }
    );

    expect(cost).toBe("0.010500");
  });

  it("returns 0.000000 for zero tokens", async () => {
    const { computeCost } = await import("@/lib/claude-usage");

    const cost = computeCost(
      { inputTokens: 0, outputTokens: 0 },
      { inputPricePerMToken: 3, outputPricePerMToken: 15 }
    );

    expect(cost).toBe("0.000000");
  });

  it("computes cost with cache creation tokens", async () => {
    const { computeCost } = await import("@/lib/claude-usage");

    // Cache creation tokens are charged at 25% MORE than input price
    // 1000 input at $3/M + 500 cache_creation at $3.75/M
    // = (1000/1000000 * 3) + (500/1000000 * 3.75)
    // = 0.003 + 0.001875 = 0.004875
    const cost = computeCost(
      { inputTokens: 1000, outputTokens: 0, cacheCreationTokens: 500 },
      { inputPricePerMToken: 3, outputPricePerMToken: 15 }
    );

    expect(cost).toBe("0.004875");
  });

  it("computes cost with cache read tokens", async () => {
    const { computeCost } = await import("@/lib/claude-usage");

    // Cache read tokens are charged at 90% LESS than input price (10% of input price)
    // 1000 input at $3/M + 500 cache_read at $0.30/M
    // = (1000/1000000 * 3) + (500/1000000 * 0.30)
    // = 0.003 + 0.00015 = 0.003150
    const cost = computeCost(
      { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 500 },
      { inputPricePerMToken: 3, outputPricePerMToken: 15 }
    );

    expect(cost).toBe("0.003150");
  });

  it("computes cost with all token types", async () => {
    const { computeCost } = await import("@/lib/claude-usage");

    // 1000 input at $3/M
    // + 500 output at $15/M
    // + 200 cache_creation at $3.75/M
    // + 300 cache_read at $0.30/M
    // = 0.003 + 0.0075 + 0.00075 + 0.00009 = 0.011340
    const cost = computeCost(
      {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 200,
        cacheReadTokens: 300,
      },
      { inputPricePerMToken: 3, outputPricePerMToken: 15 }
    );

    expect(cost).toBe("0.011340");
  });
});

describe("recordUsage", () => {
  it("inserts usage record with computed cost", async () => {
    const { recordUsage } = await import("@/lib/claude-usage");
    mockReturning.mockResolvedValue([{ id: 1 }]);

    await recordUsage("user-uuid-123", "claude-sonnet-4-20250514", "food-analysis", {
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-uuid-123",
        model: "claude-sonnet-4-20250514",
        operation: "food-analysis",
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        inputPricePerMToken: "3",
        outputPricePerMToken: "15",
        costUsd: "0.010500",
      })
    );
  });

  it("handles cache tokens in usage record", async () => {
    const { recordUsage } = await import("@/lib/claude-usage");
    mockReturning.mockResolvedValue([{ id: 1 }]);

    await recordUsage("user-uuid-123", "claude-sonnet-4-20250514", "food-analysis", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 200,
      cacheReadTokens: 300,
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheCreationTokens: 200,
        cacheReadTokens: 300,
        costUsd: "0.011340",
      })
    );
  });

  it("logs warning and uses zero pricing for unknown model", async () => {
    const { recordUsage } = await import("@/lib/claude-usage");
    const { logger } = await import("@/lib/logger");
    mockReturning.mockResolvedValue([{ id: 1 }]);

    await recordUsage("user-uuid-123", "unknown-model", "food-analysis", {
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "unknown-model",
      }),
      expect.stringContaining("Unknown Claude model")
    );

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        inputPricePerMToken: "0",
        outputPricePerMToken: "0",
        costUsd: "0.000000",
      })
    );
  });

  it("does not throw on database error (fire-and-forget)", async () => {
    const { recordUsage } = await import("@/lib/claude-usage");
    const { logger } = await import("@/lib/logger");
    mockValues.mockRejectedValue(new Error("DB error"));

    // Should not throw
    await expect(
      recordUsage("user-uuid-123", "claude-sonnet-4-20250514", "food-analysis", {
        inputTokens: 1000,
        outputTokens: 500,
      })
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
      }),
      expect.stringContaining("Failed to record Claude usage")
    );
  });
});

describe("getMonthlyUsage", () => {
  it("returns monthly usage aggregated by month", async () => {
    const { getMonthlyUsage } = await import("@/lib/claude-usage");

    mockLimit.mockResolvedValue([
      {
        month: "2026-02",
        totalRequests: 10,
        totalInputTokens: 5000,
        totalOutputTokens: 2500,
        totalCostUsd: "0.052500",
      },
      {
        month: "2026-01",
        totalRequests: 5,
        totalInputTokens: 3000,
        totalOutputTokens: 1500,
        totalCostUsd: "0.031500",
      },
    ]);

    const result = await getMonthlyUsage("user-uuid-123", 3);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      month: "2026-02",
      totalRequests: 10,
      totalInputTokens: 5000,
      totalOutputTokens: 2500,
      totalCostUsd: "0.052500",
    });
  });

  it("returns empty array when no usage exists", async () => {
    const { getMonthlyUsage } = await import("@/lib/claude-usage");
    mockLimit.mockResolvedValue([]);

    const result = await getMonthlyUsage("user-uuid-123", 3);

    expect(result).toEqual([]);
  });
});
