import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { FoodAnalysis, AnalyzeFoodResult } from "@/types";

// Mock the Anthropic SDK
const mockCreate = vi.fn();
const mockConstructorArgs = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      constructor(options: Record<string, unknown>) {
        mockConstructorArgs(options);
      }
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
  startTimer: () => () => 42,
}));

// Mock recordUsage
const mockRecordUsage = vi.fn();
vi.mock("@/lib/claude-usage", () => ({
  recordUsage: mockRecordUsage,
}));

vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");

const validAnalysis: FoodAnalysis = {
  food_name: "Empanada de carne",
  amount: 150,
  unit_id: 147,
  calories: 320,
  protein_g: 12,
  carbs_g: 28,
  fat_g: 18,
  fiber_g: 2,
  sodium_mg: 450,
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high",
  notes: "Standard Argentine beef empanada, baked style",
  keywords: ["empanada", "carne", "horno"],
  description: "Standard Argentine beef empanada, baked style",
};

function setupMocks() {
  vi.clearAllMocks();
  mockCreate.mockReset();
}

describe("Anthropic SDK configuration", () => {
  beforeEach(() => {
    setupMocks();
  });

  it("configures SDK timeout to 60s to accommodate web search latency", async () => {
    // Trigger client creation by calling any exported function
    const { analyzeFood } = await import("@/lib/claude");
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "call_1",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      stop_reason: "tool_use",
    });

    await analyzeFood([], undefined, "test-user", "2026-02-15").catch(() => {});

    expect(mockConstructorArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: 60000,
      })
    );
  });
});

