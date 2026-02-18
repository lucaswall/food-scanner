import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { FoodAnalysis } from "@/types";
import type { StreamEvent } from "@/lib/sse";

// --- Mock helpers ---

/**
 * Creates a mock Anthropic MessageStream.
 * The stream yields `rawEvents` via Symbol.asyncIterator, then `finalMessage()` returns `finalMsg`.
 */
function createMockStream(rawEvents: unknown[], finalMsg: Record<string, unknown>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of rawEvents) {
        yield event;
      }
    },
    finalMessage: vi.fn().mockResolvedValue(finalMsg),
  };
}

/** Creates a mock stream for a simple text response (end_turn, no tool calls). */
function makeTextStream(
  text: string,
  usage: { input_tokens: number; output_tokens: number } = { input_tokens: 100, output_tokens: 20 },
) {
  return createMockStream(
    [
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
      { type: "content_block_stop", index: 0 },
      { type: "message_stop" },
    ],
    {
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  );
}

/** Creates a mock stream for a report_nutrition tool_use response. */
function makeReportNutritionStream(
  analysis: FoodAnalysis,
  usage: { input_tokens: number; output_tokens: number } = { input_tokens: 1500, output_tokens: 300 },
) {
  return createMockStream(
    [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_rpt", name: "report_nutrition", input: {} } },
      { type: "content_block_stop", index: 0 },
      { type: "message_stop" },
    ],
    {
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tool_rpt", name: "report_nutrition", input: analysis }],
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  );
}

/** Creates a mock stream for a data tool_use response (e.g. search_food_log). */
function makeDataToolStream(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolId: string = "tool_data",
  textBefore?: string,
  usage: { input_tokens: number; output_tokens: number } = { input_tokens: 1500, output_tokens: 200 },
) {
  const rawEvents: unknown[] = [];
  let contentIdx = 0;

  if (textBefore) {
    rawEvents.push({ type: "content_block_start", index: contentIdx, content_block: { type: "text", text: "" } });
    rawEvents.push({ type: "content_block_delta", index: contentIdx, delta: { type: "text_delta", text: textBefore } });
    rawEvents.push({ type: "content_block_stop", index: contentIdx });
    contentIdx++;
  }

  rawEvents.push({ type: "content_block_start", index: contentIdx, content_block: { type: "tool_use", id: toolId, name: toolName, input: {} } });
  rawEvents.push({ type: "content_block_stop", index: contentIdx });
  rawEvents.push({ type: "message_stop" });

  const content: unknown[] = [];
  if (textBefore) content.push({ type: "text", text: textBefore });
  content.push({ type: "tool_use", id: toolId, name: toolName, input: toolInput });

  return createMockStream(rawEvents, {
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    content,
    usage: {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });
}

/** Collects all events from an AsyncGenerator into an array. */
async function collectEvents(gen: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Helper to collect events and expect a thrown error. */
async function collectEventsExpectThrow(gen: AsyncGenerator<StreamEvent>): Promise<{ events: StreamEvent[]; error: unknown }> {
  const events: StreamEvent[] = [];
  let error: unknown;
  try {
    for await (const event of gen) {
      events.push(event);
    }
  } catch (e) {
    error = e;
  }
  return { events, error };
}

// --- Mock setup ---

const mockStream = vi.fn();
const mockConstructorArgs = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      constructor(options: Record<string, unknown>) {
        mockConstructorArgs(options);
      }
      beta = {
        messages: {
          stream: mockStream,
        },
      };
    },
  };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  startTimer: () => () => 42,
}));

const mockRecordUsage = vi.fn();
vi.mock("@/lib/claude-usage", () => ({
  recordUsage: mockRecordUsage,
}));

const mockExecuteTool = vi.fn();
vi.mock("@/lib/chat-tools", () => ({
  executeTool: (...args: unknown[]) => mockExecuteTool(...args),
  SEARCH_FOOD_LOG_TOOL: {
    name: "search_food_log",
    description: "Search food log",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  GET_NUTRITION_SUMMARY_TOOL: {
    name: "get_nutrition_summary",
    description: "Get nutrition summary",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  GET_FASTING_INFO_TOOL: {
    name: "get_fasting_info",
    description: "Get fasting info",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [] },
  },
}));

vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");

// --- Fixtures ---

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
  mockStream.mockReset();
  mockRecordUsage.mockResolvedValue(undefined);
  mockExecuteTool.mockReset();
}

// =============================================================================
// Anthropic SDK configuration
// =============================================================================

