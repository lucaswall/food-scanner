import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
      };
    },
  };
});

// Mock the logger
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock recordUsage
const mockRecordUsage = vi.fn();
vi.mock("@/lib/claude-usage", () => ({
  recordUsage: mockRecordUsage,
}));

// Mock the database
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockValues = vi.fn();
const mockWhere = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: () => ({
    insert: mockInsert,
    select: mockSelect,
  }),
}));

vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");

const validLumenGoals = {
  day_type: "High Carb",
  protein_goal: 120,
  carbs_goal: 200,
  fat_goal: 60,
};

function setupMocks() {
  vi.clearAllMocks();
  mockCreate.mockReset();
  mockInsert.mockReset();
  mockSelect.mockReset();
  mockFrom.mockReset();
  mockOnConflictDoUpdate.mockReset();
  mockValues.mockReset();
  mockWhere.mockReset();

  // Setup default mock chain for insert
  mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  mockInsert.mockReturnValue({ values: mockValues });

  // Setup default mock chain for select
  mockWhere.mockResolvedValue([]);
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

describe("parseLumenScreenshot", () => {
  beforeEach(() => {
    setupMocks();
    mockRecordUsage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns parsed goals for valid tool_use response", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-haiku-4-5-20251001",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_lumen_goals",
          input: validLumenGoals,
        },
      ],
      usage: {
        input_tokens: 500,
        output_tokens: 50,
      },
    });

    const { parseLumenScreenshot } = await import("@/lib/lumen");
    const result = await parseLumenScreenshot(
      { base64: "abc123", mimeType: "image/jpeg" },
      "user-123"
    );

    expect(result).toEqual({
      dayType: "High Carb",
      proteinGoal: 120,
      carbsGoal: 200,
      fatGoal: 60,
    });
  });

  it("calls recordUsage with correct arguments for lumen parsing", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-haiku-4-5-20251001",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_lumen_goals",
          input: validLumenGoals,
        },
      ],
      usage: {
        input_tokens: 500,
        output_tokens: 50,
        cache_read_input_tokens: 100,
      },
    });

    const { parseLumenScreenshot } = await import("@/lib/lumen");
    await parseLumenScreenshot(
      { base64: "abc123", mimeType: "image/jpeg" },
      "user-123"
    );

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-haiku-4-5-20251001",
      "lumen-parsing",
      {
        inputTokens: 500,
        outputTokens: 50,
        cacheCreationTokens: 0,
        cacheReadTokens: 100,
      }
    );
  });

  it("succeeds even if recordUsage throws", async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error("Database error"));

    mockCreate.mockResolvedValueOnce({
      model: "claude-haiku-4-5-20251001",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_lumen_goals",
          input: validLumenGoals,
        },
      ],
      usage: {
        input_tokens: 500,
        output_tokens: 50,
      },
    });

    const { parseLumenScreenshot } = await import("@/lib/lumen");
    const result = await parseLumenScreenshot(
      { base64: "abc123", mimeType: "image/jpeg" },
      "user-123"
    );

    expect(result).toEqual({
      dayType: "High Carb",
      proteinGoal: 120,
      carbsGoal: 200,
      fatGoal: 60,
    });
    expect(mockRecordUsage).toHaveBeenCalled();
  });

  it("uses claude-haiku-4-5-20251001 model", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_lumen_goals",
          input: validLumenGoals,
        },
      ],
    });

    const { parseLumenScreenshot } = await import("@/lib/lumen");
    await parseLumenScreenshot({ base64: "abc123", mimeType: "image/jpeg" });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
      })
    );
  });

  it("uses max_tokens: 256", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_lumen_goals",
          input: validLumenGoals,
        },
      ],
    });

    const { parseLumenScreenshot } = await import("@/lib/lumen");
    await parseLumenScreenshot({ base64: "abc123", mimeType: "image/jpeg" });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 256,
      })
    );
  });

  it("forces tool_choice: { type: 'tool', name: 'report_lumen_goals' }", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_lumen_goals",
          input: validLumenGoals,
        },
      ],
    });

    const { parseLumenScreenshot } = await import("@/lib/lumen");
    await parseLumenScreenshot({ base64: "abc123", mimeType: "image/jpeg" });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "tool", name: "report_lumen_goals" },
      })
    );
  });

  it("throws LUMEN_PARSE_ERROR on API failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API connection failed"));

    const { parseLumenScreenshot } = await import("@/lib/lumen");

    await expect(
      parseLumenScreenshot({ base64: "abc123", mimeType: "image/jpeg" }, "user-123")
    ).rejects.toMatchObject({ name: "LUMEN_PARSE_ERROR" });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    // recordUsage should NOT be called on failure
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("throws LUMEN_PARSE_ERROR when no tool_use content block", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: "I cannot parse this image",
        },
      ],
    });

    const { parseLumenScreenshot } = await import("@/lib/lumen");

    await expect(
      parseLumenScreenshot({ base64: "abc123", mimeType: "image/jpeg" })
    ).rejects.toMatchObject({ name: "LUMEN_PARSE_ERROR" });
  });

  it("throws LUMEN_PARSE_ERROR when goals are negative", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_lumen_goals",
          input: {
            ...validLumenGoals,
            protein_goal: -10,
          },
        },
      ],
    });

    const { parseLumenScreenshot } = await import("@/lib/lumen");

    await expect(
      parseLumenScreenshot({ base64: "abc123", mimeType: "image/jpeg" })
    ).rejects.toMatchObject({ name: "LUMEN_PARSE_ERROR" });
  });

  it("throws LUMEN_PARSE_ERROR when goals are zero", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_lumen_goals",
          input: {
            ...validLumenGoals,
            carbs_goal: 0,
          },
        },
      ],
    });

    const { parseLumenScreenshot } = await import("@/lib/lumen");

    await expect(
      parseLumenScreenshot({ base64: "abc123", mimeType: "image/jpeg" })
    ).rejects.toMatchObject({ name: "LUMEN_PARSE_ERROR" });
  });

  it("throws LUMEN_PARSE_ERROR when day_type is empty", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_lumen_goals",
          input: {
            ...validLumenGoals,
            day_type: "",
          },
        },
      ],
    });

    const { parseLumenScreenshot } = await import("@/lib/lumen");

    await expect(
      parseLumenScreenshot({ base64: "abc123", mimeType: "image/jpeg" })
    ).rejects.toMatchObject({ name: "LUMEN_PARSE_ERROR" });
  });
});