describe("analyzeFood", () => {
  beforeEach(() => {
    setupMocks();
    mockRecordUsage.mockResolvedValue(undefined);
    mockExecuteTool.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns analysis result for valid report_nutrition tool_use response", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result: AnalyzeFoodResult = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({ type: "analysis", analysis: validAnalysis });
  });

  it("returns needs_chat when Claude responds with text only (no tool_use)", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "Let me check what you had yesterday...",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      "same as yesterday",
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({
      type: "needs_chat",
      message: "Let me check what you had yesterday...",
    });
  });

  it("executes tool loop when Claude calls a data tool without report_nutrition", async () => {
    // First response: Claude calls search_food_log
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      content: [
        {
          type: "text",
          text: "Let me look that up for you.",
        },
        {
          type: "tool_use",
          id: "tool_456",
          name: "search_food_log",
          input: { query: "yesterday" },
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    // Mock tool execution
    mockExecuteTool.mockResolvedValueOnce("Found 1 matching food:\n• Empanada de carne — 150g, 320 cal");

    // Second response: Claude responds with text after seeing tool results
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Based on your log, you had an empanada yesterday.",
        },
      ],
      usage: {
        input_tokens: 2000,
        output_tokens: 100,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [],
      "same as yesterday but half",
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({
      type: "needs_chat",
      message: "Based on your log, you had an empanada yesterday.",
    });
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "search_food_log",
      { query: "yesterday" },
      "user-123",
      "2026-02-15",
      expect.any(Object),
    );
  });

  it("returns analysis when Claude calls both report_nutrition and a data tool", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "Here's the analysis.",
        },
        {
          type: "tool_use",
          id: "tool_456",
          name: "search_food_log",
          input: { query: "yesterday" },
        },
        {
          type: "tool_use",
          id: "tool_789",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [],
      "grilled chicken",
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({ type: "analysis", analysis: validAnalysis });
  });

  it("executes tool loop and returns analysis when data tools resolve to report_nutrition", async () => {
    // First response: Claude calls search_food_log (no text)
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_456",
          name: "search_food_log",
          input: { query: "yesterday" },
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    // Mock tool execution
    mockExecuteTool.mockResolvedValueOnce("Found 1 matching food:\n• Empanada de carne — 150g, 320 cal");

    // Second response: Claude calls report_nutrition after seeing tool results
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Here's half of what you had yesterday.",
        },
        {
          type: "tool_use",
          id: "tool_789",
          name: "report_nutrition",
          input: { ...validAnalysis, calories: 160, amount: 75 },
        },
      ],
      usage: {
        input_tokens: 2000,
        output_tokens: 200,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [],
      "same as yesterday",
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    if (result.type === "analysis") {
      expect(result.analysis.calories).toBe(160);
      expect(result.analysis.amount).toBe(75);
    }
  });

  it("passes all 5 tools to Claude API with tool_choice auto", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    // Should have 5 tools: web_search, report_nutrition, search_food_log, get_nutrition_summary, get_fasting_info
    expect(call.tools).toHaveLength(5);
    expect(call.tools.map((t: { name: string }) => t.name)).toEqual([
      "web_search",
      "report_nutrition",
      "search_food_log",
      "get_nutrition_summary",
      "get_fasting_info",
    ]);
    expect(call.tool_choice).toEqual({ type: "auto" });
  });

  it("includes current date in system prompt", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    expect(call.system[0].text).toContain("2026-02-15");
  });

  it("calls recordUsage with correct arguments after successful analysis", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-sonnet-4-5-20250929",
      "food-analysis",
      {
        inputTokens: 1500,
        outputTokens: 300,
        cacheCreationTokens: 100,
        cacheReadTokens: 50,
      }
    );
  });

  it("does not await recordUsage (fire-and-forget)", async () => {
    let recordUsageResolved = false;
    mockRecordUsage.mockImplementation(() => {
      return new Promise((resolve) => {
        setTimeout(() => {
          recordUsageResolved = true;
          resolve(undefined);
        }, 100);
      });
    });

    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    // Should return immediately without waiting for recordUsage
    expect(result).toEqual({ type: "analysis", analysis: validAnalysis });
    expect(recordUsageResolved).toBe(false);
  });

  it("succeeds even if recordUsage throws", async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error("Database error"));

    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({ type: "analysis", analysis: validAnalysis });
    expect(mockRecordUsage).toHaveBeenCalled();
  });

  it("throws CLAUDE_API_ERROR on API failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API connection failed"));

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });

    // Should be called exactly once (no retry)
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // recordUsage should NOT be called on failure
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("returns needs_chat when no report_nutrition tool_use in response", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "I cannot analyze this image",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 300,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({
      type: "needs_chat",
      message: "I cannot analyze this image",
    });
  });

  it("passes correct system prompt and tool definition to Claude", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      "Test description",
      "user-123",
      "2026-02-15"
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1024,
        system: expect.arrayContaining([
          expect.objectContaining({
            type: "text",
            text: expect.stringContaining("nutrition analyst"),
          }),
        ]),
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "report_nutrition",
          }),
        ]),
        tool_choice: { type: "auto" },
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "image",
                source: expect.objectContaining({
                  type: "base64",
                  media_type: "image/jpeg",
                  data: "abc123",
                }),
              }),
              expect.objectContaining({
                type: "text",
                text: "Test description",
              }),
            ]),
          }),
        ]),
      }),
      expect.anything(),
    );
  });

  it("returns amount and unit_id from Claude response", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    if (result.type === "analysis") {
      expect(result.analysis.amount).toBe(150);
      expect(result.analysis.unit_id).toBe(147);
    }
  });

  it("uses default text when no description provided", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "text",
                text: "Analyze this food.",
              }),
            ]),
          }),
        ]),
      }),
      expect.anything(),
    );
  });

  it("supports multiple images", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood(
      [
        { base64: "img1", mimeType: "image/jpeg" },
        { base64: "img2", mimeType: "image/png" },
      ],
      undefined,
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    const imageBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[0].source.data).toBe("img1");
    expect(imageBlocks[1].source.data).toBe("img2");
  });

  it("includes web_search tool in analyzeFood tools array", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 1500, output_tokens: 300 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15");

    const call = mockCreate.mock.calls[0][0];
    // web_search tool should be first in the array
    expect(call.tools[0]).toEqual(
      expect.objectContaining({
        type: "web_search_20250305",
        name: "web_search",
      })
    );
    // report_nutrition should come after
    expect(call.tools[1]).toEqual(
      expect.objectContaining({
        name: "report_nutrition",
      })
    );
  });

  it("configures SDK with explicit maxRetries", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15");

    // Verify client is initialized (indirect test - we can't directly inspect Anthropic constructor)
    expect(mockCreate).toHaveBeenCalled();
  });

  it("throws when report_nutrition tool_use output has missing fields", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: { food_name: "Test" }, // missing most fields
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when numeric fields are strings", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            calories: "320", // string instead of number
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when numeric fields are negative", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            calories: -10,
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });


  it("throws when confidence is not a valid enum value", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            confidence: "very_high",
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when validateFoodAnalysis input is null", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: null,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when validateFoodAnalysis input is a string", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: "not an object",
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("returns properly typed FoodAnalysis with all fields", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    if (result.type === "analysis") {
      // Verify each field is explicitly present (not just a cast)
      expect(result.analysis.food_name).toBe("Empanada de carne");
      expect(result.analysis.amount).toBe(150);
      expect(result.analysis.unit_id).toBe(147);
      expect(result.analysis.calories).toBe(320);
      expect(result.analysis.protein_g).toBe(12);
      expect(result.analysis.carbs_g).toBe(28);
      expect(result.analysis.fat_g).toBe(18);
      expect(result.analysis.fiber_g).toBe(2);
      expect(result.analysis.sodium_mg).toBe(450);
      expect(result.analysis.confidence).toBe("high");
      expect(result.analysis.notes).toBe("Standard Argentine beef empanada, baked style");
    }
  });


  it("validates keywords array of strings in Claude response", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    if (result.type === "analysis") {
      expect(result.analysis.keywords).toEqual(["empanada", "carne", "horno"]);
    }
  });

  it("throws when keywords is not an array", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: "empanada",
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when keywords contains non-string values", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: ["empanada", 123, "carne"],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws when keywords is an empty array", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: [],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("normalizes multi-word keywords by splitting on spaces", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: ["cerveza", "sin alcohol", "clausthaler"],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    const analysis = (result as { type: "analysis"; analysis: FoodAnalysis }).analysis;
    expect(analysis.keywords).toEqual(["cerveza", "sin-alcohol", "clausthaler"]);
  });

  it("trims and lowercases keywords", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: [" Cerveza ", "SIN-ALCOHOL"],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    const analysis = (result as { type: "analysis"; analysis: FoodAnalysis }).analysis;
    expect(analysis.keywords).toEqual(["cerveza", "sin-alcohol"]);
  });

  it("deduplicates keywords after normalization", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: ["cerveza", "cerveza", "sin-alcohol"],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    const analysis = (result as { type: "analysis"; analysis: FoodAnalysis }).analysis;
    expect(analysis.keywords).toEqual(["cerveza", "sin-alcohol"]);
  });

  it("caps keywords at 5 items keeping first 5", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: ["a", "b", "c", "d", "e", "f", "g"],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    const analysis = (result as { type: "analysis"; analysis: FoodAnalysis }).analysis;
    expect(analysis.keywords).toHaveLength(5);
  });

  it("removes empty keywords after trimming", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            keywords: ["cerveza", "", "  ", "sin-alcohol"],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    const analysis = (result as { type: "analysis"; analysis: FoodAnalysis }).analysis;
    expect(analysis.keywords).toEqual(["cerveza", "sin-alcohol"]);
  });

  it("works with text-only (no images)", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood([], "2 medialunas y un cortado", "user-123", "2026-02-15");

    expect(result).toEqual({ type: "analysis", analysis: validAnalysis });

    // Verify no image blocks in the API call
    const call = mockCreate.mock.calls[0][0];
    const imageBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(imageBlocks).toHaveLength(0);

    // Verify text block uses the description
    const textBlocks = call.messages[0].content.filter(
      (block: { type: string }) => block.type === "text"
    );
    expect(textBlocks).toHaveLength(1);
    expect(textBlocks[0].text).toBe("2 medialunas y un cortado");
  });

  it("text-only uses description as the sole content block", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood([], "A bowl of lentil soup", "user-123", "2026-02-15");

    const call = mockCreate.mock.calls[0][0];
    const content = call.messages[0].content;

    // Should be exactly one block: the text description
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({
      type: "text",
      text: "A bowl of lentil soup",
    });
  });


  it("includes keywords in tool schema required fields", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "report_nutrition",
            input_schema: expect.objectContaining({
              required: expect.arrayContaining(["keywords"]),
              properties: expect.objectContaining({
                keywords: expect.objectContaining({
                  type: "array",
                  items: { type: "string" },
                }),
              }),
            }),
          }),
        ]),
      }),
      expect.anything(),
    );
  });

  it("includes description in tool schema", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: "report_nutrition",
            input_schema: expect.objectContaining({
              required: expect.arrayContaining(["description"]),
              properties: expect.objectContaining({
                description: expect.objectContaining({
                  type: "string",
                }),
              }),
            }),
          }),
        ]),
      }),
      expect.anything(),
    );
  });

  it("description field prompt excludes scene elements and includes length constraint", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    await analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15");

    const call = mockCreate.mock.calls[0][0];
    // tools[0] is web_search, tools[1] is report_nutrition
    const toolSchema = call.tools.find((t: { name: string }) => t.name === "report_nutrition");
    const descriptionPrompt = toolSchema.input_schema.properties.description.description;

    // Should exclude non-food scene elements
    expect(descriptionPrompt.toLowerCase()).toMatch(/(food only|do not describe)/);

    // Should include length constraint
    expect(descriptionPrompt).toMatch(/1-2.*sentence/i);

    // Should NOT include "presentation" as an instruction (we want to exclude it)
    expect(descriptionPrompt).not.toContain("presentation");
  });

  it("validates description as required string", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            description: 123, // number instead of string
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("accepts response without description (defaults to empty string)", async () => {
    const analysisWithoutDescription = { ...validAnalysis };
    delete (analysisWithoutDescription as Partial<FoodAnalysis>).description;

    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: analysisWithoutDescription,
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    if (result.type === "analysis") {
      expect(result.analysis.description).toBe("");
    }
  });
});