describe("Anthropic SDK configuration", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("configures SDK timeout to 60s to accommodate web search latency", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "test-user", "2026-02-15"));

    expect(mockConstructorArgs).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 60000 })
    );
  });

  it("configures SDK with maxRetries", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "test-user", "2026-02-15"));

    expect(mockConstructorArgs).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 2 })
    );
  });
});

// =============================================================================
// analyzeFood — streaming generator
// =============================================================================

describe("analyzeFood", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  // --- Fast path: report_nutrition immediately ---

  it("fast path: yields analysis + done for report_nutrition response", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    );

    expect(events).toContainEqual({ type: "analysis", analysis: validAnalysis });
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("fast path: analysis event contains validated FoodAnalysis", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent).toBeDefined();
    expect(analysisEvent?.analysis.food_name).toBe("Empanada de carne");
    expect(analysisEvent?.analysis.calories).toBe(320);
    expect(analysisEvent?.analysis.amount).toBe(150);
    expect(analysisEvent?.analysis.unit_id).toBe(147);
  });

  it("fast path: records usage after analysis", async () => {
    mockStream.mockReturnValueOnce(
      makeReportNutritionStream(validAnalysis, { input_tokens: 1500, output_tokens: 300 })
    );

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-sonnet-4-6",
      "food-analysis",
      { inputTokens: 1500, outputTokens: 300, cacheCreationTokens: 0, cacheReadTokens: 0 }
    );
  });

  it("fast path: recordUsage is fire-and-forget (returns before usage resolves)", async () => {
    let recordUsageResolved = false;
    mockRecordUsage.mockImplementation(() => new Promise((resolve) => {
      setTimeout(() => { recordUsageResolved = true; resolve(undefined); }, 100);
    }));
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    expect(recordUsageResolved).toBe(false);
  });

  it("fast path: succeeds even if recordUsage throws", async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error("DB error"));
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    expect(events).toContainEqual({ type: "analysis", analysis: validAnalysis });
  });

  // --- Needs chat path ---

  it("needs_chat path: yields needs_chat + done for text-only response", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Let me check what you had yesterday..."));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(
      analyzeFood([], "same as yesterday", "user-123", "2026-02-15")
    );

    expect(events).toContainEqual({
      type: "needs_chat",
      message: "Let me check what you had yesterday...",
    });
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("needs_chat path: records usage", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("What would you like?", { input_tokens: 1500, output_tokens: 50 }));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-sonnet-4-6",
      "food-analysis",
      expect.objectContaining({ inputTokens: 1500, outputTokens: 50 })
    );
  });

  // --- Slow path: data tools ---

  it("slow path: yields tool_start and eventually analysis when data tools used", async () => {
    // First stream: Claude calls search_food_log
    mockStream.mockReturnValueOnce(
      makeDataToolStream("search_food_log", { query: "yesterday" }, "tool_1")
    );
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");

    // Second stream: Claude returns report_nutrition in end_turn (runToolLoop stops here)
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [
            { type: "tool_use", id: "tool_rpt", name: "report_nutrition", input: { ...validAnalysis, calories: 160, amount: 75 } },
          ],
          usage: { input_tokens: 2000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(
      analyzeFood([], "same as yesterday but half", "user-123", "2026-02-15")
    );

    expect(events).toContainEqual({ type: "tool_start", tool: "search_food_log" });
    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent).toBeDefined();
    expect(analysisEvent?.analysis.calories).toBe(160);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("slow path: executes data tool with correct args", async () => {
    mockStream.mockReturnValueOnce(
      makeDataToolStream("search_food_log", { query: "yesterday" }, "tool_1")
    );
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");
    mockStream.mockReturnValueOnce(makeTextStream("Based on your log..."));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], "same as yesterday", "user-123", "2026-02-15"));

    expect(mockExecuteTool).toHaveBeenCalledWith(
      "search_food_log",
      { query: "yesterday" },
      "user-123",
      "2026-02-15",
      expect.any(Object),
    );
  });

  it("slow path: yields needs_chat when tool loop ends with text only (no analysis)", async () => {
    // First stream: Claude calls search_food_log (data tool)
    mockStream.mockReturnValueOnce(
      makeDataToolStream("search_food_log", { query: "milanesa" }, "tool_1", "Let me check your history...")
    );
    mockExecuteTool.mockResolvedValueOnce("Found: Milanesa grande — 300g, 550 cal; Milanesa chica — 150g, 280 cal");

    // Second stream: Claude responds with text only (no report_nutrition) — asks clarifying question
    mockStream.mockReturnValueOnce(
      makeTextStream("I found both sizes. Which do you want?")
    );

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(
      analyzeFood([], "milanesa como ayer", "user-123", "2026-02-15")
    );

    // Should emit needs_chat with accumulated text from the tool loop's text-only response
    expect(events).toContainEqual({
      type: "needs_chat",
      message: "I found both sizes. Which do you want?",
    });
    expect(events[events.length - 1]).toEqual({ type: "done" });
    // Should NOT contain an analysis event
    expect(events.find((e) => e.type === "analysis")).toBeUndefined();
  });

  it("slow path: needs_chat only contains final text, not intermediate thinking from earlier iterations", async () => {
    // First stream: Claude calls search_food_log with thinking text
    mockStream.mockReturnValueOnce(
      makeDataToolStream("search_food_log", { query: "milanesa" }, "tool_1", "Let me check your history...")
    );
    mockExecuteTool.mockResolvedValueOnce("Found: Milanesa grande — 300g, 550 cal; Milanesa chica — 150g, 280 cal");

    // Second stream: Claude calls another data tool with more thinking text
    mockStream.mockReturnValueOnce(
      makeDataToolStream("get_nutrition_summary", { date: "2026-02-14" }, "tool_2", "Let me also check yesterday's totals...")
    );
    mockExecuteTool.mockResolvedValueOnce("Total yesterday: 2100 cal");

    // Third stream: Claude responds with text only (no report_nutrition)
    mockStream.mockReturnValueOnce(
      makeTextStream("Which size milanesa did you have?")
    );

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(
      analyzeFood([], "milanesa como ayer", "user-123", "2026-02-15")
    );

    // needs_chat should ONLY contain the final text, not intermediate thinking
    const needsChatEvent = events.find((e) => e.type === "needs_chat");
    expect(needsChatEvent).toBeDefined();
    expect((needsChatEvent as { type: "needs_chat"; message: string }).message).toBe(
      "Which size milanesa did you have?"
    );
    // Must NOT contain intermediate thinking text
    expect((needsChatEvent as { type: "needs_chat"; message: string }).message).not.toContain(
      "Let me check"
    );
  });

  // --- Validation errors ---

  it("throws CLAUDE_API_ERROR when report_nutrition has missing fields", async () => {
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_nutrition", input: { food_name: "Test" } }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const { error } = await collectEventsExpectThrow(
      analyzeFood([], undefined, "user-123", "2026-02-15")
    );

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws CLAUDE_API_ERROR when calories is a string", async () => {
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_nutrition", input: { ...validAnalysis, calories: "320" } }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const { error } = await collectEventsExpectThrow(
      analyzeFood([], undefined, "user-123", "2026-02-15")
    );

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws CLAUDE_API_ERROR when confidence is invalid", async () => {
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_nutrition", input: { ...validAnalysis, confidence: "very_high" } }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const { error } = await collectEventsExpectThrow(
      analyzeFood([], undefined, "user-123", "2026-02-15")
    );

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws CLAUDE_API_ERROR when keywords is not an array", async () => {
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_nutrition", input: { ...validAnalysis, keywords: "empanada" } }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const { error } = await collectEventsExpectThrow(
      analyzeFood([], undefined, "user-123", "2026-02-15")
    );

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  it("throws CLAUDE_API_ERROR on API failure", async () => {
    mockStream.mockImplementationOnce(() => {
      throw new Error("API connection failed");
    });

    const { analyzeFood } = await import("@/lib/claude");
    const { error } = await collectEventsExpectThrow(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    );

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  // --- Keyword normalization ---

  it("normalizes multi-word keywords by replacing spaces with hyphens", async () => {
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_nutrition", input: { ...validAnalysis, keywords: ["cerveza", "sin alcohol", "clausthaler"] } }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis.keywords).toEqual(["cerveza", "sin-alcohol", "clausthaler"]);
  });

  it("deduplicates keywords after normalization", async () => {
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_nutrition", input: { ...validAnalysis, keywords: ["cerveza", "cerveza", "sin-alcohol"] } }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis.keywords).toEqual(["cerveza", "sin-alcohol"]);
  });

  it("caps keywords at 5", async () => {
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_nutrition", input: { ...validAnalysis, keywords: ["a", "b", "c", "d", "e", "f", "g"] } }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis.keywords).toHaveLength(5);
  });

  // --- API call arguments ---

  it("passes all 5 tools to Claude with tool_choice auto", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([{ base64: "img", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
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
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain("2026-02-15");
  });

  it("uses default text when no description provided", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([{ base64: "img", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.messages[0].content).toContainEqual(
      expect.objectContaining({ type: "text", text: "Analyze this food." })
    );
  });

  it("passes images as base64 blocks", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood(
      [
        { base64: "img1", mimeType: "image/jpeg" },
        { base64: "img2", mimeType: "image/png" },
      ],
      undefined,
      "user-123",
      "2026-02-15"
    ));

    const call = mockStream.mock.calls[0][0];
    const imageBlocks = call.messages[0].content.filter((b: { type: string }) => b.type === "image");
    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[0].source.data).toBe("img1");
    expect(imageBlocks[1].source.data).toBe("img2");
  });

  it("text-only request: no image blocks, description as sole text block", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], "2 medialunas y un cortado", "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    const content = call.messages[0].content;
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: "text", text: "2 medialunas y un cortado" });
  });

  it("includes web_search tool as first tool", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.tools[0]).toEqual(
      expect.objectContaining({ type: "web_search_20260209", name: "web_search" })
    );
  });

  it("uses max_tokens 1024 for initial call", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(validAnalysis));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.max_tokens).toBe(1024);
  });

  // --- Tier 1 nutrients ---

  it("accepts Tier 1 nutrients as numbers", async () => {
    const withTier1 = { ...validAnalysis, saturated_fat_g: 5.5, trans_fat_g: 0.2, sugars_g: 3.0, calories_from_fat: 162 };
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_nutrition", input: withTier1 }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis.saturated_fat_g).toBe(5.5);
    expect(analysisEvent?.analysis.trans_fat_g).toBe(0.2);
    expect(analysisEvent?.analysis.sugars_g).toBe(3.0);
    expect(analysisEvent?.analysis.calories_from_fat).toBe(162);
  });

  it("accepts Tier 1 nutrients as null", async () => {
    const withNullTier1 = { ...validAnalysis, saturated_fat_g: null, trans_fat_g: null, sugars_g: null, calories_from_fat: null };
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_nutrition", input: withNullTier1 }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis.saturated_fat_g).toBeNull();
    expect(analysisEvent?.analysis.trans_fat_g).toBeNull();
    expect(analysisEvent?.analysis.sugars_g).toBeNull();
    expect(analysisEvent?.analysis.calories_from_fat).toBeNull();
  });

  it("throws on negative saturated_fat_g", async () => {
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "report_nutrition", input: { ...validAnalysis, saturated_fat_g: -1 } }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const { error } = await collectEventsExpectThrow(analyzeFood([], undefined, "user-123", "2026-02-15"));
    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
  });

  // --- AbortSignal ---

  it("throws CLAUDE_API_ERROR when stream throws AbortError", async () => {
    const controller = new AbortController();
    controller.abort();

    // Mock stream that throws when iterated (simulating abort during data tool path)
    mockStream.mockReturnValueOnce(
      makeDataToolStream("search_food_log", { query: "yesterday" })
    );
    mockExecuteTool.mockResolvedValueOnce("some result");
    mockStream.mockReturnValueOnce(createMockStream([], {
      model: "claude-sonnet-4-6",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "" }],
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }));

    const { analyzeFood } = await import("@/lib/claude");
    // Aborted signal passed — runToolLoop detects abort and yields error event
    const gen = analyzeFood([], "test", "user-123", "2026-02-15", undefined, controller.signal);
    const { events } = await collectEventsExpectThrow(gen);
    // The initial mock stream succeeds (mock doesn't check signal), then runToolLoop
    // checks signal.aborted at loop start and yields an error event
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { type: "error"; message: string }).message).toBe("Request aborted by client");
  });
});