describe("upsertLumenGoals", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("calls insert with onConflictDoUpdate", async () => {
    mockOnConflictDoUpdate.mockResolvedValueOnce([{ id: 1 }]);

    const { upsertLumenGoals } = await import("@/lib/lumen");
    await upsertLumenGoals(
      "user-123",
      "2026-02-10",
      {
        dayType: "High Carb",
        proteinGoal: 120,
        carbsGoal: 200,
        fatGoal: 60,
      }
    );

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        date: "2026-02-10",
        dayType: "High Carb",
        proteinGoal: 120,
        carbsGoal: 200,
        fatGoal: 60,
      })
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
  });
});

describe("getLumenGoalsByDate", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns goals when row exists", async () => {
    mockWhere.mockResolvedValueOnce([
      {
        date: "2026-02-10",
        dayType: "High Carb",
        proteinGoal: 120,
        carbsGoal: 200,
        fatGoal: 60,
      },
    ]);

    const { getLumenGoalsByDate } = await import("@/lib/lumen");
    const result = await getLumenGoalsByDate("user-123", "2026-02-10");

    expect(result).toEqual({
      date: "2026-02-10",
      dayType: "High Carb",
      proteinGoal: 120,
      carbsGoal: 200,
      fatGoal: 60,
    });
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockWhere).toHaveBeenCalled();
  });

  it("returns null when no row exists", async () => {
    mockWhere.mockResolvedValueOnce([]);

    const { getLumenGoalsByDate } = await import("@/lib/lumen");
    const result = await getLumenGoalsByDate("user-123", "2026-02-10");

    expect(result).toBeNull();
  });
});