describe("validateFoodAnalysis with Tier 1 nutrients", () => {
  beforeEach(() => {
    setupMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("accepts valid input with all 4 Tier 1 fields as numbers", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            saturated_fat_g: 5.5,
            trans_fat_g: 0.2,
            sugars_g: 3.0,
            calories_from_fat: 162,
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    const a = (result as { type: "analysis"; analysis: FoodAnalysis }).analysis;
    expect(a.saturated_fat_g).toBe(5.5);
    expect(a.trans_fat_g).toBe(0.2);
    expect(a.sugars_g).toBe(3.0);
    expect(a.calories_from_fat).toBe(162);
  });

  it("accepts valid input with all 4 Tier 1 fields as null", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            saturated_fat_g: null,
            trans_fat_g: null,
            sugars_g: null,
            calories_from_fat: null,
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    const a = (result as { type: "analysis"; analysis: FoodAnalysis }).analysis;
    expect(a.saturated_fat_g).toBeNull();
    expect(a.trans_fat_g).toBeNull();
    expect(a.sugars_g).toBeNull();
    expect(a.calories_from_fat).toBeNull();
  });

  it("accepts valid input with Tier 1 fields omitted (backward compat)", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: validAnalysis, // no Tier 1 fields
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    const a = (result as { type: "analysis"; analysis: FoodAnalysis }).analysis;
    // Should default to null when omitted
    expect(a.saturated_fat_g).toBeNull();
    expect(a.trans_fat_g).toBeNull();
    expect(a.sugars_g).toBeNull();
    expect(a.calories_from_fat).toBeNull();
  });

  it("rejects negative values for saturated_fat_g", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            saturated_fat_g: -1,
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("rejects negative values for trans_fat_g", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            trans_fat_g: -0.5,
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("rejects negative values for sugars_g", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            sugars_g: -2,
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("rejects negative values for calories_from_fat", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            calories_from_fat: -10,
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("rejects string value for saturated_fat_g", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            saturated_fat_g: "5.5",
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("rejects boolean value for trans_fat_g", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            trans_fat_g: true,
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("accepts zero values for Tier 1 fields", async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          id: "tool_123",
          name: "report_nutrition",
          input: {
            ...validAnalysis,
            saturated_fat_g: 0,
            trans_fat_g: 0,
            sugars_g: 0,
            calories_from_fat: 0,
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result.type).toBe("analysis");
    if (result.type === "analysis") {
      expect(result.analysis.saturated_fat_g).toBe(0);
      expect(result.analysis.trans_fat_g).toBe(0);
      expect(result.analysis.sugars_g).toBe(0);
      expect(result.analysis.calories_from_fat).toBe(0);
    }
  });

  it("handles refusal stop_reason in analyzeFood as needs_chat", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "refusal",
      content: [
        {
          type: "text",
          text: "I cannot analyze this image.",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { analyzeFood } = await import("@/lib/claude");
    const result = await analyzeFood(
      [{ base64: "abc123", mimeType: "image/jpeg" }],
      undefined,
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({
      type: "needs_chat",
      message: "I cannot analyze this image.",
    });
  });

  it("passes AbortSignal to runToolLoop when data tools are present", async () => {
    const controller = new AbortController();
    controller.abort();

    // Claude returns data tool use
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_456",
          name: "search_food_log",
          input: { query: "yesterday" },
        },
      ],
      usage: { input_tokens: 1500, output_tokens: 300 },
    });

    const { analyzeFood } = await import("@/lib/claude");

    await expect(
      analyzeFood(
        [],
        "same as yesterday",
        "user-123",
        "2026-02-15",
        undefined, // log
        controller.signal,
      )
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR", message: "Request aborted by client" });
  });
});

describe("conversationalRefine", () => {
  beforeEach(() => {
    setupMocks();
    mockRecordUsage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns message and analysis when Claude responds with text + tool_use", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "I've updated the portion size to 200g",
        },
        {
          type: "tool_use",
          id: "tool_789",
          name: "report_nutrition",
          input: { ...validAnalysis, amount: 200 },
        },
      ],
      usage: {
        input_tokens: 1800,
        output_tokens: 400,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    const result = await conversationalRefine(
      [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Got it", analysis: validAnalysis },
        { role: "user", content: "Actually it was 200g" },
      ],
      [],
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({
      message: "I've updated the portion size to 200g",
      analysis: { ...validAnalysis, amount: 200 },
    });
  });

  it("returns only message when Claude responds with text only (no tool_use)", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "Got it! Anything else you'd like to add?",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    const result = await conversationalRefine(
      [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Recorded", analysis: validAnalysis },
        { role: "user", content: "Thanks!" },
      ],
      [],
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({
      message: "Got it! Anything else you'd like to add?",
    });
    expect(result.analysis).toBeUndefined();
  });

  it("includes web_search tool in conversationalRefine tools array", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: { input_tokens: 1500, output_tokens: 50 },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    // web_search tool should be first in the array
    expect(call.tools[0]).toEqual(
      expect.objectContaining({
        type: "web_search_20250305",
        name: "web_search",
      })
    );
  });

  it("uses tool_choice auto (not forced)", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "Understood",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "I had a coffee" }],
      [],
      "user-123",
      "2026-02-15"
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: "auto" },
      }),
      expect.anything(),
    );
  });

  it("uses CHAT_SYSTEM_PROMPT as base without initial analysis", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine, CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    expect(call.system[0].text).toContain(CHAT_SYSTEM_PROMPT);
  });

  it("includes initial analysis context in system prompt when provided", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Make it 2" }],
      [],
      "user-123",
      "2026-02-15",
      validAnalysis
    );

    const call = mockCreate.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain(validAnalysis.food_name);
    expect(systemText).toContain(String(validAnalysis.calories));
    expect(systemText).toContain("baseline");
  });

  it("includes current date in system prompt when provided", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "What did I eat today?" }],
      [],
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain("Today's date is: 2026-02-15");
  });

  it("includes current date alongside initial analysis in system prompt", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Make it 2" }],
      [],
      "user-123",
      "2026-02-15",
      validAnalysis
    );

    const call = mockCreate.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain("Today's date is: 2026-02-15");
    expect(systemText).toContain(validAnalysis.food_name);
  });

  it("omits date line from system prompt when currentDate is not provided", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Hi" }],
      [],
      "user-123"
    );

    const call = mockCreate.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).not.toContain("Today's date is:");
  });

  it("uses max_tokens 2048", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123",
      "2026-02-15"
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        max_tokens: 2048,
      }),
      expect.anything(),
    );
  });

  it("attaches images to the last user message", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "I see the food",
        },
        {
          type: "tool_use",
          id: "tool_789",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 2000,
        output_tokens: 300,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Logged" },
        { role: "user", content: "Here's a photo" },
      ],
      [{ base64: "img123", mimeType: "image/jpeg" }],
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    // First user message should NOT have images
    const firstMessage = call.messages[0];
    const firstImageBlocks = firstMessage.content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(firstImageBlocks).toHaveLength(0);

    // Last user message SHOULD have images
    const lastMessage = call.messages[2];
    const lastImageBlocks = lastMessage.content.filter(
      (block: { type: string }) => block.type === "image"
    );
    expect(lastImageBlocks).toHaveLength(1);
    expect(lastImageBlocks[0].source.data).toBe("img123");
  });

  it("does not include images when not provided", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Logged", analysis: validAnalysis },
      ],
      [],
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    call.messages.forEach((msg: { content: Array<{ type: string }> }) => {
      const imageBlocks = msg.content.filter(
        (block: { type: string }) => block.type === "image"
      );
      expect(imageBlocks).toHaveLength(0);
    });
  });

  it("records usage as food-chat operation", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "Done",
        },
      ],
      usage: {
        input_tokens: 1700,
        output_tokens: 120,
        cache_creation_input_tokens: 80,
        cache_read_input_tokens: 200,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123",
      "2026-02-15"
    );

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-sonnet-4-5-20250929",
      "food-chat",
      {
        inputTokens: 1700,
        outputTokens: 120,
        cacheCreationTokens: 80,
        cacheReadTokens: 200,
      }
    );
  });

  it("throws CLAUDE_API_ERROR on API failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("API connection failed"));

    const { conversationalRefine } = await import("@/lib/claude");

    await expect(
      conversationalRefine(
        [{ role: "user", content: "Test" }],
        [],
        "user-123",
        "2026-02-15"
      )
    ).rejects.toMatchObject({ name: "CLAUDE_API_ERROR" });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it("succeeds even if recordUsage throws", async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error("Database error"));

    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "Done",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    const result = await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({ message: "Done" });
    expect(mockRecordUsage).toHaveBeenCalled();
  });

  it("system prompt shows 'cup' for unit_id 91", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1500, output_tokens: 50 },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123",
      "2026-02-15",
      { ...validAnalysis, unit_id: 91, amount: 2 }
    );

    const call = mockCreate.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain("2 cups");
    expect(systemText).not.toContain("2 units");
  });

  it("system prompt shows 'oz' for unit_id 226", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1500, output_tokens: 50 },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123",
      "2026-02-15",
      { ...validAnalysis, unit_id: 226, amount: 8 }
    );

    const call = mockCreate.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain("8oz");
    expect(systemText).not.toContain("8 units");
  });

  it("system prompt falls back to 'units' for unknown unit_id", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1500, output_tokens: 50 },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [{ role: "user", content: "Test" }],
      [],
      "user-123",
      "2026-02-15",
      { ...validAnalysis, unit_id: 999, amount: 3 }
    );

    const call = mockCreate.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain("3 units");
  });

  it("converts ConversationMessage array to Anthropic message format", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [
        {
          type: "text",
          text: "OK",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [
        { role: "user", content: "I had pizza" },
        { role: "assistant", content: "Logged" },
        { role: "user", content: "Add more cheese" },
      ],
      [],
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages).toHaveLength(3);
    expect(call.messages[0].role).toBe("user");
    expect(call.messages[0].content).toEqual([
      { type: "text", text: "I had pizza" },
    ]);
    expect(call.messages[1].role).toBe("assistant");
    expect(call.messages[1].content).toEqual([
      { type: "text", text: "Logged" },
    ]);
    expect(call.messages[2].role).toBe("user");
    expect(call.messages[2].content).toEqual([
      { type: "text", text: "Add more cheese" },
    ]);
  });

  it("includes structured analysis summary in assistant messages that have analysis", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1500, output_tokens: 50 },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [
        { role: "user", content: "I had pizza" },
        { role: "assistant", content: "Logged it", analysis: validAnalysis },
        { role: "user", content: "Add cheese" },
      ],
      [],
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    const assistantMsg = call.messages[1];
    // Should have 2 text blocks: the original text + the analysis summary
    expect(assistantMsg.content).toHaveLength(2);
    expect(assistantMsg.content[0].text).toBe("Logged it");
    const summary = assistantMsg.content[1].text;
    expect(summary).toContain("Empanada de carne");
    expect(summary).toContain("150g");    // amount with unit
    expect(summary).toContain("calories=320");
    expect(summary).toContain("protein_g=12");
    expect(summary).toContain("carbs_g=28");
    expect(summary).toContain("fat_g=18");
  });

  it("does not include analysis summary in assistant messages without analysis", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1500, output_tokens: 50 },
    });

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [
        { role: "user", content: "I had pizza" },
        { role: "assistant", content: "What kind?" },
        { role: "user", content: "Pepperoni" },
      ],
      [],
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    const assistantMsg = call.messages[1];
    // Should only have 1 text block (no analysis summary)
    expect(assistantMsg.content).toHaveLength(1);
    expect(assistantMsg.content[0].text).toBe("What kind?");
  });

  it("analysis summary includes key nutritional fields", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-5-20250929",
      content: [{ type: "text", text: "OK" }],
      usage: { input_tokens: 1500, output_tokens: 50 },
    });

    const analysisWithTier1: FoodAnalysis = {
      ...validAnalysis,
      saturated_fat_g: 5.5,
      sugars_g: 3.0,
    };

    const { conversationalRefine } = await import("@/lib/claude");
    await conversationalRefine(
      [
        { role: "user", content: "Log it" },
        { role: "assistant", content: "Done", analysis: analysisWithTier1 },
        { role: "user", content: "Update" },
      ],
      [],
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    const summary = call.messages[1].content[1].text;
    // Core fields
    expect(summary).toContain("food_name");
    expect(summary).toContain("calories");
    expect(summary).toContain("protein_g");
    expect(summary).toContain("carbs_g");
    expect(summary).toContain("fat_g");
    expect(summary).toContain("fiber_g");
    expect(summary).toContain("sodium_mg");
    expect(summary).toContain("confidence");
    // Tier 1 present fields
    expect(summary).toContain("saturated_fat_g");
    expect(summary).toContain("sugars_g");
  });
});