// =============================================================================
// runToolLoop — streaming generator
// =============================================================================

describe("runToolLoop", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("simple end_turn: yields text_delta + usage + done", async () => {
    mockStream.mockReturnValueOnce(
      makeTextStream("You ate 1800 calories today.", { input_tokens: 1500, output_tokens: 100 })
    );

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop(
        [{ role: "user", content: "How many calories did I eat today?" }],
        "user-123",
        "2026-02-15"
      )
    );

    expect(events).toContainEqual({ type: "text_delta", text: "You ate 1800 calories today." });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "usage" })
    );
    expect(events[events.length - 1]).toEqual({ type: "done" });
    expect(mockStream).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it("end_turn: text_delta events arrive before done", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Hello world."));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop([{ role: "user", content: "Hi" }], "user-123", "2026-02-15")
    );

    const textIdx = events.findIndex((e) => e.type === "text_delta");
    const doneIdx = events.findIndex((e) => e.type === "done");
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(textIdx);
  });

  it("tool_use: yields tool_start + executes tool + continues loop", async () => {
    mockStream.mockReturnValueOnce(
      makeDataToolStream("get_nutrition_summary", { date: "2026-02-15" }, "tool_1")
    );
    mockExecuteTool.mockResolvedValueOnce("Nutrition: 1800 cal...");
    mockStream.mockReturnValueOnce(makeTextStream("You ate 1800 calories today."));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop(
        [{ role: "user", content: "How many calories did I eat today?" }],
        "user-123",
        "2026-02-15"
      )
    );

    expect(events).toContainEqual({ type: "tool_start", tool: "get_nutrition_summary" });
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "get_nutrition_summary",
      { date: "2026-02-15" },
      "user-123",
      "2026-02-15",
      expect.any(Object),
    );
    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("tool_use: sends tool result back to Claude in next API call", async () => {
    mockStream.mockReturnValueOnce(
      makeDataToolStream("get_nutrition_summary", { date: "2026-02-15" }, "tool_1")
    );
    mockExecuteTool.mockResolvedValueOnce("Nutrition: 1800 cal...");
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    const secondCall = mockStream.mock.calls[1][0];
    // messages: user, assistant (tool_use), user (tool_result)
    expect(secondCall.messages).toHaveLength(3);
    expect(secondCall.messages[2].content).toContainEqual({
      type: "tool_result",
      tool_use_id: "tool_1",
      content: "Nutrition: 1800 cal...",
    });
  });

  it("tool_use: handles parallel tool calls", async () => {
    // First stream: two tool calls
    const rawEvents = [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "get_nutrition_summary", input: {} } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t2", name: "get_fasting_info", input: {} } },
      { type: "content_block_stop", index: 1 },
      { type: "message_stop" },
    ];
    mockStream.mockReturnValueOnce(createMockStream(rawEvents, {
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t1", name: "get_nutrition_summary", input: { date: "2026-02-15" } },
        { type: "tool_use", id: "t2", name: "get_fasting_info", input: { date: "2026-02-15" } },
      ],
      usage: { input_tokens: 1500, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }));
    mockExecuteTool.mockResolvedValueOnce("Nutrition: 1800 cal...").mockResolvedValueOnce("Fasting: 12 hrs...");
    mockStream.mockReturnValueOnce(makeTextStream("Here's your summary."));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop([{ role: "user", content: "Tell me about my day" }], "user-123", "2026-02-15")
    );

    expect(events).toContainEqual({ type: "tool_start", tool: "get_nutrition_summary" });
    expect(events).toContainEqual({ type: "tool_start", tool: "get_fasting_info" });
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("report_nutrition in tool_use: yields analysis event", async () => {
    // First stream: report_nutrition + data tool
    const rawEvents = [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t_report", name: "report_nutrition", input: {} } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t_data", name: "get_nutrition_summary", input: {} } },
      { type: "content_block_stop", index: 1 },
      { type: "message_stop" },
    ];
    mockStream.mockReturnValueOnce(createMockStream(rawEvents, {
      model: "claude-sonnet-4-6",
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t_report", name: "report_nutrition", input: validAnalysis },
        { type: "tool_use", id: "t_data", name: "get_nutrition_summary", input: { date: "2026-02-15" } },
      ],
      usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }));
    mockExecuteTool.mockResolvedValueOnce("Nutrition: 1800 cal...");
    mockStream.mockReturnValueOnce(makeTextStream("Here's your analysis with summary."));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop([{ role: "user", content: "Analyze and summarize" }], "user-123", "2026-02-15")
    );

    // Should NOT execute report_nutrition as a tool
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "get_nutrition_summary",
      expect.any(Object),
      expect.any(String),
      expect.any(String),
      expect.any(Object),
    );

    // Analysis should be yielded
    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis).toEqual(validAnalysis);
  });

  it("max iterations exceeded: yields error event", async () => {
    // Return tool_use responses 5 times to exhaust the limit
    for (let i = 0; i < 5; i++) {
      mockStream.mockReturnValueOnce(
        makeDataToolStream("get_nutrition_summary", { date: "2026-02-15" }, `tool_${i}`)
      );
      mockExecuteTool.mockResolvedValueOnce("Result...");
    }

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent).toMatchObject({ type: "error" });
    expect(mockStream).toHaveBeenCalledTimes(5);
  });

  it("records usage for each API call", async () => {
    mockStream.mockReturnValueOnce(
      makeDataToolStream("get_nutrition_summary", { date: "2026-02-15" }, "tool_1", undefined, { input_tokens: 1500, output_tokens: 100 })
    );
    mockExecuteTool.mockResolvedValueOnce("Result...");
    mockStream.mockReturnValueOnce(
      createMockStream([{ type: "message_stop" }], {
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Done." }],
        usage: { input_tokens: 1700, output_tokens: 150, cache_creation_input_tokens: 50, cache_read_input_tokens: 200 },
      })
    );

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    expect(mockRecordUsage).toHaveBeenCalledTimes(2);
    expect(mockRecordUsage).toHaveBeenNthCalledWith(
      1,
      "user-123",
      "claude-sonnet-4-6",
      "food-chat",
      { inputTokens: 1500, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0 },
    );
    expect(mockRecordUsage).toHaveBeenNthCalledWith(
      2,
      "user-123",
      "claude-sonnet-4-6",
      "food-chat",
      { inputTokens: 1700, outputTokens: 150, cacheCreationTokens: 50, cacheReadTokens: 200 },
    );
  });

  it("uses CHAT_SYSTEM_PROMPT by default", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { runToolLoop, CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    await collectEvents(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain(CHAT_SYSTEM_PROMPT);
  });

  it("includes web_search tool by default", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    const call = mockStream.mock.calls[0][0];
    expect(call.tools[0]).toEqual(
      expect.objectContaining({ type: "web_search_20260209", name: "web_search" })
    );
  });

  it("handles server_tool_use (web search) without calling executeTool", async () => {
    // Response with server_tool_use (web search) + data tool
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "Big Mac nutrition" } },
          { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
          { type: "tool_use", id: "t_data", name: "search_food_log", input: { query: "big mac" } },
        ],
        usage: { input_tokens: 2000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockExecuteTool.mockResolvedValueOnce("No matching entries.");
    mockStream.mockReturnValueOnce(makeTextStream("Based on McDonald's nutrition page, a Big Mac has 590 calories."));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop([{ role: "user", content: "I had a Big Mac" }], "user-123", "2026-02-15")
    );

    // executeTool only called for search_food_log, not web_search
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "search_food_log",
      { query: "big mac" },
      "user-123",
      "2026-02-15",
      expect.any(Object),
    );
    // web_search yields a tool_start event
    expect(events).toContainEqual({ type: "tool_start", tool: "web_search" });
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("pending analysis carried to next iteration when report_nutrition called during tool_use", async () => {
    // First stream: search_food_log
    mockStream.mockReturnValueOnce(
      makeDataToolStream("search_food_log", { query: "empanada" }, "tool_search")
    );
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");

    // Second stream: report_nutrition + end_turn (report_nutrition in end_turn block)
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "Here's the analysis." },
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: validAnalysis },
        ],
        usage: { input_tokens: 2000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop([{ role: "user", content: "Log empanada" }], "user-123", "2026-02-15")
    );

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis).toEqual(validAnalysis);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("yields error event when AbortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop(
        [{ role: "user", content: "Test" }],
        "user-123",
        "2026-02-15",
        { signal: controller.signal }
      )
    );

    expect(events).toContainEqual(expect.objectContaining({ type: "error" }));
  });

  it("uses custom operation for usage recording", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(
      runToolLoop(
        [{ role: "user", content: "Test" }],
        "user-123",
        "2026-02-15",
        { operation: "food-analysis" }
      )
    );

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-sonnet-4-6",
      "food-analysis",
      expect.any(Object),
    );
  });
});