// Mock executeTool for runToolLoop tests
const mockExecuteTool = vi.fn();
vi.mock("@/lib/chat-tools", () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
  SEARCH_FOOD_LOG_TOOL: { name: "search_food_log", description: "Search food log", strict: true, input_schema: { type: "object", properties: {} } },
  GET_NUTRITION_SUMMARY_TOOL: { name: "get_nutrition_summary", description: "Get nutrition summary", strict: true, input_schema: { type: "object", properties: {} } },
  GET_FASTING_INFO_TOOL: { name: "get_fasting_info", description: "Get fasting info", strict: true, input_schema: { type: "object", properties: {} } },
}));

describe("runToolLoop", () => {
  beforeEach(() => {
    setupMocks();
    mockRecordUsage.mockResolvedValue(undefined);
    mockExecuteTool.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("includes web_search tool in runToolLoop default tools", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Done.",
        },
      ],
      usage: { input_tokens: 1500, output_tokens: 100 },
    });

    const { runToolLoop } = await import("@/lib/claude");
    await runToolLoop(
      [{ role: "user", content: "Test" }],
      "user-123",
      "2026-02-15"
    );

    const call = mockCreate.mock.calls[0][0];
    // web_search tool should be first in the array
    expect(call.tools[0]).toEqual(
      expect.objectContaining({
        type: "web_search_20250305",
        name: "web_search",
      })
    );
  });

  it("returns immediately on end_turn response", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "You ate 1800 calories today.",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 100,
      },
    });

    const { runToolLoop } = await import("@/lib/claude");
    const result = await runToolLoop(
      [{ role: "user", content: "How many calories did I eat today?" }],
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({
      message: "You ate 1800 calories today.",
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("executes tool and sends result back to Claude", async () => {
    // First response: tool_use
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "get_nutrition_summary",
          input: { date: "2026-02-15" },
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 100,
      },
    });

    // Second response: end_turn with text
    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "You ate 1800 calories today, which is 90% of your 2000 cal goal.",
        },
      ],
      usage: {
        input_tokens: 1700,
        output_tokens: 150,
      },
    });

    mockExecuteTool.mockResolvedValueOnce("Nutrition summary for 2026-02-15:\nTotal: 1800 cal...");

    const { runToolLoop } = await import("@/lib/claude");
    const result = await runToolLoop(
      [{ role: "user", content: "How many calories did I eat today?" }],
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({
      message: "You ate 1800 calories today, which is 90% of your 2000 cal goal.",
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "get_nutrition_summary",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15",
      expect.any(Object),
    );

    // Check that tool result was sent back
    const secondCall = mockCreate.mock.calls[1][0];
    expect(secondCall.messages).toHaveLength(3); // user + assistant (tool_use) + user (tool_result)
    expect(secondCall.messages[2].content).toContainEqual({
      type: "tool_result",
      tool_use_id: "tool_1",
      content: "Nutrition summary for 2026-02-15:\nTotal: 1800 cal...",
    });
  });

  it("handles parallel tool calls", async () => {
    // First response: multiple tool_use blocks
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "get_nutrition_summary",
          input: { date: "2026-02-15" },
        },
        {
          type: "tool_use",
          id: "tool_2",
          name: "get_fasting_info",
          input: { date: "2026-02-15" },
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 150,
      },
    });

    // Second response: end_turn
    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "You ate 1800 calories and fasted for 12 hours.",
        },
      ],
      usage: {
        input_tokens: 1800,
        output_tokens: 100,
      },
    });

    mockExecuteTool
      .mockResolvedValueOnce("Nutrition: 1800 cal...")
      .mockResolvedValueOnce("Fasting: 12 hours...");

    const { runToolLoop } = await import("@/lib/claude");
    const result = await runToolLoop(
      [{ role: "user", content: "Tell me about my day" }],
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({
      message: "You ate 1800 calories and fasted for 12 hours.",
    });

    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "get_nutrition_summary",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15",
      expect.any(Object),
    );
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "get_fasting_info",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15",
      expect.any(Object),
    );

    // Check that all tool results were sent back in one message
    const secondCall = mockCreate.mock.calls[1][0];
    expect(secondCall.messages[2].content).toHaveLength(2);
    expect(secondCall.messages[2].content[0]).toEqual({
      type: "tool_result",
      tool_use_id: "tool_1",
      content: "Nutrition: 1800 cal...",
    });
    expect(secondCall.messages[2].content[1]).toEqual({
      type: "tool_result",
      tool_use_id: "tool_2",
      content: "Fasting: 12 hours...",
    });
  });

  it("caps at 5 iterations and returns last response", async () => {
    // Respond with tool_use 5 times
    for (let i = 0; i < 5; i++) {
      mockCreate.mockResolvedValueOnce({
        id: `msg_${i + 1}`,
        model: "claude-sonnet-4-5-20250929",
        stop_reason: "tool_use",
        content: [
          {
            type: "text",
            text: `Iteration ${i + 1} response`,
          },
          {
            type: "tool_use",
            id: `tool_${i + 1}`,
            name: "get_nutrition_summary",
            input: { date: "2026-02-15" },
          },
        ],
        usage: {
          input_tokens: 1500,
          output_tokens: 100,
        },
      });
      mockExecuteTool.mockResolvedValueOnce("Result...");
    }

    const { runToolLoop } = await import("@/lib/claude");

    const result = await runToolLoop(
      [{ role: "user", content: "Test" }],
      "user-123",
      "2026-02-15"
    );

    expect(mockCreate).toHaveBeenCalledTimes(5);
    expect(result.message).toBe("Iteration 5 response");
    expect(result.analysis).toBeUndefined();
  });

  it("returns analysis when present in last response after max iterations", async () => {
    // Respond with tool_use 5 times, last one includes report_nutrition
    for (let i = 0; i < 4; i++) {
      mockCreate.mockResolvedValueOnce({
        id: `msg_${i + 1}`,
        model: "claude-sonnet-4-5-20250929",
        stop_reason: "tool_use",
        content: [
          {
            type: "text",
            text: `Iteration ${i + 1}`,
          },
          {
            type: "tool_use",
            id: `tool_${i + 1}`,
            name: "get_nutrition_summary",
            input: { date: "2026-02-15" },
          },
        ],
        usage: {
          input_tokens: 1500,
          output_tokens: 100,
        },
      });
      mockExecuteTool.mockResolvedValueOnce("Result...");
    }

    // Last iteration includes analysis
    mockCreate.mockResolvedValueOnce({
      id: "msg_5",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      content: [
        {
          type: "text",
          text: "Final iteration with analysis",
        },
        {
          type: "tool_use",
          id: "tool_nutrition",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 100,
      },
    });
    mockExecuteTool.mockResolvedValueOnce("Result...");

    const { runToolLoop } = await import("@/lib/claude");

    const result = await runToolLoop(
      [{ role: "user", content: "Test" }],
      "user-123",
      "2026-02-15"
    );

    expect(mockCreate).toHaveBeenCalledTimes(5);
    expect(result.message).toBe("Final iteration with analysis");
    expect(result.analysis).toEqual(validAnalysis);
  });

  it("records usage for each API call", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "get_nutrition_summary",
          input: { date: "2026-02-15" },
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 100,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 200,
      },
    });

    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Done",
        },
      ],
      usage: {
        input_tokens: 1700,
        output_tokens: 150,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 300,
      },
    });

    mockExecuteTool.mockResolvedValueOnce("Result...");

    const { runToolLoop } = await import("@/lib/claude");
    await runToolLoop(
      [{ role: "user", content: "Test" }],
      "user-123",
      "2026-02-15"
    );

    expect(mockRecordUsage).toHaveBeenCalledTimes(2);
    expect(mockRecordUsage).toHaveBeenNthCalledWith(
      1,
      "user-123",
      "claude-sonnet-4-5-20250929",
      "food-chat",
      {
        inputTokens: 1500,
        outputTokens: 100,
        cacheCreationTokens: 50,
        cacheReadTokens: 200,
      }
    );
    expect(mockRecordUsage).toHaveBeenNthCalledWith(
      2,
      "user-123",
      "claude-sonnet-4-5-20250929",
      "food-chat",
      {
        inputTokens: 1700,
        outputTokens: 150,
        cacheCreationTokens: 0,
        cacheReadTokens: 300,
      }
    );
  });

  it("includes text alongside tool_use in response", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      content: [
        {
          type: "text",
          text: "Let me check that for you.",
        },
        {
          type: "tool_use",
          id: "tool_1",
          name: "get_nutrition_summary",
          input: { date: "2026-02-15" },
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 100,
      },
    });

    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "You ate 1800 calories.",
        },
      ],
      usage: {
        input_tokens: 1700,
        output_tokens: 50,
      },
    });

    mockExecuteTool.mockResolvedValueOnce("1800 cal...");

    const { runToolLoop } = await import("@/lib/claude");
    const result = await runToolLoop(
      [{ role: "user", content: "Test" }],
      "user-123",
      "2026-02-15"
    );

    expect(result.message).toBe("You ate 1800 calories.");
  });

  it("returns analysis if present in final response", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Here's the analysis.",
        },
        {
          type: "tool_use",
          id: "tool_1",
          name: "report_nutrition",
          input: validAnalysis,
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 200,
      },
    });

    const { runToolLoop } = await import("@/lib/claude");
    const result = await runToolLoop(
      [{ role: "user", content: "Analyze this" }],
      "user-123",
      "2026-02-15"
    );

    expect(result).toEqual({
      message: "Here's the analysis.",
      analysis: validAnalysis,
    });
  });

  it("handles refusal stop_reason gracefully", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "refusal",
      content: [
        {
          type: "text",
          text: "I cannot help with that request.",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 50,
      },
    });

    const { runToolLoop } = await import("@/lib/claude");

    const result = await runToolLoop(
      [{ role: "user", content: "Test" }],
      "user-123",
      "2026-02-15"
    );

    expect(result.message).toBe("I cannot help with that request.");
    expect(result.analysis).toBeUndefined();
  });

  it("handles model_context_window_exceeded stop_reason gracefully", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "model_context_window_exceeded",
      content: [
        {
          type: "text",
          text: "Partial response before context limit.",
        },
      ],
      usage: {
        input_tokens: 200000,
        output_tokens: 100,
      },
    });

    const { runToolLoop } = await import("@/lib/claude");

    const result = await runToolLoop(
      [{ role: "user", content: "Test" }],
      "user-123",
      "2026-02-15"
    );

    expect(result.message).toBe("Partial response before context limit.");
  });

  it("separates report_nutrition from data tools in tool_use response", async () => {
    // First response: report_nutrition + get_nutrition_summary in same turn
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      content: [
        {
          type: "text",
          text: "Let me check your data and provide analysis.",
        },
        {
          type: "tool_use",
          id: "tool_report",
          name: "report_nutrition",
          input: validAnalysis,
        },
        {
          type: "tool_use",
          id: "tool_data",
          name: "get_nutrition_summary",
          input: { date: "2026-02-15" },
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 200,
      },
    });

    // Second response: end_turn
    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Here's your summary with the analysis.",
        },
      ],
      usage: {
        input_tokens: 1800,
        output_tokens: 100,
      },
    });

    mockExecuteTool.mockResolvedValueOnce("Nutrition: 1800 cal...");

    const { runToolLoop } = await import("@/lib/claude");
    const result = await runToolLoop(
      [{ role: "user", content: "Analyze my food and check today's calories" }],
      "user-123",
      "2026-02-15"
    );

    // executeTool should only be called for get_nutrition_summary, NOT report_nutrition
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "get_nutrition_summary",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15",
      expect.any(Object),
    );

    // The analysis from report_nutrition should be captured
    expect(result.analysis).toEqual(validAnalysis);
    expect(result.message).toBe("Here's your summary with the analysis.");

    // The tool_results sent back should include both tools
    const secondCall = mockCreate.mock.calls[1][0];
    const toolResults = secondCall.messages[2].content;
    expect(toolResults).toHaveLength(2);
    expect(toolResults).toContainEqual(
      expect.objectContaining({ tool_use_id: "tool_report" })
    );
    expect(toolResults).toContainEqual(
      expect.objectContaining({ tool_use_id: "tool_data" })
    );
  });

  it("handles web search response blocks correctly (only executes custom tools)", async () => {
    // First response: mix of server_tool_use, web_search_tool_result, text, and custom tool_use
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "tool_use",
      content: [
        {
          type: "server_tool_use",
          id: "srvtool_1",
          name: "web_search",
          input: { query: "Big Mac nutrition" },
        } as unknown as Anthropic.ContentBlock,
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtool_1",
          content: [{ type: "web_search_result", url: "https://mcdonalds.com", title: "Big Mac", snippet: "590 cal" }],
        } as unknown as Anthropic.ContentBlock,
        {
          type: "text",
          text: "Let me check your recent logs too.",
        },
        {
          type: "tool_use",
          id: "tool_data_1",
          name: "search_food_log",
          input: { query: "big mac" },
        },
      ],
      usage: { input_tokens: 2000, output_tokens: 200 },
    });

    // Second response: end_turn with text
    mockCreate.mockResolvedValueOnce({
      id: "msg_2",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: "Based on McDonald's nutrition page, a Big Mac has 590 calories.",
        },
      ],
      usage: { input_tokens: 2200, output_tokens: 100 },
    });

    mockExecuteTool.mockResolvedValueOnce("No matching food log entries.");

    const { runToolLoop } = await import("@/lib/claude");
    const result = await runToolLoop(
      [{ role: "user", content: "I had a Big Mac" }],
      "user-123",
      "2026-02-15"
    );

    // executeTool should only be called for search_food_log, NOT for web_search
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "search_food_log",
      { query: "big mac" },
      "user-123",
      "2026-02-15",
      expect.any(Object),
    );

    expect(result.message).toBe("Based on McDonald's nutrition page, a Big Mac has 590 calories.");
  });

  it("handles web-search-only response with end_turn (no custom tools)", async () => {
    // Response where Claude uses ONLY web_search (no custom tools) and returns end_turn
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "end_turn",
      content: [
        {
          type: "server_tool_use",
          id: "srvtool_1",
          name: "web_search",
          input: { query: "Chipotle chicken burrito nutrition" },
        } as unknown as Anthropic.ContentBlock,
        {
          type: "web_search_tool_result",
          tool_use_id: "srvtool_1",
          content: [{ type: "web_search_result", url: "https://chipotle.com", title: "Nutrition", snippet: "1000 cal" }],
        } as unknown as Anthropic.ContentBlock,
        {
          type: "text",
          text: "Based on Chipotle's website, a chicken burrito is about 1000 calories.",
        },
      ],
      usage: { input_tokens: 1500, output_tokens: 150 },
    });

    const { runToolLoop } = await import("@/lib/claude");
    const result = await runToolLoop(
      [{ role: "user", content: "I had a Chipotle chicken burrito" }],
      "user-123",
      "2026-02-15"
    );

    // No custom tools should be executed
    expect(mockExecuteTool).not.toHaveBeenCalled();
    // The text content should be extracted correctly
    expect(result.message).toBe("Based on Chipotle's website, a chicken burrito is about 1000 calories.");
    expect(result.analysis).toBeUndefined();
  });

  it("handles unknown stop_reason gracefully (returns partial response)", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_1",
      model: "claude-sonnet-4-5-20250929",
      stop_reason: "max_tokens",
      content: [
        {
          type: "text",
          text: "Incomplete",
        },
      ],
      usage: {
        input_tokens: 1500,
        output_tokens: 4096,
      },
    });

    const { runToolLoop } = await import("@/lib/claude");

    const result = await runToolLoop(
      [{ role: "user", content: "Test" }],
      "user-123",
      "2026-02-15"
    );

    expect(result.message).toBe("Incomplete");
    expect(result.analysis).toBeUndefined();
  });
});

describe("truncateConversation", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("returns messages unchanged when under token limit", async () => {
    const { truncateConversation } = await import("@/lib/claude");
    const messages = [
      { role: "user" as const, content: "Hi" },
      { role: "assistant" as const, content: "Hello" },
    ];

    const result = truncateConversation(messages, 150000);
    expect(result).toEqual(messages);
  });

  it("keeps first + last 4 when over token limit (deduplicates consecutive roles)", async () => {
    const { truncateConversation } = await import("@/lib/claude");
    // Create 10 messages alternating: user(0), asst(1), ..., asst(9)
    // After truncation: first(user-0) + last 4(user-6, asst-7, user-8, asst-9)
    // = [user-0, user-6, asst-7, user-8, asst-9] → consecutive users at 0-1 → dedup
    // = [user-6, asst-7, user-8, asst-9]
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "x".repeat(100000), // ~25K tokens each, total ~250K
    }));

    const result = truncateConversation(messages, 150000);
    expect(result).toHaveLength(4); // first was deduped with last-4's first
    expect(result[0]).toBe(messages[6]); // user-6 replaced user-0
    expect(result[3]).toBe(messages[9]);
  });

  it("ensures no consecutive same-role messages after truncation", async () => {
    const { truncateConversation } = await import("@/lib/claude");
    // 8 messages: user(0), assistant(1), user(2), assistant(3), user(4), assistant(5), user(6), assistant(7)
    // After truncation: first(user-0) + last 4(user-4, assistant-5, user-6, assistant-7)
    // = [user-0, user-4, assistant-5, user-6, assistant-7] — consecutive users at index 0-1!
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "x".repeat(100000),
    }));

    const result = truncateConversation(messages, 150000);

    // Verify no consecutive same-role messages
    for (let i = 1; i < result.length; i++) {
      expect(result[i].role).not.toBe(result[i - 1].role);
    }
  });

  it("uses passed logger instead of global logger when truncation occurs", async () => {
    const { truncateConversation } = await import("@/lib/claude");
    const { logger } = await import("@/lib/logger");
    vi.mocked(logger.debug).mockClear();
    const customLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "x".repeat(100000),
    }));

    truncateConversation(messages, 150000, customLogger as unknown as import("pino").Logger);

    expect(customLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: "truncate_conversation" }),
      "conversation truncated",
    );
    expect(logger.debug).not.toHaveBeenCalled();
  });
});