// =============================================================================
// conversationalRefine — streaming generator
// =============================================================================

describe("conversationalRefine", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("yields analysis event when Claude calls report_nutrition", async () => {
    const updatedAnalysis = { ...validAnalysis, amount: 200 };
    mockStream.mockReturnValueOnce(createMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I've updated the portion size to 200g" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "I've updated the portion size to 200g" },
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: updatedAnalysis },
        ],
        usage: { input_tokens: 1800, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { conversationalRefine } = await import("@/lib/claude");
    const events = await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "I had an empanada" },
          { role: "assistant", content: "Got it", analysis: validAnalysis },
          { role: "user", content: "Actually it was 200g" },
        ],
        [],
        "user-123",
        "2026-02-15"
      )
    );

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis).toEqual(updatedAnalysis);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("yields text_delta but no analysis for text-only response", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Got it! Anything else you'd like to add?"));

    const { conversationalRefine } = await import("@/lib/claude");
    const events = await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Thanks!" },
        ],
        [],
        "user-123",
        "2026-02-15"
      )
    );

    expect(events).toContainEqual({ type: "text_delta", text: "Got it! Anything else you'd like to add?" });
    expect(events.find((e) => e.type === "analysis")).toBeUndefined();
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("delegates to runToolLoop when data tools are used", async () => {
    mockStream.mockReturnValueOnce(
      makeDataToolStream("search_food_log", { query: "yesterday" }, "tool_data")
    );
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");
    mockStream.mockReturnValueOnce(makeTextStream("Based on your log, you had an empanada yesterday."));

    const { conversationalRefine } = await import("@/lib/claude");
    const events = await collectEvents(
      conversationalRefine(
        [{ role: "user", content: "What did I have yesterday?" }],
        [],
        "user-123",
        "2026-02-15"
      )
    );

    expect(events).toContainEqual({ type: "tool_start", tool: "search_food_log" });
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("uses CHAT_SYSTEM_PROMPT", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine, CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine([{ role: "user", content: "Test" }], [], "user-123", "2026-02-15")
    );

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain(CHAT_SYSTEM_PROMPT);
  });

  it("includes initial analysis context in system prompt", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine(
        [{ role: "user", content: "Make it 2" }],
        [],
        "user-123",
        "2026-02-15",
        validAnalysis
      )
    );

    const call = mockStream.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain(validAnalysis.food_name);
    expect(systemText).toContain(String(validAnalysis.calories));
    expect(systemText).toContain("baseline");
  });

  it("includes current date in system prompt", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine(
        [{ role: "user", content: "What did I eat today?" }],
        [],
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain("Today's date is: 2026-02-15");
  });

  it("omits date from system prompt when currentDate not provided", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine([{ role: "user", content: "Hi" }], [], "user-123")
    );

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).not.toContain("Today's date is:");
  });

  it("uses max_tokens 2048", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine([{ role: "user", content: "Test" }], [], "user-123", "2026-02-15")
    );

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 2048 }),
      expect.anything(),
    );
  });

  it("attaches images to the last user message", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("I see the food"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Here's the photo" },
          { role: "assistant", content: "Got it" },
          { role: "user", content: "Can you update it?" },
        ],
        [{ base64: "img_data", mimeType: "image/jpeg" }],
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    const lastUserMsg = call.messages[call.messages.length - 1];
    // Verify last user message has image
    expect(lastUserMsg.role).toBe("user");
    const imageBlocks = lastUserMsg.content.filter((b: { type: string }) => b.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0].source.data).toBe("img_data");
  });

  it("records usage", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK", { input_tokens: 1800, output_tokens: 400 }));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine([{ role: "user", content: "Test" }], [], "user-123", "2026-02-15")
    );

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-sonnet-4-6",
      "food-chat",
      expect.objectContaining({ inputTokens: 1800, outputTokens: 400 })
    );
  });

  it("web_search tool is first in tools array", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine([{ role: "user", content: "Test" }], [], "user-123", "2026-02-15")
    );

    const call = mockStream.mock.calls[0][0];
    expect(call.tools[0]).toEqual(
      expect.objectContaining({ type: "web_search_20260209", name: "web_search" })
    );
  });
});