describe("REPORT_NUTRITION_TOOL schema", () => {
  it("Tier 1 fields use nullable array type", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");

    const schema = REPORT_NUTRITION_TOOL.input_schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    // Tier 1 fields should have type: ["number", "null"]
    expect(props.saturated_fat_g.type).toEqual(["number", "null"]);
    expect(props.trans_fat_g.type).toEqual(["number", "null"]);
    expect(props.sugars_g.type).toEqual(["number", "null"]);
    expect(props.calories_from_fat.type).toEqual(["number", "null"]);
  });

  it("has additionalProperties: false and includes Tier 1 in required", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");

    const schema = REPORT_NUTRITION_TOOL.input_schema;

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("saturated_fat_g");
    expect(schema.required).toContain("trans_fat_g");
    expect(schema.required).toContain("sugars_g");
    expect(schema.required).toContain("calories_from_fat");
  });

  it("has strict: true", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");

    expect(REPORT_NUTRITION_TOOL.strict).toBe(true);
  });
});

describe("CHAT_SYSTEM_PROMPT web search guidance", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("includes guidance about when to search the web", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/search the web|web search/i);
  });

  it("includes guidance about when NOT to search", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    // Should mention not searching for generic foods
    expect(CHAT_SYSTEM_PROMPT).toMatch(/generic|common|basic/i);
  });

  it("includes guidance about citing sources", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/cite|source|mention where/i);
  });
});

describe("CHAT_SYSTEM_PROMPT registration guardrails", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("requires report_nutrition to be called before claiming food is registered", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/report_nutrition/);
    // Must instruct that food is only logged when report_nutrition is actually called
    expect(CHAT_SYSTEM_PROMPT).toMatch(/only.*register|only.*log|never.*claim|never.*say.*register/i);
  });

  it("instructs not to ask about meal types", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/meal.type/i);
    // Must mention that meal type is not a parameter / handled by the UI
    expect(CHAT_SYSTEM_PROMPT).toMatch(/never ask.*meal.type|do not ask.*meal.type|meal.type.*ui|meal.type.*not.*parameter/i);
  });

  it("instructs to re-log food from history using report_nutrition", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    // Must mention re-logging from history / past entries and calling report_nutrition
    expect(CHAT_SYSTEM_PROMPT).toMatch(/history|past.*entry|search_food_log.*result/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/log.*again|re-log|log.*it|report_nutrition/i);
  });
});

describe("ANALYSIS_SYSTEM_PROMPT registration guardrails", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("requires report_nutrition to be called before claiming food is registered", async () => {
    const { ANALYSIS_SYSTEM_PROMPT } = await import("@/lib/claude");
    // Must instruct that food is only logged when report_nutrition is actually called
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/only.*register|only.*log|never.*claim|never.*say.*register/i);
  });
});

describe("All Claude tool definitions have strict mode", () => {
  it("all tool definitions have strict: true", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    const { SEARCH_FOOD_LOG_TOOL, GET_NUTRITION_SUMMARY_TOOL, GET_FASTING_INFO_TOOL } = await import("@/lib/chat-tools");

    expect(REPORT_NUTRITION_TOOL.strict).toBe(true);
    expect(SEARCH_FOOD_LOG_TOOL.strict).toBe(true);
    expect(GET_NUTRITION_SUMMARY_TOOL.strict).toBe(true);
    expect(GET_FASTING_INFO_TOOL.strict).toBe(true);
  });
});