// =============================================================================
// truncateConversation — unchanged from existing tests
// =============================================================================

describe("truncateConversation", () => {
  afterEach(() => { vi.resetModules(); });

  it("returns messages unchanged when under token limit", async () => {
    const { truncateConversation } = await import("@/lib/claude");
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ];

    const result = truncateConversation(messages, 150000);
    expect(result).toEqual(messages);
  });

  it("keeps first + last 4 when over token limit (deduplicates consecutive roles)", async () => {
    const { truncateConversation } = await import("@/lib/claude");
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "x".repeat(100000),
    }));

    const result = truncateConversation(messages, 150000);
    expect(result).toHaveLength(4);
    expect(result[0]).toBe(messages[6]);
    expect(result[3]).toBe(messages[9]);
  });

  it("includes tool_use and tool_result blocks in token estimate", async () => {
    const { truncateConversation } = await import("@/lib/claude");
    // Build messages with tool_use and tool_result blocks that are large
    const toolInput = { query: "x".repeat(40000) }; // ~10K tokens at ~4 chars/token
    const toolResultContent = "y".repeat(40000); // ~10K tokens
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Short user message" },
      {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "search_food_log", input: toolInput },
        ] as Anthropic.ContentBlock[],
      },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: toolResultContent },
        ] as Anthropic.ToolResultBlockParam[],
      },
      { role: "assistant", content: "Short response" },
      { role: "user", content: "Follow up" },
      { role: "assistant", content: "Answer" },
    ];

    // With tool blocks properly counted (~20K+ tokens), this should trigger truncation at 15K limit
    const result = truncateConversation(messages, 15000);
    // If tool blocks are counted, 6 messages totaling ~20K+ tokens exceeds 15K → truncated
    expect(result.length).toBeLessThan(messages.length);
  });

  it("ensures no consecutive same-role messages after truncation", async () => {
    const { truncateConversation } = await import("@/lib/claude");
    const messages = Array.from({ length: 8 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: "x".repeat(100000),
    }));

    const result = truncateConversation(messages, 150000);

    for (let i = 1; i < result.length; i++) {
      expect(result[i].role).not.toBe(result[i - 1].role);
    }
  });
});

// =============================================================================
// REPORT_NUTRITION_TOOL schema — unchanged
// =============================================================================

describe("REPORT_NUTRITION_TOOL schema", () => {
  afterEach(() => { vi.resetModules(); });

  it("Tier 1 fields use nullable array type", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    const schema = REPORT_NUTRITION_TOOL.input_schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;

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

  it("includes keywords in tool schema required fields", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    expect(REPORT_NUTRITION_TOOL.input_schema.required).toContain("keywords");
  });
});

// =============================================================================
// CHAT_SYSTEM_PROMPT content tests — unchanged
// =============================================================================

describe("CHAT_SYSTEM_PROMPT web search guidance", () => {
  afterEach(() => { vi.resetModules(); });

  it("includes guidance about when to search the web", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/search the web|web search/i);
  });

  it("includes guidance about when NOT to search", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/generic|common|basic/i);
  });

  it("includes guidance about citing sources", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/cite|source|mention where/i);
  });
});

describe("CHAT_SYSTEM_PROMPT registration guardrails", () => {
  afterEach(() => { vi.resetModules(); });

  it("requires report_nutrition to be called before claiming food is registered", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/report_nutrition/);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/only.*register|only.*log|never.*claim|never.*say.*register/i);
  });

  it("instructs not to ask about meal types", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/meal.type/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/never ask.*meal.type|do not ask.*meal.type|meal.type.*ui|meal.type.*not.*parameter/i);
  });
});

describe("ANALYSIS_SYSTEM_PROMPT registration guardrails", () => {
  afterEach(() => { vi.resetModules(); });

  it("requires report_nutrition to be called before claiming food is registered", async () => {
    const { ANALYSIS_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/only.*register|only.*log|never.*claim|never.*say.*register/i);
  });
});

// =============================================================================
// Task 13: Thinking text instruction in system prompts
// =============================================================================

describe("CHAT_SYSTEM_PROMPT thinking instruction (Task 13)", () => {
  afterEach(() => { vi.resetModules(); });

  it("contains instruction to emit thinking text before tool calls", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    // Should instruct Claude to emit a brief sentence before tool calls
    expect(CHAT_SYSTEM_PROMPT).toMatch(/before calling any tool|before.*tool call/i);
  });

  it("emphasizes brevity — one short sentence", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/one short sentence|brief.*sentence|short sentence/i);
  });
});

describe("ANALYSIS_SYSTEM_PROMPT thinking instruction (Task 13)", () => {
  afterEach(() => { vi.resetModules(); });

  it("contains instruction to emit thinking text before tool calls", async () => {
    const { ANALYSIS_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/before calling any tool|before.*tool call/i);
  });

  it("emphasizes brevity — one short sentence", async () => {
    const { ANALYSIS_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/one short sentence|brief.*sentence|short sentence/i);
  });
});

describe("All Claude tool definitions have strict mode", () => {
  afterEach(() => { vi.resetModules(); });

  it("all tool definitions have strict: true", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    const { SEARCH_FOOD_LOG_TOOL, GET_NUTRITION_SUMMARY_TOOL, GET_FASTING_INFO_TOOL } = await import("@/lib/chat-tools");

    expect(REPORT_NUTRITION_TOOL.strict).toBe(true);
    expect(SEARCH_FOOD_LOG_TOOL.strict).toBe(true);
    expect(GET_NUTRITION_SUMMARY_TOOL.strict).toBe(true);
    expect(GET_FASTING_INFO_TOOL.strict).toBe(true);
  });
});
