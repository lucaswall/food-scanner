import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FoodAnalysis, FoodLogEntryDetail } from "@/types";
import type { StreamEvent } from "@/lib/sse";
import type { Logger } from "@/lib/logger";

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
    on: vi.fn().mockReturnThis(),
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
  analysis: Record<string, unknown>,
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
  class MockAPIError extends Error {
    status: number;
    error: unknown;
    constructor(status: number, message: string, error?: unknown) {
      super(message);
      this.name = "APIError";
      this.status = status;
      this.error = error;
    }
  }

  class MockAnthropic {
    static APIError = MockAPIError;
    constructor(options: Record<string, unknown>) {
      mockConstructorArgs(options);
    }
    messages = {
      stream: mockStream,
    };
    // Task 25: beta.messages.stream is the path used after A3 migration
    beta = {
      messages: {
        stream: mockStream,
      },
    };
  }

  return {
    default: MockAnthropic,
    APIError: MockAPIError,
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
  SEARCH_NUTRITION_LABELS_TOOL: {
    name: "search_nutrition_labels",
    description: "Search nutrition labels",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  SAVE_NUTRITION_LABEL_TOOL: {
    name: "save_nutrition_label",
    description: "Save nutrition label",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [] },
  },
  MANAGE_NUTRITION_LABEL_TOOL: {
    name: "manage_nutrition_label",
    description: "Manage nutrition label",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [] },
  },
}));

const mockBuildUserProfile = vi.fn();
vi.mock("@/lib/user-profile", () => ({
  buildUserProfile: (...args: unknown[]) => mockBuildUserProfile(...args),
}));

vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");

// --- Fixtures ---

/** Expected parsed FoodAnalysis result (no serving_unit — that is a tool-input field only). */
const validAnalysis: FoodAnalysis = {
  food_name: "Empanada de carne",
  amount: 150,
  unit_id: "g",
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

/** Raw tool input as Claude would output — uses serving_unit (string) field. */
const rawToolInput: Record<string, unknown> = { ...validAnalysis, serving_unit: "g" };

function setupMocks() {
  vi.clearAllMocks();
  mockStream.mockReset();
  mockRecordUsage.mockResolvedValue(undefined);
  mockExecuteTool.mockReset();
  mockBuildUserProfile.mockResolvedValue(null);
}

// =============================================================================
// Anthropic SDK configuration
// =============================================================================

describe("Anthropic SDK configuration", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("configures SDK timeout to 120s to accommodate web search latency", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "test-user", "2026-02-15"));

    expect(mockConstructorArgs).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 120000 })
    );
  });

  it("configures SDK with maxRetries", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "test-user", "2026-02-15"));

    expect(mockConstructorArgs).toHaveBeenCalledWith(
      expect.objectContaining({ maxRetries: 2 })
    );
  });

  it("CLAUDE_MODEL is set to a valid Claude model ID", async () => {
    const { CLAUDE_MODEL } = await import("@/lib/claude");
    expect(CLAUDE_MODEL).toMatch(/^claude-/);
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
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(
      analyzeFood([{ base64: "abc123", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15")
    );

    expect(events).toContainEqual({ type: "analysis", analysis: validAnalysis });
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("fast path: analysis event contains validated FoodAnalysis", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent).toBeDefined();
    expect(analysisEvent?.analysis.food_name).toBe("Empanada de carne");
    expect(analysisEvent?.analysis.calories).toBe(320);
    expect(analysisEvent?.analysis.amount).toBe(150);
    expect(analysisEvent?.analysis.unit_id).toBe("g");
  });

  it("fast path: records usage after analysis", async () => {
    mockStream.mockReturnValueOnce(
      makeReportNutritionStream(rawToolInput, { input_tokens: 1500, output_tokens: 300 })
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
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    expect(recordUsageResolved).toBe(false);
  });

  it("fast path: succeeds even if recordUsage throws", async () => {
    mockRecordUsage.mockRejectedValueOnce(new Error("DB error"));
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

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

  it("coerces invalid confidence to medium", async () => {
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
    const events = await collectEvents(
      analyzeFood([], undefined, "user-123", "2026-02-15")
    );

    const analysisEvent = events.find(e => e.type === "analysis");
    expect(analysisEvent).toBeDefined();
    expect((analysisEvent as { type: "analysis"; analysis: FoodAnalysis }).analysis.confidence).toBe("medium");
  });

  it("coerces string keywords to array", async () => {
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
    const events = await collectEvents(
      analyzeFood([], undefined, "user-123", "2026-02-15")
    );

    const analysisEvent = events.find(e => e.type === "analysis");
    expect(analysisEvent).toBeDefined();
    expect((analysisEvent as { type: "analysis"; analysis: FoodAnalysis }).analysis.keywords).toEqual(["empanada"]);
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

  // Task 2 (FOO-782): model_context_window_exceeded in initial analyzeFood call
  it("throws CLAUDE_API_ERROR when initial response is model_context_window_exceeded (FOO-782)", async () => {
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "model_context_window_exceeded",
        content: [],
        usage: { input_tokens: 200000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { analyzeFood } = await import("@/lib/claude");
    const { error } = await collectEventsExpectThrow(
      analyzeFood([], "same as yesterday", "user-123", "2026-02-15")
    );

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
    const err = error as { message: string };
    expect(err.message).toMatch(/too long|conversation/i);
  });

  // Fix 4 (FOO-792): refusal stop_reason in initial analyzeFood call
  it("throws CLAUDE_API_ERROR when initial response is refusal (FOO-792)", async () => {
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "refusal",
        content: [{ type: "text", text: "I cannot assist with that request." }],
        usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { analyzeFood } = await import("@/lib/claude");
    const { error } = await collectEventsExpectThrow(
      analyzeFood([], "something inappropriate", "user-123", "2026-02-15")
    );

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
    const err = error as { message: string };
    expect(err.message).toMatch(/flagged|safety|cannot/i);
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
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([{ base64: "img", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.tools).toHaveLength(8);
    expect(call.tools.map((t: { name: string }) => t.name)).toEqual([
      "web_search",
      "report_nutrition",
      "search_food_log",
      "get_nutrition_summary",
      "get_fasting_info",
      "search_nutrition_labels",
      "save_nutrition_label",
      "manage_nutrition_label",
    ]);
    expect(call.tool_choice).toEqual({ type: "auto" });
  });

  it("date appears in messages (last user content block), not in system prompt (A2)", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], "empanada", "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    // Date must NOT be in system prompt
    expect(call.system[0].text).not.toContain("2026-02-15");
    // Date must be in last content block of user message
    const content = call.messages[0].content;
    const lastBlock = content[content.length - 1];
    expect(lastBlock.text).toContain("2026-02-15");
  });

  // --- A2: date block in messages, not system (Task 24) ---

  it("A2: system[0].text is date-free and byte-identical for same date with different times", async () => {
    mockStream
      .mockReturnValueOnce(makeReportNutritionStream(rawToolInput))
      .mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");

    // Call 1: no currentTime
    await collectEvents(analyzeFood([], "test food", "user-123", "2026-02-15"));
    const systemText1 = mockStream.mock.calls[0][0].system[0].text;

    // Call 2: different currentTime
    await collectEvents(analyzeFood([], "test food", "user-123", "2026-02-15", undefined, undefined, "14:30"));
    const systemText2 = mockStream.mock.calls[1][0].system[0].text;

    expect(systemText1).toBe(systemText2); // byte-identical
    expect(systemText1).not.toContain("Today's date is:");
    expect(systemText1).not.toContain("Current time");
  });

  it("A2: date block appears as LAST content block of user message (with image)", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood(
      [{ base64: "img", mimeType: "image/jpeg" }],
      "empanada",
      "user-123",
      "2026-02-15"
    ));

    const call = mockStream.mock.calls[0][0];
    const content = call.messages[0].content;
    const lastBlock = content[content.length - 1];
    expect(lastBlock.type).toBe("text");
    expect(lastBlock.text).toContain("Today's date is: 2026-02-15");
  });

  it("A2: currentTime included in date block when provided", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood(
      [{ base64: "img", mimeType: "image/jpeg" }],
      "empanada",
      "user-123",
      "2026-02-15",
      undefined,
      undefined,
      "14:30"
    ));

    const call = mockStream.mock.calls[0][0];
    const content = call.messages[0].content;
    const lastBlock = content[content.length - 1];
    expect(lastBlock.text).toContain("Today's date is: 2026-02-15");
    expect(lastBlock.text).toContain("Current time: 14:30");
  });

  it("A2 slow path: 2nd request carries image blocks + cache_control breakpoint on description block", async () => {
    mockStream.mockReturnValueOnce(
      makeDataToolStream("search_food_log", { query: "empanada" }, "tool_1")
    );
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");
    // 2nd call: end_turn with report_nutrition (runToolLoop handles end_turn with nutrition)
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [{ type: "tool_use", id: "tool_rpt", name: "report_nutrition", input: { ...rawToolInput } }],
          usage: { input_tokens: 2000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood(
      [{ base64: "img", mimeType: "image/jpeg" }],
      "empanada",
      "user-123",
      "2026-02-15"
    ));

    // 2nd call is inside runToolLoop
    const call2 = mockStream.mock.calls[1][0];
    const userMsg = call2.messages[0]; // leading user message preserved

    // images still present
    const imageBlocks = (userMsg.content as Array<{type: string}>).filter((b) => b.type === "image");
    expect(imageBlocks.length).toBeGreaterThan(0);

    // cache_control breakpoint exists on a text block (description, post-image pre-date)
    const cachedBlock = (userMsg.content as Array<{type: string; cache_control?: unknown; text?: string}>).find(
      (b) => b.cache_control != null
    );
    expect(cachedBlock).toBeDefined();
    expect(cachedBlock?.type).toBe("text");

    // date block is last
    const lastBlock = userMsg.content[userMsg.content.length - 1];
    expect(lastBlock.text).toContain("Today's date is: 2026-02-15");
  });

  it("A2 slow path: cacheReadTokens in 2nd response propagates to usage StreamEvent", async () => {
    mockStream.mockReturnValueOnce(
      makeDataToolStream("search_food_log", { query: "empanada" }, "tool_1")
    );
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");
    // 2nd stream: end_turn with report_nutrition, reports cache_read_input_tokens > 0
    mockStream.mockReturnValueOnce(
      createMockStream(
        [{ type: "message_stop" }],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          content: [{ type: "tool_use", id: "tool_rpt", name: "report_nutrition", input: { ...rawToolInput } }],
          usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 },
        }
      )
    );

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood(
      [{ base64: "img", mimeType: "image/jpeg" }],
      "empanada",
      "user-123",
      "2026-02-15"
    ));

    const usageEvents = events.filter((e) => e.type === "usage") as Array<{
      type: "usage";
      data: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };
    }>;
    const cacheHitEvent = usageEvents.find((e) => e.data.cacheReadTokens > 0);
    expect(cacheHitEvent).toBeDefined();
    expect(cacheHitEvent?.data.cacheReadTokens).toBe(500);
  });

  it("uses default text when no description provided", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([{ base64: "img", mimeType: "image/jpeg" }], undefined, "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.messages[0].content).toContainEqual(
      expect.objectContaining({ type: "text", text: "Analyze this food." })
    );
  });

  it("passes images as base64 blocks", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

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

  it("text-only request: no image blocks, description + date as content blocks", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], "2 medialunas y un cortado", "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    const content = call.messages[0].content;
    // No image blocks
    expect(content.filter((b: {type: string}) => b.type === "image")).toHaveLength(0);
    // Description block is first (no cache_control for text-only)
    expect(content[0]).toEqual({ type: "text", text: "2 medialunas y un cortado" });
    // Date block is last
    const lastBlock = content[content.length - 1];
    expect(lastBlock.type).toBe("text");
    expect(lastBlock.text).toContain("Today's date is: 2026-02-15");
  });

  it("includes web_search tool (GA) via beta channel (A3 context-management)", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.tools[0]).toEqual(
      expect.objectContaining({ type: "web_search_20260209", name: "web_search" })
    );
    expect(call.tools.map((t: { name: string }) => t.name)).not.toContain("code_execution");
    // A3: betas now always present for context-management
    expect(call.betas).toContain("context-management-2025-06-27");
  });

  it("uses max_tokens 2048 for initial call", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.max_tokens).toBe(2048);
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

  it("enters tool loop when initial response has pause_turn (server-side web search)", async () => {
    // First response: pause_turn with server_tool_use, no report_nutrition, no client-side tool_use
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "pause_turn",
        content: [
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "nutrition" } },
          { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
        ],
        usage: { input_tokens: 2000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    // Second stream (in runToolLoop): Claude completes with report_nutrition in end_turn
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "Based on the nutrition info..." },
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: rawToolInput },
        ],
        usage: { input_tokens: 2500, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(
      analyzeFood([], "Big Mac", "user-123", "2026-02-15")
    );

    // Should yield tool_start for web_search before delegating to runToolLoop
    expect(events).toContainEqual({ type: "tool_start", tool: "web_search" });

    // Should have delegated to runToolLoop and produced an analysis
    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis).toEqual(validAnalysis);
    expect(events[events.length - 1]).toEqual({ type: "done" });
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("pause_turn then tool_use: no consecutive assistant messages sent to API (FOO-654)", async () => {
    // Stream 1: pause_turn with server-side web search (no client-side tool_use)
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "pause_turn",
        content: [
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "empanada nutrition" } },
          { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
        ],
        usage: { input_tokens: 2000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    // Stream 2 (runToolLoop): Claude uses a data tool (tool_use stop_reason)
    mockStream.mockReturnValueOnce(
      makeDataToolStream("get_nutrition_summary", { date: "2026-02-15" }, "tool_data_1")
    );
    mockExecuteTool.mockResolvedValueOnce("Nutrition: 300 cal protein 12g");

    // Stream 3 (runToolLoop): Claude completes with report_nutrition
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: rawToolInput },
        ],
        usage: { input_tokens: 3000, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(
      analyzeFood([], "Empanada de carne", "user-123", "2026-02-15")
    );

    // Verify no consecutive assistant messages were sent to the API
    // Stream 2 is the first runToolLoop call — messages should be [user, assistant] (merged)
    const secondCallMsgs = mockStream.mock.calls[1][0].messages;
    for (let i = 1; i < secondCallMsgs.length; i++) {
      if (secondCallMsgs[i].role === "assistant") {
        expect(secondCallMsgs[i - 1].role).not.toBe("assistant");
      }
    }

    // Stream 3: messages should still have no consecutive assistant roles
    const thirdCallMsgs = mockStream.mock.calls[2][0].messages;
    for (let i = 1; i < thirdCallMsgs.length; i++) {
      if (thirdCallMsgs[i].role === "assistant") {
        expect(thirdCallMsgs[i - 1].role).not.toBe("assistant");
      }
    }

    // Should still produce valid analysis
    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis).toEqual(validAnalysis);
    expect(mockStream).toHaveBeenCalledTimes(3);
  });

  it("forwards container ID from initial response to tool loop", async () => {
    // Initial response: pause_turn with container (web search triggered code execution)
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "pause_turn",
        content: [
          { type: "server_tool_use", id: "st1", name: "web_search" },
        ],
        usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        container: { id: "ctr_xyz", expires_at: "2026-03-05T00:00:00Z" },
      }
    ));
    // Tool loop iteration 1: report_nutrition (tool_use → stores pending, continues)
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));
    // Tool loop iteration 2: end_turn (uses pending analysis)
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], "Test food", "user-123", "2026-02-15"));

    // The second call (first runToolLoop iteration) should include container from initial response
    const toolLoopCall = mockStream.mock.calls[1][0];
    expect(toolLoopCall.container).toBe("ctr_xyz");
  });

  // ── FOO-1133: slow-path report_nutrition + data tool tool_result pairing ─────

  it("slow path: first response with report_nutrition + data tool → next request has tool_results for ALL tool_uses (FOO-1133)", async () => {
    // First stream: BOTH report_nutrition AND a data tool in the same response
    mockStream.mockReturnValueOnce(createMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: {} } },
        { type: "content_block_stop", index: 0 },
        { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t_search", name: "search_food_log", input: {} } },
        { type: "content_block_stop", index: 1 },
        { type: "message_stop" },
      ],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: rawToolInput },
          { type: "tool_use", id: "t_search", name: "search_food_log", input: { query: "empanada" } },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");
    // Second stream: end_turn (no new report_nutrition — the one in the initial response is already captured)
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], "empanada", "user-123", "2026-02-15"));

    // The second call (runToolLoop's first call) must have tool_results for BOTH tool_use blocks
    const secondCall = mockStream.mock.calls[1][0];
    // Find the assistant message with the two tool_use blocks
    const assistantMsg = secondCall.messages.find((m: { role: string }) => m.role === "assistant");
    const toolUseIds = (assistantMsg.content as Array<{ type: string; id?: string }>)
      .filter((b) => b.type === "tool_use")
      .map((b: { id?: string }) => b.id);
    expect(toolUseIds).toHaveLength(2);
    expect(toolUseIds).toContain("t_rpt");
    expect(toolUseIds).toContain("t_search");

    // User message after assistant must have tool_results for ALL tool_uses
    const userToolResultMsg = secondCall.messages.find(
      (m: { role: string; content: unknown[] }) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((b) => b.type === "tool_result"),
    );
    expect(userToolResultMsg).toBeDefined();
    const toolResultIds = (userToolResultMsg!.content as Array<{ type: string; tool_use_id?: string }>)
      .filter((b) => b.type === "tool_result")
      .map((b) => b.tool_use_id);
    expect(toolResultIds).toContain("t_rpt");
    expect(toolResultIds).toContain("t_search");
    expect(toolResultIds).toHaveLength(2);
  });

  it("slow path: first response with report_nutrition + data tool → analysis captured as pendingAnalysis and yielded (FOO-1133)", async () => {
    // First stream: BOTH report_nutrition AND a data tool
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: rawToolInput },
          { type: "tool_use", id: "t_search", name: "search_food_log", input: { query: "empanada" } },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");
    // Second stream: end_turn without report_nutrition (analysis comes from pendingAnalysis captured above)
    mockStream.mockReturnValueOnce(makeTextStream("Analysis complete."));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], "empanada", "user-123", "2026-02-15"));

    // Data tool must be executed (not silently ignored by the fast path)
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(mockExecuteTool).toHaveBeenCalledWith("search_food_log", expect.any(Object), expect.any(String), expect.any(String), expect.any(Object));
    // Both streams must be consumed (initial + runToolLoop)
    expect(mockStream).toHaveBeenCalledTimes(2);
    // Analysis from the initial report_nutrition block must be yielded
    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent).toBeDefined();
    expect(analysisEvent?.analysis).toEqual(validAnalysis);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("slow path fallback: strips hallucinated sourceCustomFoodId when search_food_log never ran (Codex P2)", async () => {
    // First response: report_nutrition WITH a source id + a NON-search data tool.
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: { ...rawToolInput, source_custom_food_id: 999 } },
          { type: "tool_use", id: "t_sum", name: "get_nutrition_summary", input: { date: "2026-02-15" } },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockExecuteTool.mockResolvedValueOnce("Totals: 1800 cal");
    // Continuation: end_turn text only → no new analysis → falls back to pendingAnalysis.
    mockStream.mockReturnValueOnce(makeTextStream("Analysis complete."));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], "empanada", "user-123", "2026-02-15"));

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent).toBeDefined();
    // search_food_log was never called → the hallucinated id must NOT leak via the fallback.
    expect(analysisEvent?.analysis.sourceCustomFoodId).toBeUndefined();
  });

  it("slow path fallback: preserves sourceCustomFoodId when search_food_log DID run", async () => {
    // First response: report_nutrition WITH a source id + search_food_log (trusted lookup).
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: { ...rawToolInput, source_custom_food_id: 999 } },
          { type: "tool_use", id: "t_search", name: "search_food_log", input: { query: "empanada" } },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — id 999");
    mockStream.mockReturnValueOnce(makeTextStream("Analysis complete."));

    const { analyzeFood } = await import("@/lib/claude");
    const events = await collectEvents(analyzeFood([], "empanada", "user-123", "2026-02-15"));

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis.sourceCustomFoodId).toBe(999);
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
        { type: "tool_use", id: "t_report", name: "report_nutrition", input: rawToolInput },
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

  it("includes web_search tool by default via beta channel (A3 context-management)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    const call = mockStream.mock.calls[0][0];
    expect(call.tools[0]).toEqual(
      expect.objectContaining({ type: "web_search_20260209", name: "web_search" })
    );
    expect(call.tools.map((t: { name: string }) => t.name)).not.toContain("code_execution");
    // A3: betas now always present for context-management
    expect(call.betas).toContain("context-management-2025-06-27");
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
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: rawToolInput },
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

  it("end_turn: gracefully yields done (no analysis) when validateFoodAnalysis throws", async () => {
    // report_nutrition with malformed input in end_turn
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: { food_name: "" } },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    // Should yield done without analysis (malformed input ignored)
    expect(events.find((e) => e.type === "analysis")).toBeUndefined();
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("tool_use: merges assistant content when messages already end with assistant role (FOO-654)", async () => {
    // Simulate the scenario where runToolLoop is entered with messages ending in assistant role
    // (as happens after analyzeFood pause_turn with no client-side tools).
    // Stream 1: tool_use response (should merge with existing assistant message, not create consecutive)
    mockStream.mockReturnValueOnce(
      makeDataToolStream("get_nutrition_summary", { date: "2026-02-15" }, "tool_1")
    );
    mockExecuteTool.mockResolvedValueOnce("Nutrition: 1800 cal...");
    // Stream 2: end_turn
    mockStream.mockReturnValueOnce(makeTextStream("Here's your summary."));

    const { runToolLoop } = await import("@/lib/claude");
    // Pass messages ending with assistant role (simulating pause_turn entry from analyzeFood)
    const events = await collectEvents(
      runToolLoop(
        [
          { role: "user", content: "Analyze my food" },
          { role: "assistant", content: [
            { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "nutrition" } },
            { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
          ] },
        ],
        "user-123",
        "2026-02-15"
      )
    );

    // The second API call should NOT have consecutive assistant messages
    const secondCall = mockStream.mock.calls[1][0];
    for (let i = 1; i < secondCall.messages.length; i++) {
      if (secondCall.messages[i].role === "assistant") {
        expect(secondCall.messages[i - 1].role).not.toBe("assistant");
      }
    }
    // Should complete successfully
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("multiple report_nutrition blocks: all blocks get tool_result responses (FOO-738)", async () => {
    const secondAnalysis = { ...validAnalysis, calories: 400, food_name: "Second Food" };
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tool_rpt_1", name: "report_nutrition", input: rawToolInput },
          { type: "tool_use", id: "tool_rpt_2", name: "report_nutrition", input: secondAnalysis },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockStream.mockReturnValueOnce(makeTextStream("Here's the analysis."));

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(
      runToolLoop([{ role: "user", content: "Analyze" }], "user-123", "2026-02-15")
    );

    // Second API call: messages = user, assistant(2 tool_use), user(tool_results)
    const secondCall = mockStream.mock.calls[1][0];
    const toolResultMsg = secondCall.messages[2];
    const toolResults = toolResultMsg.content;
    // Both report_nutrition blocks must have tool_result entries
    const rptResult1 = toolResults.find((r: { type: string; tool_use_id: string }) => r.tool_use_id === "tool_rpt_1");
    const rptResult2 = toolResults.find((r: { type: string; tool_use_id: string }) => r.tool_use_id === "tool_rpt_2");
    expect(rptResult1).toBeDefined();
    expect(rptResult2).toBeDefined();
    expect(rptResult1?.type).toBe("tool_result");
    expect(rptResult2?.type).toBe("tool_result");
  });

  it("multiple report_nutrition blocks: captures analysis from first block (FOO-738)", async () => {
    const secondAnalysis = { ...validAnalysis, calories: 400, food_name: "Second Food" };
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "tool_rpt_1", name: "report_nutrition", input: rawToolInput },
          { type: "tool_use", id: "tool_rpt_2", name: "report_nutrition", input: secondAnalysis },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop([{ role: "user", content: "Analyze" }], "user-123", "2026-02-15")
    );

    // Analysis should come from FIRST report_nutrition block only
    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis.food_name).toBe(validAnalysis.food_name);
    expect(analysisEvent?.analysis.calories).toBe(validAnalysis.calories);
  });

  it("pause_turn: merges assistant content when continuing after internal pause_turn (FOO-654)", async () => {
    // Stream 1: pause_turn (server-side web search in runToolLoop)
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "pause_turn",
        content: [
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "calories" } },
          { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
        ],
        usage: { input_tokens: 1500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    // Stream 2: tool_use after pause_turn continuation (tests the merge in pause_turn handler)
    mockStream.mockReturnValueOnce(
      makeDataToolStream("get_nutrition_summary", { date: "2026-02-15" }, "tool_2")
    );
    mockExecuteTool.mockResolvedValueOnce("Nutrition: 2000 cal...");
    // Stream 3: end_turn
    mockStream.mockReturnValueOnce(makeTextStream("You had 2000 calories."));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop(
        [{ role: "user", content: "How many calories?" }],
        "user-123",
        "2026-02-15"
      )
    );

    // The third API call (after pause_turn + tool_use) should have no consecutive assistant messages
    const thirdCall = mockStream.mock.calls[2][0];
    for (let i = 1; i < thirdCall.messages.length; i++) {
      if (thirdCall.messages[i].role === "assistant") {
        expect(thirdCall.messages[i - 1].role).not.toBe("assistant");
      }
    }
    // Should complete successfully with all 3 streams
    expect(mockStream).toHaveBeenCalledTimes(3);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("handles max_tokens stop_reason gracefully with partial analysis", async () => {
    // Claude returns max_tokens with a report_nutrition tool_use in the response
    mockStream.mockReturnValueOnce(createMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_rpt", name: "report_nutrition", input: {} } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "max_tokens",
        content: [{ type: "tool_use", id: "tool_rpt", name: "report_nutrition", input: rawToolInput }],
        usage: { input_tokens: 1500, output_tokens: 1024, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop(
        [{ role: "user", content: "What's this food?" }],
        "user-123",
        "2026-02-15"
      )
    );

    // Should yield usage, analysis from partial response, and done
    const analysisEvent = events.find((e) => e.type === "analysis");
    expect(analysisEvent).toBeDefined();
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("handles max_tokens stop_reason gracefully without analysis", async () => {
    // Claude returns max_tokens with only text (no report_nutrition)
    mockStream.mockReturnValueOnce(createMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Partial response..." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "max_tokens",
        content: [{ type: "text", text: "Partial response..." }],
        usage: { input_tokens: 1500, output_tokens: 1024, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop(
        [{ role: "user", content: "What's this food?" }],
        "user-123",
        "2026-02-15"
      )
    );

    // Should complete with done even without analysis
    expect(events[events.length - 1]).toEqual({ type: "done" });
    const analysisEvent = events.find((e) => e.type === "analysis");
    expect(analysisEvent).toBeUndefined();
  });

  it("handles refusal stop_reason gracefully", async () => {
    mockStream.mockReturnValueOnce(createMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I cannot help with that." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "refusal",
        content: [{ type: "text", text: "I cannot help with that." }],
        usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop(
        [{ role: "user", content: "Something inappropriate" }],
        "user-123",
        "2026-02-15"
      )
    );

    // Should complete with done, no analysis
    expect(events[events.length - 1]).toEqual({ type: "done" });
    const analysisEvent = events.find((e) => e.type === "analysis");
    expect(analysisEvent).toBeUndefined();
  });

  // Task 2 (FOO-782): model_context_window_exceeded should yield a user-friendly error event
  it("model_context_window_exceeded: yields error event with conversation-length message (FOO-782)", async () => {
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "model_context_window_exceeded",
        content: [],
        usage: { input_tokens: 200000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { runToolLoop } = await import("@/lib/claude");
    const events = await collectEvents(
      runToolLoop([{ role: "user", content: "What did I eat?" }], "user-123", "2026-02-15")
    );

    const errorEvent = events.find((e) => e.type === "error") as { type: "error"; message: string } | undefined;
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.message).toMatch(/too long|conversation/i);
  });

  it("forwards container ID from first response to subsequent iterations", async () => {
    // First response: tool_use with container
    mockStream.mockReturnValueOnce(
      createMockStream(
        [
          { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "get_nutrition_summary", input: {} } },
          { type: "content_block_stop", index: 0 },
          { type: "message_stop" },
        ],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "get_nutrition_summary", input: { date: "2026-02-15" } }],
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          container: { id: "ctr_abc123", expires_at: "2026-03-05T00:00:00Z" },
        }
      )
    );
    mockExecuteTool.mockResolvedValueOnce("Calories: 1800");
    // Second response: end_turn
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    const secondCall = mockStream.mock.calls[1][0];
    expect(secondCall.container).toBe("ctr_abc123");
  });

  it("does not include container when response has container: null", async () => {
    // Response with container: null
    mockStream.mockReturnValueOnce(
      createMockStream(
        [
          { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "get_nutrition_summary", input: {} } },
          { type: "content_block_stop", index: 0 },
          { type: "message_stop" },
        ],
        {
          model: "claude-sonnet-4-6",
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "get_nutrition_summary", input: { date: "2026-02-15" } }],
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          container: null,
        }
      )
    );
    mockExecuteTool.mockResolvedValueOnce("Calories: 1800");
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    const secondCall = mockStream.mock.calls[1][0];
    expect(secondCall).not.toHaveProperty("container");
  });

  it("accepts initial containerId via options and passes to first call", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15", { containerId: "ctr_initial" })
    );

    const firstCall = mockStream.mock.calls[0][0];
    expect(firstCall.container).toBe("ctr_initial");
  });
});

// =============================================================================
// conversationalRefine — streaming generator
// =============================================================================

describe("conversationalRefine", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("yields analysis event when Claude calls report_nutrition", async () => {
    const updatedRawInput = { ...rawToolInput, amount: 200 };
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
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: updatedRawInput },
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
      conversationalRefine([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
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

  it("date appears in messages (last content block of leading user msg), not in system prompt (A2)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine(
        [{ role: "user", content: "What did I eat today?" }],
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    // NOT in system prompt
    expect(call.system[0].text).not.toContain("Today's date is: 2026-02-15");
    // IS in last content block of first user message
    const content = call.messages[0].content;
    const lastBlock = content[content.length - 1];
    expect(lastBlock.text).toContain("Today's date is: 2026-02-15");
  });

  it("no date block in messages when currentDate not provided (A2)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine([{ role: "user", content: "Hi" }], "user-123")
    );

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).not.toContain("Today's date is:");
    // messages should not have a date block
    const content = call.messages[0].content;
    const dateBlock = (content as Array<{type: string; text?: string}>).find(
      (b) => b.type === "text" && b.text?.includes("Today's date is:")
    );
    expect(dateBlock).toBeUndefined();
  });

  it("uses max_tokens 2048", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    expect(mockStream).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 2048 }),
      expect.anything(),
    );
  });

  it("attaches per-message images as content blocks before text (A2: date block appended last)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("I see the food"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Here's the photo", images: ["img_data_1"] },
        ],
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    const userMsg = call.messages[0];
    expect(userMsg.role).toBe("user");
    // Image blocks should come before text block
    expect(userMsg.content[0].type).toBe("image");
    expect(userMsg.content[0].source.data).toBe("img_data_1");
    expect(userMsg.content[0].source.media_type).toBe("image/jpeg");
    expect(userMsg.content[1].type).toBe("text");
    expect(userMsg.content[1].text).toBe("Here's the photo");
    // Date block is appended last (A2)
    const lastBlock = userMsg.content[userMsg.content.length - 1];
    expect(lastBlock.text).toContain("Today's date is: 2026-02-15");
  });

  it("attaches images to each message independently across turns", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("I see both meals"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "First meal", images: ["img_turn1"] },
          { role: "assistant", content: "Got it" },
          { role: "user", content: "Second meal", images: ["img_turn2"] },
        ],
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    // First user message has its own image
    const firstUser = call.messages[0];
    expect(firstUser.content[0].type).toBe("image");
    expect(firstUser.content[0].source.data).toBe("img_turn1");
    expect(firstUser.content[1].type).toBe("text");

    // Second user message has its own image
    const secondUser = call.messages[2];
    expect(secondUser.content[0].type).toBe("image");
    expect(secondUser.content[0].source.data).toBe("img_turn2");
    expect(secondUser.content[1].type).toBe("text");
  });

  it("user messages without images: text block + date block (A2 date appended)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Just text, no images" },
        ],
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    const userMsg = call.messages[0];
    // Description block first (no images → no cache_control on description)
    expect(userMsg.content[0].type).toBe("text");
    expect(userMsg.content[0].text).toBe("Just text, no images");
    // Date block last
    const lastBlock = userMsg.content[userMsg.content.length - 1];
    expect(lastBlock.text).toContain("Today's date is: 2026-02-15");
  });

  it("mixed conversation: only messages with images get image blocks", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Analysis complete"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Photo of lunch", images: ["lunch_img"] },
          { role: "assistant", content: "I see a salad" },
          { role: "user", content: "Actually it was 300g" },
          { role: "assistant", content: "Updated" },
          { role: "user", content: "Here's dessert too", images: ["dessert_img"] },
        ],
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    // Message 0 (user with image): image + text
    expect(call.messages[0].content[0].type).toBe("image");
    expect(call.messages[0].content[1].type).toBe("text");
    // Message 2 (user without image): text only
    expect(call.messages[2].content).toHaveLength(1);
    expect(call.messages[2].content[0].type).toBe("text");
    // Message 4 (user with image): image + text
    expect(call.messages[4].content[0].type).toBe("image");
    expect(call.messages[4].content[1].type).toBe("text");
  });

  it("assistant messages are unaffected by per-message images", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Photo", images: ["img1"] },
          { role: "assistant", content: "Got it", analysis: validAnalysis },
          { role: "user", content: "Thanks" },
        ],
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    const assistantMsg = call.messages[1];
    expect(assistantMsg.role).toBe("assistant");
    // Assistant messages should have text content blocks only (text + analysis summary)
    for (const block of assistantMsg.content) {
      expect(block.type).toBe("text");
    }
  });

  it("records usage", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK", { input_tokens: 1800, output_tokens: 400 }));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-sonnet-4-6",
      "food-chat",
      expect.objectContaining({ inputTokens: 1800, outputTokens: 400 })
    );
  });

  it("web_search tool is first in tools array (via beta channel)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    const call = mockStream.mock.calls[0][0];
    expect(call.tools[0]).toEqual(
      expect.objectContaining({ type: "web_search_20260209", name: "web_search" })
    );
    expect(call.tools.map((t: { name: string }) => t.name)).not.toContain("code_execution");
    // A3: betas now always present for context-management
    expect(call.betas).toContain("context-management-2025-06-27");
  });

  it("enters tool loop when stop_reason is pause_turn (server-side web search)", async () => {
    // First response: pause_turn with server_tool_use (web search), no client-side tool_use blocks
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "pause_turn",
        content: [
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "McDonald's Big Mac nutrition" } },
          { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
        ],
        usage: { input_tokens: 2000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    // Second stream (in runToolLoop): Claude completes with report_nutrition
    mockStream.mockReturnValueOnce(createMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Based on the nutrition info..." } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "Based on the nutrition info..." },
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: rawToolInput },
        ],
        usage: { input_tokens: 2500, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { conversationalRefine } = await import("@/lib/claude");
    const events = await collectEvents(
      conversationalRefine(
        [{ role: "user", content: "I had a Big Mac" }],
        "user-123",
        "2026-02-15"
      )
    );

    // Should yield tool_start for web_search before delegating to runToolLoop
    expect(events).toContainEqual({ type: "tool_start", tool: "web_search" });

    // Should have delegated to runToolLoop and produced an analysis
    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis).toEqual(validAnalysis);
    expect(events[events.length - 1]).toEqual({ type: "done" });
    // Two API calls: initial + runToolLoop
    expect(mockStream).toHaveBeenCalledTimes(2);
  });

  it("pause_turn then tool_use: no consecutive assistant messages sent to API (FOO-654)", async () => {
    // Stream 1: pause_turn with server-side web search (no client-side tool_use)
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "pause_turn",
        content: [
          { type: "server_tool_use", id: "srv_1", name: "web_search", input: { query: "Big Mac calories" } },
          { type: "web_search_tool_result", tool_use_id: "srv_1", content: [] },
        ],
        usage: { input_tokens: 2000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    // Stream 2 (runToolLoop): Claude uses a data tool (tool_use stop_reason)
    mockStream.mockReturnValueOnce(
      makeDataToolStream("get_nutrition_summary", { date: "2026-02-15" }, "tool_data_1")
    );
    mockExecuteTool.mockResolvedValueOnce("Nutrition: 550 cal protein 25g");

    // Stream 3 (runToolLoop): Claude completes with report_nutrition
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: rawToolInput },
        ],
        usage: { input_tokens: 3000, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { conversationalRefine } = await import("@/lib/claude");
    const events = await collectEvents(
      conversationalRefine(
        [{ role: "user", content: "I had a Big Mac" }],
        "user-123",
        "2026-02-15"
      )
    );

    // Stream 2 (first runToolLoop call): messages should have no consecutive assistant roles
    const secondCallMsgs = mockStream.mock.calls[1][0].messages;
    for (let i = 1; i < secondCallMsgs.length; i++) {
      if (secondCallMsgs[i].role === "assistant") {
        expect(secondCallMsgs[i - 1].role).not.toBe("assistant");
      }
    }

    // Stream 3: messages should still have no consecutive assistant roles
    const thirdCallMsgs = mockStream.mock.calls[2][0].messages;
    for (let i = 1; i < thirdCallMsgs.length; i++) {
      if (thirdCallMsgs[i].role === "assistant") {
        expect(thirdCallMsgs[i - 1].role).not.toBe("assistant");
      }
    }

    // Should still produce valid analysis
    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis).toEqual(validAnalysis);
    expect(mockStream).toHaveBeenCalledTimes(3);
  });

  // Fix 3 (FOO-797): refusal stop_reason in conversationalRefine
  it("throws CLAUDE_API_ERROR when response is refusal (FOO-797)", async () => {
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "refusal",
        content: [],
        usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { conversationalRefine } = await import("@/lib/claude");
    const { error } = await collectEventsExpectThrow(
      conversationalRefine([{ role: "user", content: "something inappropriate" }], "user-123", "2026-02-15")
    );

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
    const err = error as { message: string };
    expect(err.message).toMatch(/flagged|safety|cannot/i);
  });

  it("forwards container ID from initial response to tool loop", async () => {
    // Initial response: pause_turn with container
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "pause_turn",
        content: [
          { type: "server_tool_use", id: "srv_1", name: "web_search" },
        ],
        usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        container: { id: "ctr_refine", expires_at: "2026-03-05T00:00:00Z" },
      }
    ));
    // Tool loop iteration 1: report_nutrition (tool_use → stores pending, continues)
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));
    // Tool loop iteration 2: end_turn (uses pending analysis)
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );

    const toolLoopCall = mockStream.mock.calls[1][0];
    expect(toolLoopCall.container).toBe("ctr_refine");
  });

  // ── FOO-1133: slow-path report_nutrition + data tool tool_result pairing ─────

  it("slow path: first response with report_nutrition + data tool → next request has tool_results for ALL tool_uses (FOO-1133)", async () => {
    // First stream: BOTH report_nutrition AND a data tool in the same response
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: rawToolInput },
          { type: "tool_use", id: "t_search", name: "search_food_log", input: { query: "empanada" } },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");
    // Second stream (runToolLoop): end_turn
    mockStream.mockReturnValueOnce(makeTextStream("Done."));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Update the analysis" },
          { role: "assistant", content: "Got it", analysis: validAnalysis },
          { role: "user", content: "Actually make it 200g" },
        ],
        "user-123",
        "2026-02-15",
      )
    );

    // The second call (runToolLoop's first call) must have tool_results for BOTH tool_use blocks
    const secondCall = mockStream.mock.calls[1][0];
    // Find the assistant message that contains the tool_use blocks (may not be the first assistant msg)
    const assistantMsg = secondCall.messages.find(
      (m: { role: string; content: unknown }) =>
        m.role === "assistant" &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((b) => b.type === "tool_use"),
    );
    expect(assistantMsg).toBeDefined();
    const toolUseIds = (assistantMsg!.content as Array<{ type: string; id?: string }>)
      .filter((b) => b.type === "tool_use")
      .map((b: { id?: string }) => b.id);
    expect(toolUseIds).toHaveLength(2);
    expect(toolUseIds).toContain("t_rpt");
    expect(toolUseIds).toContain("t_search");

    const userToolResultMsg = secondCall.messages.find(
      (m: { role: string; content: unknown[] }) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((b) => b.type === "tool_result"),
    );
    expect(userToolResultMsg).toBeDefined();
    const toolResultIds = (userToolResultMsg!.content as Array<{ type: string; tool_use_id?: string }>)
      .filter((b) => b.type === "tool_result")
      .map((b) => b.tool_use_id);
    expect(toolResultIds).toContain("t_rpt");
    expect(toolResultIds).toContain("t_search");
    expect(toolResultIds).toHaveLength(2);
  });

  it("slow path: first response with report_nutrition + data tool → analysis captured as pendingAnalysis and yielded (FOO-1133)", async () => {
    // First stream: BOTH report_nutrition AND a data tool
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: rawToolInput },
          { type: "tool_use", id: "t_search", name: "search_food_log", input: { query: "empanada" } },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");
    // Second stream (runToolLoop): end_turn without report_nutrition
    mockStream.mockReturnValueOnce(makeTextStream("Update applied."));

    const { conversationalRefine } = await import("@/lib/claude");
    const events = await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Update the analysis" },
          { role: "assistant", content: "Got it", analysis: validAnalysis },
          { role: "user", content: "Actually make it 200g" },
        ],
        "user-123",
        "2026-02-15",
      )
    );

    // Analysis from the initial report_nutrition block must be yielded
    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent).toBeDefined();
    expect(analysisEvent?.analysis).toEqual(validAnalysis);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("slow path fallback: strips hallucinated sourceCustomFoodId when search_food_log never ran (Codex P2)", async () => {
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: { ...rawToolInput, source_custom_food_id: 999 } },
          { type: "tool_use", id: "t_sum", name: "get_nutrition_summary", input: { date: "2026-02-15" } },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockExecuteTool.mockResolvedValueOnce("Totals: 1800 cal");
    mockStream.mockReturnValueOnce(makeTextStream("Update applied."));

    const { conversationalRefine } = await import("@/lib/claude");
    const events = await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Update the analysis" },
          { role: "assistant", content: "Got it", analysis: validAnalysis },
          { role: "user", content: "Actually make it 200g" },
        ],
        "user-123",
        "2026-02-15",
      )
    );

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent).toBeDefined();
    expect(analysisEvent?.analysis.sourceCustomFoodId).toBeUndefined();
  });

  it("slow path fallback: preserves sourceCustomFoodId when search_food_log DID run", async () => {
    mockStream.mockReturnValueOnce(createMockStream(
      [{ type: "message_stop" }],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "tool_use",
        content: [
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: { ...rawToolInput, source_custom_food_id: 999 } },
          { type: "tool_use", id: "t_search", name: "search_food_log", input: { query: "empanada" } },
        ],
        usage: { input_tokens: 1500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));
    mockExecuteTool.mockResolvedValueOnce("Found: id 999");
    mockStream.mockReturnValueOnce(makeTextStream("Update applied."));

    const { conversationalRefine } = await import("@/lib/claude");
    const events = await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Update the analysis" },
          { role: "assistant", content: "Got it", analysis: validAnalysis },
          { role: "user", content: "Actually make it 200g" },
        ],
        "user-123",
        "2026-02-15",
      )
    );

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis.sourceCustomFoodId).toBe(999);
  });

  it("fast path: strips hallucinated sourceCustomFoodId (no data tools → search_food_log never ran)", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream({ ...rawToolInput, source_custom_food_id: 999 }));

    const { conversationalRefine } = await import("@/lib/claude");
    const events = await collectEvents(
      conversationalRefine(
        [
          { role: "user", content: "Update the analysis" },
          { role: "assistant", content: "Got it", analysis: validAnalysis },
          { role: "user", content: "Make it 200g" },
        ],
        "user-123",
        "2026-02-15",
      )
    );

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent).toBeDefined();
    expect(analysisEvent?.analysis.sourceCustomFoodId).toBeUndefined();
  });
});

// =============================================================================
// editAnalysis — streaming generator
// =============================================================================

describe("editAnalysis", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  const validEntry: FoodLogEntryDetail = {
    id: 42,
    customFoodId: 100,
    foodName: "Empanada de carne",
    description: "Standard Argentine beef empanada",
    notes: "Baked style",
    calories: 320,
    proteinG: 12,
    carbsG: 28,
    fatG: 18,
    fiberG: 2,
    sodiumMg: 450,
    saturatedFatG: null,
    transFatG: null,
    sugarsG: null,
    caloriesFromFat: null,
    amount: 150,
    unitId: "g",
    mealTypeId: 5,
    date: "2026-02-15",
    time: "20:00:00",
    healthLogId: null,
    confidence: "high",
    isFavorite: false,
    keywords: ["empanada", "carne"],
  };

  it("yields analysis event when Claude calls report_nutrition", async () => {
    const updatedRawInput = { ...rawToolInput, calories: 280, amount: 130 };
    const updatedAnalysis = { ...validAnalysis, calories: 280, amount: 130 };
    mockStream.mockReturnValueOnce(createMockStream(
      [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "I've updated the calorie count to 280" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ],
      {
        model: "claude-sonnet-4-6",
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "I've updated the calorie count to 280" },
          { type: "tool_use", id: "t_rpt", name: "report_nutrition", input: updatedRawInput },
        ],
        usage: { input_tokens: 1800, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }
    ));

    const { editAnalysis } = await import("@/lib/claude");
    const events = await collectEvents(
      editAnalysis(
        [{ role: "user", content: "It was actually 130g and 280 calories" }],
        validEntry,
        "user-123",
        "2026-02-15"
      )
    );

    const analysisEvent = events.find((e) => e.type === "analysis") as { type: "analysis"; analysis: FoodAnalysis } | undefined;
    expect(analysisEvent?.analysis).toEqual(updatedAnalysis);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("yields text_delta but no analysis for text-only response", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("What would you like to change about this entry?"));

    const { editAnalysis } = await import("@/lib/claude");
    const events = await collectEvents(
      editAnalysis(
        [{ role: "user", content: "The calories seem off" }],
        validEntry,
        "user-123",
        "2026-02-15"
      )
    );

    expect(events).toContainEqual({ type: "text_delta", text: "What would you like to change about this entry?" });
    expect(events.find((e) => e.type === "analysis")).toBeUndefined();
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("uses EDIT_SYSTEM_PROMPT", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { editAnalysis, EDIT_SYSTEM_PROMPT } = await import("@/lib/claude");
    await collectEvents(
      editAnalysis(
        [{ role: "user", content: "Test" }],
        validEntry,
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain(EDIT_SYSTEM_PROMPT);
  });

  it("includes existing entry context in system prompt (food name, calories)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { editAnalysis } = await import("@/lib/claude");
    await collectEvents(
      editAnalysis(
        [{ role: "user", content: "Fix this" }],
        validEntry,
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain(validEntry.foodName);
    expect(systemText).toContain(String(validEntry.calories));
  });

  it("date appears in messages (last content block of leading user msg), not in system prompt (A2)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { editAnalysis } = await import("@/lib/claude");
    // Use a different currentDate than validEntry.date (2026-02-15) to distinguish them
    await collectEvents(
      editAnalysis(
        [{ role: "user", content: "Fix this" }],
        validEntry,
        "user-123",
        "2026-03-01" // currentDate differs from validEntry.date (2026-02-15)
      )
    );

    const call = mockStream.mock.calls[0][0];
    // currentDate "2026-03-01" must NOT be in system prompt (entry.date "2026-02-15" is OK there)
    expect(call.system[0].text).not.toContain("2026-03-01");
    // IS in last content block of first user message
    const content = call.messages[0].content;
    const lastBlock = content[content.length - 1];
    expect(lastBlock.text).toContain("2026-03-01");
  });

  it("records usage with operation food-edit", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK", { input_tokens: 1800, output_tokens: 400 }));

    const { editAnalysis } = await import("@/lib/claude");
    await collectEvents(
      editAnalysis(
        [{ role: "user", content: "Test" }],
        validEntry,
        "user-123",
        "2026-02-15"
      )
    );

    expect(mockRecordUsage).toHaveBeenCalledWith(
      "user-123",
      "claude-sonnet-4-6",
      "food-edit",
      expect.objectContaining({ inputTokens: 1800, outputTokens: 400 })
    );
  });

  it("delegates to runToolLoop when data tools are used", async () => {
    mockStream.mockReturnValueOnce(
      makeDataToolStream("search_food_log", { query: "empanada" }, "tool_data")
    );
    mockExecuteTool.mockResolvedValueOnce("Found: Empanada — 150g, 320 cal");
    mockStream.mockReturnValueOnce(makeTextStream("Based on your log, this seems right."));

    const { editAnalysis } = await import("@/lib/claude");
    const events = await collectEvents(
      editAnalysis(
        [{ role: "user", content: "Is 320 calories accurate?" }],
        validEntry,
        "user-123",
        "2026-02-15"
      )
    );

    expect(events).toContainEqual({ type: "tool_start", tool: "search_food_log" });
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    expect(events[events.length - 1]).toEqual({ type: "done" });
  });

  it("edit system prompt includes Tier 1 nutrients when present in entry (FOO-732)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const entryWithTier1 = {
      ...validEntry,
      saturatedFatG: 5.5,
      transFatG: 0.2,
      sugarsG: 3.0,
      caloriesFromFat: 162,
    };

    const { editAnalysis } = await import("@/lib/claude");
    await collectEvents(
      editAnalysis([{ role: "user", content: "Fix this" }], entryWithTier1, "user-123", "2026-02-15")
    );

    const call = mockStream.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain("5.5");
    expect(systemText).toContain("0.2");
    expect(systemText).toContain("3");
    expect(systemText).toContain("162");
  });

  it("edit system prompt does not include Tier 1 nutrients when null (FOO-732)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { editAnalysis } = await import("@/lib/claude");
    await collectEvents(
      editAnalysis([{ role: "user", content: "Fix this" }], validEntry, "user-123", "2026-02-15")
    );

    const call = mockStream.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).not.toContain("Saturated Fat");
    expect(systemText).not.toContain("Trans Fat");
    expect(systemText).not.toContain("Sugars:");
  });

  it("edit system prompt says 'Save Changes' not 'Log to Fitbit' or 'Log to Google Health' (FOO-737)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { editAnalysis } = await import("@/lib/claude");
    await collectEvents(
      editAnalysis([{ role: "user", content: "Fix this" }], validEntry, "user-123", "2026-02-15")
    );

    const call = mockStream.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain("Save Changes");
    expect(systemText).not.toContain("Log to Fitbit");
    expect(systemText).not.toContain("Log to Google Health");
  });

  it("edit system prompt mentions data tools (FOO-736)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { editAnalysis } = await import("@/lib/claude");
    await collectEvents(
      editAnalysis([{ role: "user", content: "Fix this" }], validEntry, "user-123", "2026-02-15")
    );

    const call = mockStream.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toMatch(/search_food_log|data tools/i);
  });

  it("injects [Current values:] summary into assistant messages with analysis (FOO-731)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { editAnalysis } = await import("@/lib/claude");
    await collectEvents(
      editAnalysis(
        [
          { role: "user", content: "Change the portion" },
          { role: "assistant", content: "Updated to 200g", analysis: validAnalysis },
          { role: "user", content: "Actually make it 250g" },
        ],
        validEntry,
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    // Second message should be assistant message with [Current values: ...] appended
    const assistantMsg = call.messages[1];
    expect(assistantMsg.role).toBe("assistant");
    const summaryBlock = assistantMsg.content.find((b: { type: string; text?: string }) =>
      b.type === "text" && b.text?.includes("[Current values:")
    );
    expect(summaryBlock).toBeDefined();
    expect(summaryBlock?.text).toContain(validAnalysis.food_name);
    expect(summaryBlock?.text).toContain(String(validAnalysis.calories));
  });

  it("accepts optional initialAnalysis parameter and includes it in system prompt (FOO-731)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { editAnalysis } = await import("@/lib/claude");
    await collectEvents(
      editAnalysis(
        [{ role: "user", content: "Fix this" }],
        validEntry,
        "user-123",
        "2026-02-15",
        undefined,
        undefined,
        validAnalysis
      )
    );

    const call = mockStream.mock.calls[0][0];
    const systemText = call.system[0].text;
    expect(systemText).toContain(validAnalysis.food_name);
    expect(systemText).toContain("baseline");
  });

  it("sends image blocks when ConversationMessage has images", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { editAnalysis } = await import("@/lib/claude");
    await collectEvents(
      editAnalysis(
        [{ role: "user", content: "Check this", images: ["img_data_123"] }],
        validEntry,
        "user-123",
        "2026-02-15"
      )
    );

    const call = mockStream.mock.calls[0][0];
    const userMsg = call.messages[0];
    const imageBlocks = userMsg.content.filter((b: { type: string }) => b.type === "image");
    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "img_data_123" },
    });
  });
});

// =============================================================================
// (truncateConversation deleted in Task 25 — server-side context management replaces it)
// =============================================================================

// Placeholder so the section header is preserved
describe("(formerly truncateConversation — deleted in Task 25)", () => {
  it("truncateConversation is removed (server-side context management replaces client-side truncation)", async () => {
    const claudeModule = await import("@/lib/claude");
    expect((claudeModule as Record<string, unknown>).truncateConversation).toBeUndefined();
  });
});

// =============================================================================
// REPORT_NUTRITION_TOOL schema — unchanged
// =============================================================================

describe("REPORT_NUTRITION_TOOL schema", () => {
  afterEach(() => { vi.resetModules(); });

  it("Tier 1 fields use non-nullable number type", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    const schema = REPORT_NUTRITION_TOOL.input_schema;
    const props = schema.properties as Record<string, Record<string, unknown>>;

    expect(props.saturated_fat_g.type).toBe("number");
    expect(props.trans_fat_g.type).toBe("number");
    expect(props.sugars_g.type).toBe("number");
    expect(props.calories_from_fat.type).toBe("number");
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

  it("instructs to suggest meal types based on context", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/meal.type/i);
    expect(CHAT_SYSTEM_PROMPT).toMatch(/always suggest.*meal.type|suggest.*meal.type.*based on/i);
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

// =============================================================================
// Task 5: Anti-confirmation rules (FOO-645)
// =============================================================================

describe("Task 5: CHAT_SYSTEM_PROMPT anti-confirmation rules (FOO-645)", () => {
  afterEach(() => { vi.resetModules(); });

  it("explains that report_nutrition surfaces a UI card, not a direct log", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    // Should explain that calling report_nutrition shows a UI card, not logs food directly
    expect(CHAT_SYSTEM_PROMPT).toMatch(/UI card/i);
  });

  it("explains that user confirms via Log to Google Health button, not text", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/Log to Google Health.*button|button.*Log to Google Health/i);
  });

  it("has blanket anti-confirmation rule: never ask 'should I log/register this?'", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    // Should explicitly say never ask for confirmation before report_nutrition
    expect(CHAT_SYSTEM_PROMPT).toMatch(/never ask.*log|never ask.*register|never ask.*confirmation/i);
  });
});

describe("Task 5: ANALYSIS_SYSTEM_PROMPT anti-confirmation rules (FOO-645)", () => {
  afterEach(() => { vi.resetModules(); });

  it("has anti-confirmation rule: never ask for confirmation before calling report_nutrition", async () => {
    const { ANALYSIS_SYSTEM_PROMPT } = await import("@/lib/claude");
    // Should explicitly say never ask for confirmation before report_nutrition
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/never ask.*confirmation|do not ask.*confirmation/i);
  });

  it("explains that report_nutrition surfaces a UI card, not a direct log", async () => {
    const { ANALYSIS_SYSTEM_PROMPT } = await import("@/lib/claude");
    // Should explain that calling report_nutrition shows a UI card, not logs food directly
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/UI card/i);
  });

  it("explains that user confirms via Log to Google Health button", async () => {
    const { ANALYSIS_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/Log to Google Health.*button|button.*Log to Google Health/i);
  });
});


// Helper to get the MockAPIError constructor from the mocked SDK
type MockAPIErrorCtor = new (status: number, message: string, error?: unknown) => Error & { status: number; error: unknown };
async function getMockAPIErrorCtor(): Promise<MockAPIErrorCtor> {
  const sdk = await import("@anthropic-ai/sdk") as unknown as { default: { APIError: MockAPIErrorCtor } };
  return sdk.default.APIError;
}

// Helper logger for direct function tests
function makeTestLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

// =============================================================================
// Task 2: isOverloadedError
// =============================================================================

describe("isOverloadedError", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("returns true for Anthropic APIError with status 529", async () => {
    const APIError = await getMockAPIErrorCtor();
    const { isOverloadedError } = await import("@/lib/claude");

    expect(isOverloadedError(new APIError(529, "Overloaded"))).toBe(true);
  });

  it("returns true for error whose .error.type is overloaded_error", async () => {
    const { isOverloadedError } = await import("@/lib/claude");

    expect(isOverloadedError({ error: { type: "overloaded_error" } })).toBe(true);
  });

  it("returns false for APIError with status 400", async () => {
    const APIError = await getMockAPIErrorCtor();
    const { isOverloadedError } = await import("@/lib/claude");

    expect(isOverloadedError(new APIError(400, "Bad Request"))).toBe(false);
  });

  it("returns false for APIError with status 401", async () => {
    const APIError = await getMockAPIErrorCtor();
    const { isOverloadedError } = await import("@/lib/claude");

    expect(isOverloadedError(new APIError(401, "Unauthorized"))).toBe(false);
  });

  it("returns false for APIError with status 429", async () => {
    const APIError = await getMockAPIErrorCtor();
    const { isOverloadedError } = await import("@/lib/claude");

    expect(isOverloadedError(new APIError(429, "Rate Limited"))).toBe(false);
  });

  it("returns false for generic Error", async () => {
    const { isOverloadedError } = await import("@/lib/claude");

    expect(isOverloadedError(new Error("Something went wrong"))).toBe(false);
  });

  it("returns false for null", async () => {
    const { isOverloadedError } = await import("@/lib/claude");
    expect(isOverloadedError(null)).toBe(false);
  });

  it("returns false for non-error values", async () => {
    const { isOverloadedError } = await import("@/lib/claude");
    expect(isOverloadedError(undefined)).toBe(false);
    expect(isOverloadedError("string error")).toBe(false);
    expect(isOverloadedError(42)).toBe(false);
  });

  it("returns true for SSE streaming error with nested overloaded_error", async () => {
    const APIError = await getMockAPIErrorCtor();
    const { isOverloadedError } = await import("@/lib/claude");

    const sseError = new APIError(undefined as unknown as number, "Overloaded", {
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    });
    expect(isOverloadedError(sseError)).toBe(true);
  });

  it("returns true for SSE streaming error with request_id field", async () => {
    const APIError = await getMockAPIErrorCtor();
    const { isOverloadedError } = await import("@/lib/claude");

    const sseError = new APIError(undefined as unknown as number, "Overloaded", {
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
      request_id: "req_abc123",
    });
    expect(isOverloadedError(sseError)).toBe(true);
  });

  it("returns false for SSE streaming error with different nested error type", async () => {
    const APIError = await getMockAPIErrorCtor();
    const { isOverloadedError } = await import("@/lib/claude");

    const sseError = new APIError(undefined as unknown as number, "Bad request", {
      type: "error",
      error: { type: "invalid_request_error" },
    });
    expect(isOverloadedError(sseError)).toBe(false);
  });
});

// =============================================================================
// Task 3: createStreamWithRetry
// =============================================================================

// Minimal stream params for createStreamWithRetry tests
const minimalStreamParams = {
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  system: [{ type: "text" as const, text: "test", cache_control: { type: "ephemeral" as const } }],
  tools: [],
  tool_choice: { type: "auto" as const },
  messages: [{ role: "user" as const, content: "test" }],
};

describe("createStreamWithRetry", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

  it("yields text deltas and returns on success without retry", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Hello world"));

    const { createStreamWithRetry } = await import("@/lib/claude");
    const log = makeTestLogger();

    const events = await collectEvents(createStreamWithRetry(minimalStreamParams, {}, log, 2));

    expect(events).toContainEqual({ type: "text_delta", text: "Hello world" });
    expect(mockStream).toHaveBeenCalledTimes(1);
  });

  it("does not override maxRetries in request options (SDK retries enabled)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { createStreamWithRetry } = await import("@/lib/claude");
    const log = makeTestLogger();

    await collectEvents(createStreamWithRetry(minimalStreamParams, { signal: undefined }, log, 2));

    const requestOptions = mockStream.mock.calls[0][1] as Record<string, unknown>;
    expect(requestOptions).not.toHaveProperty("maxRetries");
  });

  it("on 529 error: yields retry message, delays 1s, retries and succeeds", async () => {
    vi.useFakeTimers();

    const APIError = await getMockAPIErrorCtor();
    mockStream
      .mockImplementationOnce(() => { throw new APIError(529, "Overloaded"); })
      .mockReturnValueOnce(makeTextStream("Success after retry"));

    const { createStreamWithRetry } = await import("@/lib/claude");
    const log = makeTestLogger();

    const eventsPromise = collectEvents(createStreamWithRetry(minimalStreamParams, {}, log, 3));
    await vi.advanceTimersByTimeAsync(2000);
    const events = await eventsPromise;

    const retryMsg = events.find(
      (e) => e.type === "text_delta" && (e as { type: "text_delta"; text: string }).text.includes("momentarily busy")
    );
    expect(retryMsg).toBeDefined();
    expect(events).toContainEqual({ type: "text_delta", text: "Success after retry" });
    expect(mockStream).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("on persistent 529: yields retry messages then throws ClaudeApiError", async () => {
    vi.useFakeTimers();

    const APIError = await getMockAPIErrorCtor();
    mockStream.mockImplementation(() => { throw new APIError(529, "Overloaded"); });

    const { createStreamWithRetry } = await import("@/lib/claude");
    const log = makeTestLogger();

    const resultPromise = collectEventsExpectThrow(
      createStreamWithRetry(minimalStreamParams, {}, log, 3)
    );
    await vi.advanceTimersByTimeAsync(17000); // 2s + 5s + 10s delays
    const { events, error } = await resultPromise;

    const retryMsgs = events.filter(
      (e) => e.type === "text_delta" && (e as { type: "text_delta"; text: string }).text.includes("momentarily busy")
    );
    expect(retryMsgs).toHaveLength(3);
    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
    expect((error as Error).message).toContain("temporarily overloaded");

    vi.useRealTimers();
  });

  it("on persistent 529: uses log.warn not log.error for retry exhaustion", async () => {
    vi.useFakeTimers();

    const APIError = await getMockAPIErrorCtor();
    mockStream.mockImplementation(() => { throw new APIError(529, "Overloaded"); });

    const { createStreamWithRetry } = await import("@/lib/claude");
    const log = makeTestLogger();

    const resultPromise = collectEventsExpectThrow(
      createStreamWithRetry(minimalStreamParams, {}, log, 3)
    );
    await vi.advanceTimersByTimeAsync(17000);
    await resultPromise;

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "stream_retry_exhausted" }),
      expect.any(String)
    );
    expect(log.error).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("on non-529 error: throws immediately without retry", async () => {
    mockStream.mockImplementationOnce(() => { throw new Error("Network error"); });

    const { createStreamWithRetry } = await import("@/lib/claude");
    const log = makeTestLogger();

    const { error } = await collectEventsExpectThrow(
      createStreamWithRetry(minimalStreamParams, {}, log, 3)
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    expect((error as Error).message).toBe("Network error");
    expect((error as Error | undefined)?.name).not.toBe("CLAUDE_API_ERROR");
  });
});

// =============================================================================
// Double Sentry reporting fix (FOO-774)
// =============================================================================

describe("runToolLoop — non-ClaudeApiError uses warn not error", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("logs l.warn (not l.error) and throws ClaudeApiError for non-ClaudeApiError", async () => {
    mockStream.mockImplementationOnce(() => { throw new Error("Network failure"); });

    const { runToolLoop } = await import("@/lib/claude");
    const log = makeTestLogger();
    const { error } = await collectEventsExpectThrow(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15", { log })
    );

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tool_loop_error" }),
      "Claude API tool loop error"
    );
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe("analyzeFood — non-ClaudeApiError uses warn not error", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("logs l.warn (not l.error) and throws ClaudeApiError for non-ClaudeApiError", async () => {
    mockStream.mockImplementationOnce(() => { throw new Error("Connection refused"); });

    const { analyzeFood } = await import("@/lib/claude");
    const log = makeTestLogger();
    const { error } = await collectEventsExpectThrow(
      analyzeFood([], undefined, "user-123", "2026-02-15", log)
    );

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Connection refused" }),
      "Claude API error"
    );
    expect(log.error).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Task 4: analyzeFood retry on 529
// =============================================================================

describe("analyzeFood overload retry", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

  it("on 529 error: yields retry message and retries successfully", async () => {
    vi.useFakeTimers();

    const APIError = await getMockAPIErrorCtor();
    mockStream
      .mockImplementationOnce(() => { throw new APIError(529, "Overloaded"); })
      .mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    const eventsPromise = collectEvents(
      analyzeFood([], undefined, "user-123", "2026-02-15")
    );
    await vi.advanceTimersByTimeAsync(2000);
    const events = await eventsPromise;

    const retryMsg = events.find(
      (e) => e.type === "text_delta" && (e as { type: "text_delta"; text: string }).text.includes("momentarily busy")
    );
    expect(retryMsg).toBeDefined();
    expect(events).toContainEqual({ type: "analysis", analysis: validAnalysis });
    expect(mockStream).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("on persistent 529: throws ClaudeApiError with overloaded message", async () => {
    vi.useFakeTimers();

    const APIError = await getMockAPIErrorCtor();
    mockStream.mockImplementation(() => { throw new APIError(529, "Overloaded"); });

    const { analyzeFood } = await import("@/lib/claude");
    const resultPromise = collectEventsExpectThrow(
      analyzeFood([], undefined, "user-123", "2026-02-15")
    );
    await vi.advanceTimersByTimeAsync(17000);
    const { error } = await resultPromise;

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
    expect((error as Error).message).toContain("temporarily overloaded");

    vi.useRealTimers();
  });
});

// =============================================================================
// Task 5: runToolLoop retry on 529
// =============================================================================

describe("runToolLoop overload retry", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

  it("on 529 error: yields retry message and retries successfully", async () => {
    vi.useFakeTimers();

    const APIError = await getMockAPIErrorCtor();
    mockStream
      .mockImplementationOnce(() => { throw new APIError(529, "Overloaded"); })
      .mockReturnValueOnce(makeTextStream("Here's your info."));

    const { runToolLoop } = await import("@/lib/claude");
    const eventsPromise = collectEvents(
      runToolLoop([{ role: "user", content: "How many calories?" }], "user-123", "2026-02-15")
    );
    await vi.advanceTimersByTimeAsync(2000);
    const events = await eventsPromise;

    const retryMsg = events.find(
      (e) => e.type === "text_delta" && (e as { type: "text_delta"; text: string }).text.includes("momentarily busy")
    );
    expect(retryMsg).toBeDefined();
    expect(events).toContainEqual({ type: "text_delta", text: "Here's your info." });
    expect(mockStream).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("on persistent 529: throws ClaudeApiError with overloaded message", async () => {
    vi.useFakeTimers();

    const APIError = await getMockAPIErrorCtor();
    mockStream.mockImplementation(() => { throw new APIError(529, "Overloaded"); });

    const { runToolLoop } = await import("@/lib/claude");
    const resultPromise = collectEventsExpectThrow(
      runToolLoop([{ role: "user", content: "Test" }], "user-123", "2026-02-15")
    );
    await vi.advanceTimersByTimeAsync(17000);
    const { error } = await resultPromise;

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
    expect((error as Error).message).toContain("temporarily overloaded");

    vi.useRealTimers();
  });
});

// =============================================================================
// Task 5: conversationalRefine retry on 529
// =============================================================================

describe("conversationalRefine overload retry", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.useRealTimers(); vi.resetModules(); });

  it("on 529 error: yields retry message and retries successfully", async () => {
    vi.useFakeTimers();

    const APIError = await getMockAPIErrorCtor();
    mockStream
      .mockImplementationOnce(() => { throw new APIError(529, "Overloaded"); })
      .mockReturnValueOnce(makeTextStream("Sure, I updated it."));

    const { conversationalRefine } = await import("@/lib/claude");
    const eventsPromise = collectEvents(
      conversationalRefine(
        [{ role: "user", content: "Make it 200g" }],
        "user-123",
        "2026-02-15"
      )
    );
    await vi.advanceTimersByTimeAsync(2000);
    const events = await eventsPromise;

    const retryMsg = events.find(
      (e) => e.type === "text_delta" && (e as { type: "text_delta"; text: string }).text.includes("momentarily busy")
    );
    expect(retryMsg).toBeDefined();
    expect(events).toContainEqual({ type: "text_delta", text: "Sure, I updated it." });
    expect(mockStream).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it("on persistent 529: throws ClaudeApiError with overloaded message", async () => {
    vi.useFakeTimers();

    const APIError = await getMockAPIErrorCtor();
    mockStream.mockImplementation(() => { throw new APIError(529, "Overloaded"); });

    const { conversationalRefine } = await import("@/lib/claude");
    const resultPromise = collectEventsExpectThrow(
      conversationalRefine(
        [{ role: "user", content: "Test" }],
        "user-123",
        "2026-02-15"
      )
    );
    await vi.advanceTimersByTimeAsync(17000);
    const { error } = await resultPromise;

    expect(error).toMatchObject({ name: "CLAUDE_API_ERROR" });
    expect((error as Error).message).toContain("temporarily overloaded");

    vi.useRealTimers();
  });
});

// =============================================================================
// validateFoodAnalysis — notes defaults to empty string (FOO-773)
// =============================================================================

describe("validateFoodAnalysis — notes defaults to empty string", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("defaults notes to empty string when missing/undefined", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { notes, ...withoutNotes } = validAnalysis;
    const result = validateFoodAnalysis(withoutNotes);
    expect(result.notes).toBe("");
  });

  it("defaults notes to empty string when null", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, notes: null });
    expect(result.notes).toBe("");
  });

  it("preserves notes when valid string", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, notes: "Some notes here" });
    expect(result.notes).toBe("Some notes here");
  });
});

// =============================================================================
// validateFoodAnalysis — time and mealTypeId fields (FOO-715)
// =============================================================================

describe("validateFoodAnalysis — time and mealTypeId fields", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("accepts valid HH:mm time string", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, time: "08:30" });
    expect(result.time).toBe("08:30");
  });

  it("accepts null time", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, time: null });
    expect(result.time).toBeNull();
  });

  it("omitted time yields undefined (backwards compatible)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis });
    expect(result.time).toBeUndefined();
  });

  it("rejects invalid time format '25:00'", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, time: "25:00" })).toThrow();
  });

  it("rejects invalid time format 'abc'", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, time: "abc" })).toThrow();
  });

  it("rejects invalid time format '8:30' (missing leading zero)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, time: "8:30" })).toThrow();
  });

  it("accepts valid meal_type_id (1)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, meal_type_id: 1 });
    expect(result.mealTypeId).toBe(1);
  });

  it("accepts valid meal_type_id (7)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, meal_type_id: 7 });
    expect(result.mealTypeId).toBe(7);
  });

  it("accepts null meal_type_id", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, meal_type_id: null });
    expect(result.mealTypeId).toBeNull();
  });

  it("omitted meal_type_id yields undefined (backwards compatible)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis });
    expect(result.mealTypeId).toBeUndefined();
  });

  it("rejects meal_type_id outside valid range (0)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, meal_type_id: 0 })).toThrow();
  });

  it("rejects meal_type_id outside valid range (8)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, meal_type_id: 8 })).toThrow();
  });

  it("rejects meal_type_id = 6 (not a valid Fitbit meal type)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, meal_type_id: 6 })).toThrow();
  });
});

// =============================================================================
// validateFoodAnalysis — editingEntryId field (FOO-750)
// =============================================================================

describe("validateFoodAnalysis — editingEntryId field", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("sets editingEntryId when editing_entry_id is a positive integer", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, editing_entry_id: 42 });
    expect(result.editingEntryId).toBe(42);
  });

  it("omits editingEntryId when editing_entry_id is null", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, editing_entry_id: null });
    expect(result.editingEntryId).toBeUndefined();
  });

  it("omits editingEntryId when editing_entry_id is 0 (not a valid entry ID)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, editing_entry_id: 0 });
    expect(result.editingEntryId).toBeUndefined();
  });

  it("omits editingEntryId when editing_entry_id is absent", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis });
    expect(result.editingEntryId).toBeUndefined();
  });

  it("throws ClaudeApiError when editing_entry_id is negative", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, editing_entry_id: -5 })).toThrow();
  });

  it("throws ClaudeApiError when editing_entry_id is a string", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, editing_entry_id: "abc" })).toThrow();
  });
});

// =============================================================================
// validateFoodAnalysis — date field (FOO-769)
// =============================================================================

describe("validateFoodAnalysis — date field", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("accepts valid YYYY-MM-DD date string and includes it in result", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, date: "2026-02-20" });
    expect(result.date).toBe("2026-02-20");
  });

  it("accepts null date and includes null in result", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, date: null });
    expect(result.date).toBeNull();
  });

  it("omits date from result when undefined/missing", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis });
    expect(result).not.toHaveProperty("date");
  });

  it("rejects invalid date format (MM-DD)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, date: "02-20" })).toThrow();
  });

  it("rejects slash-separated date", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, date: "2026/02/20" })).toThrow();
  });

  it("rejects non-string non-null date", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, date: 12345 })).toThrow();
  });

  it("rejects date with invalid month", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, date: "2026-13-01" })).toThrow();
  });

  it("rejects date with invalid day", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    expect(() => validateFoodAnalysis({ ...validAnalysis, date: "2026-02-30" })).toThrow();
  });
});

// =============================================================================
// REPORT_NUTRITION_TOOL — date property (FOO-769)
// =============================================================================

describe("REPORT_NUTRITION_TOOL — date property", () => {
  afterEach(() => { vi.resetModules(); });

  it("schema includes date property with type string", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    const props = REPORT_NUTRITION_TOOL.input_schema.properties as Record<string, { type?: unknown }>;
    expect(props.date).toBeDefined();
    expect(props.date.type).toBe("string");
  });

  it("date is in required fields", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    expect(REPORT_NUTRITION_TOOL.input_schema.required).toContain("date");
  });
});

// =============================================================================
// convertMessages — date in Current values (FOO-769)
// =============================================================================

describe("convertMessages — date in Current values", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("includes date in [Current values] when analysis has date set", async () => {
    const { convertMessages } = await import("@/lib/claude");
    const messages = [
      { role: "assistant" as const, content: "Here it is", analysis: { ...validAnalysis, date: "2026-02-20" } },
    ];
    const result = convertMessages(messages);
    const content = result[0].content as Array<{ type: string; text?: string }>;
    const summaryBlock = content.find(b => b.type === "text" && b.text?.includes("[Current values:"));
    expect(summaryBlock?.text).toContain("date=2026-02-20");
  });

  it("includes mealTypeId in [Current values] when analysis has mealTypeId set", async () => {
    const { convertMessages } = await import("@/lib/claude");
    const messages = [
      { role: "assistant" as const, content: "Here it is", analysis: { ...validAnalysis, mealTypeId: 4 } },
    ];
    const result = convertMessages(messages);
    const content = result[0].content as Array<{ type: string; text?: string }>;
    const summaryBlock = content.find(b => b.type === "text" && b.text?.includes("[Current values:"));
    expect(summaryBlock?.text).toContain("meal_type_id=4");
  });

  it("does not include date in [Current values] when analysis has no date", async () => {
    const { convertMessages } = await import("@/lib/claude");
    const messages = [
      { role: "assistant" as const, content: "Here it is", analysis: validAnalysis },
    ];
    const result = convertMessages(messages);
    const content = result[0].content as Array<{ type: string; text?: string }>;
    const summaryBlock = content.find(b => b.type === "text" && b.text?.includes("[Current values:"));
    expect(summaryBlock?.text).not.toContain("date=");
  });
});

// =============================================================================
// CHAT_SYSTEM_PROMPT — edit-aware date/time/mealType rules (FOO-769)
// =============================================================================

describe("CHAT_SYSTEM_PROMPT — edit-aware date/time/mealType rules", () => {
  afterEach(() => { vi.resetModules(); });

  it("contains edit exception for meal_type_id mentioning editing_entry_id", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/editing.entry.id.*meal.type|meal.type.*editing.entry.id|edit.*preserv.*meal/i);
  });

  it("contains edit exception for time mentioning editing_entry_id", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/editing.entry.id.*time|time.*editing.entry.id|edit.*preserv.*time/i);
  });

  it("contains date field rules mentioning editing preservation", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toMatch(/date.*edit|edit.*date/i);
  });
});

// =============================================================================
// CHAT_SYSTEM_PROMPT — editing_entry_id reference (FOO-751)
// =============================================================================

describe("CHAT_SYSTEM_PROMPT — editing_entry_id field", () => {
  afterEach(() => { vi.resetModules(); });

  it("CHAT_SYSTEM_PROMPT contains editing_entry_id", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toContain("editing_entry_id");
  });

  it("CHAT_SYSTEM_PROMPT references [entry:N] for editing_entry_id", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toContain("[entry:N]");
  });

  it("CHAT_SYSTEM_PROMPT still references [id:N] for source_custom_food_id", async () => {
    const { CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toContain("[id:N]");
  });

  it("REPORT_NUTRITION_TOOL editing_entry_id description references [entry:N]", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    const props = REPORT_NUTRITION_TOOL.input_schema.properties as Record<string, { description?: string }>;
    expect(props.editing_entry_id.description).toContain("[entry:N]");
  });
});

// =============================================================================
// convertMessages — shared message conversion helper (FOO-740)
// =============================================================================

describe("convertMessages", () => {
  afterEach(() => { vi.resetModules(); });

  it("converts text-only ConversationMessages to Anthropic MessageParams", async () => {
    const { convertMessages } = await import("@/lib/claude");
    const messages = [
      { role: "user" as const, content: "Hello" },
      { role: "assistant" as const, content: "Hi there" },
    ];
    const result = convertMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect((result[0].content as Array<{ type: string; text?: string }>)).toContainEqual({ type: "text", text: "Hello" });
    expect(result[1].role).toBe("assistant");
    expect((result[1].content as Array<{ type: string; text?: string }>)).toContainEqual({ type: "text", text: "Hi there" });
  });

  it("attaches images before text for user messages with images", async () => {
    const { convertMessages } = await import("@/lib/claude");
    const messages = [
      { role: "user" as const, content: "Here's the photo", images: ["img_data_1"] },
    ];
    const result = convertMessages(messages);
    const content = result[0].content as Array<{ type: string; source?: { data: string } }>;
    expect(content[0].type).toBe("image");
    expect(content[0].source?.data).toBe("img_data_1");
    expect(content[1].type).toBe("text");
  });

  it("injects [Current values:] summary for assistant messages with analysis", async () => {
    const { convertMessages } = await import("@/lib/claude");
    const messages = [
      { role: "assistant" as const, content: "Got it", analysis: validAnalysis },
    ];
    const result = convertMessages(messages);
    const content = result[0].content as Array<{ type: string; text?: string }>;
    const summaryBlock = content.find(b => b.type === "text" && b.text?.includes("[Current values:"));
    expect(summaryBlock).toBeDefined();
    expect(summaryBlock?.text).toContain(validAnalysis.food_name);
    expect(summaryBlock?.text).toContain(String(validAnalysis.calories));
  });

  it("includes Tier 1 nutrients in [Current values:] when present", async () => {
    const { convertMessages } = await import("@/lib/claude");
    const analysisWithTier1 = {
      ...validAnalysis,
      saturated_fat_g: 5.5,
      trans_fat_g: 0.2,
      sugars_g: 3.0,
      calories_from_fat: 162,
    };
    const messages = [
      { role: "assistant" as const, content: "Got it", analysis: analysisWithTier1 },
    ];
    const result = convertMessages(messages);
    const content = result[0].content as Array<{ type: string; text?: string }>;
    const summaryBlock = content.find(b => b.type === "text" && b.text?.includes("[Current values:"));
    expect(summaryBlock?.text).toContain("saturated_fat_g=5.5");
    expect(summaryBlock?.text).toContain("trans_fat_g=0.2");
    expect(summaryBlock?.text).toContain("sugars_g=3");
    expect(summaryBlock?.text).toContain("calories_from_fat=162");
  });

  it("does not add image blocks for assistant messages", async () => {
    const { convertMessages } = await import("@/lib/claude");
    const messages = [
      { role: "assistant" as const, content: "Got it", analysis: validAnalysis },
    ];
    const result = convertMessages(messages);
    const content = result[0].content as Array<{ type: string }>;
    expect(content.every(b => b.type === "text")).toBe(true);
  });

  it("produces empty content array for message with no text and no images", async () => {
    const { convertMessages } = await import("@/lib/claude");
    const messages = [
      { role: "user" as const, content: "" },
    ];
    const result = convertMessages(messages);
    expect(result[0].content).toHaveLength(0);
  });
});

// =============================================================================
// Dynamic system prompt functions
// =============================================================================

describe("getSystemPrompt", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("returns base SYSTEM_PROMPT when buildUserProfile returns null", async () => {
    mockBuildUserProfile.mockResolvedValue(null);
    const { getSystemPrompt, SYSTEM_PROMPT } = await import("@/lib/claude");
    const result = await getSystemPrompt("user-1", "2026-03-09");
    expect(result).toBe(SYSTEM_PROMPT);
  });

  it("appends profile block when buildUserProfile returns data", async () => {
    mockBuildUserProfile.mockResolvedValue("User profile: Targets 2200 cal/day.");
    const { getSystemPrompt, SYSTEM_PROMPT } = await import("@/lib/claude");
    const result = await getSystemPrompt("user-1", "2026-03-09");
    expect(result).toContain(SYSTEM_PROMPT);
    expect(result).toContain("User profile: Targets 2200 cal/day.");
    // Profile appears after base prompt
    expect(result.indexOf(SYSTEM_PROMPT)).toBeLessThan(result.indexOf("User profile:"));
  });

  it("falls back to base SYSTEM_PROMPT when buildUserProfile throws", async () => {
    mockBuildUserProfile.mockRejectedValue(new Error("DB connection failed"));
    const { getSystemPrompt, SYSTEM_PROMPT } = await import("@/lib/claude");
    const result = await getSystemPrompt("user-1", "2026-03-09");
    expect(result).toBe(SYSTEM_PROMPT);
  });
});

describe("getAnalysisSystemPrompt", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("contains role-specific analysis instructions with profile", async () => {
    mockBuildUserProfile.mockResolvedValue("User profile: Targets 2200 cal/day.");
    const { getAnalysisSystemPrompt } = await import("@/lib/claude");
    const result = await getAnalysisSystemPrompt("user-1", "2026-03-09");
    expect(result).toContain("User profile: Targets 2200 cal/day.");
    expect(result).toContain("single-entry constraint");
  });

  it("contains analysis instructions without profile for new user", async () => {
    mockBuildUserProfile.mockResolvedValue(null);
    const { getAnalysisSystemPrompt, ANALYSIS_SYSTEM_PROMPT } = await import("@/lib/claude");
    const result = await getAnalysisSystemPrompt("user-1", "2026-03-09");
    expect(result).toBe(ANALYSIS_SYSTEM_PROMPT);
  });
});

describe("getChatSystemPrompt", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("contains role-specific chat instructions with profile", async () => {
    mockBuildUserProfile.mockResolvedValue("User profile: Targets 2200 cal/day.");
    const { getChatSystemPrompt } = await import("@/lib/claude");
    const result = await getChatSystemPrompt("user-1", "2026-03-09");
    expect(result).toContain("User profile: Targets 2200 cal/day.");
    expect(result).toContain("friendly nutrition advisor");
  });
});

describe("getEditSystemPrompt", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("contains role-specific edit instructions with profile", async () => {
    mockBuildUserProfile.mockResolvedValue("User profile: Targets 2200 cal/day.");
    const { getEditSystemPrompt } = await import("@/lib/claude");
    const result = await getEditSystemPrompt("user-1", "2026-03-09");
    expect(result).toContain("User profile: Targets 2200 cal/day.");
    expect(result).toContain("existing food log entry");
  });

  it("profile appears between base prompt and role instructions", async () => {
    mockBuildUserProfile.mockResolvedValue("User profile: Targets 2200 cal/day.");
    const { getEditSystemPrompt, SYSTEM_PROMPT } = await import("@/lib/claude");
    const result = await getEditSystemPrompt("user-1", "2026-03-09");
    const baseIdx = result.indexOf(SYSTEM_PROMPT);
    const profileIdx = result.indexOf("User profile:");
    const roleIdx = result.indexOf("existing food log entry");
    expect(baseIdx).toBeLessThan(profileIdx);
    expect(profileIdx).toBeLessThan(roleIdx);
  });
});

// =============================================================================
// Profile integration into API functions
// =============================================================================

describe("analyzeFood profile integration", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("includes user profile in system prompt when available", async () => {
    mockBuildUserProfile.mockResolvedValue("User profile: Targets 2200 cal/day.");
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-03-09"));

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain("User profile: Targets 2200 cal/day.");
  });

  it("uses base prompt without profile for new user", async () => {
    mockBuildUserProfile.mockResolvedValue(null);
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood, ANALYSIS_SYSTEM_PROMPT } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], undefined, "user-123", "2026-03-09"));

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain(ANALYSIS_SYSTEM_PROMPT);
    expect(call.system[0].text).not.toContain("User profile:");
  });
});

describe("conversationalRefine profile integration", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("includes user profile in system prompt when userId and currentDate provided", async () => {
    mockBuildUserProfile.mockResolvedValue("User profile: Targets 2200 cal/day.");
    mockStream.mockReturnValueOnce(makeTextStream("Sure!"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(conversationalRefine(
      [{ role: "user", content: "Hello" }],
      "user-123",
      "2026-03-09",
    ));

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain("User profile: Targets 2200 cal/day.");
  });

  it("falls back to static prompt when userId is undefined", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Sure!"));

    const { conversationalRefine, CHAT_SYSTEM_PROMPT } = await import("@/lib/claude");
    await collectEvents(conversationalRefine(
      [{ role: "user", content: "Hello" }],
    ));

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain(CHAT_SYSTEM_PROMPT);
    expect(mockBuildUserProfile).not.toHaveBeenCalled();
  });
});

describe("editAnalysis profile integration", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("includes user profile in system prompt", async () => {
    mockBuildUserProfile.mockResolvedValue("User profile: Targets 2200 cal/day.");
    mockStream.mockReturnValueOnce(makeTextStream("Updated!"));

    const entry: FoodLogEntryDetail = {
      id: 1, customFoodId: 1, foodName: "Empanada", amount: 150, unitId: "g",
      description: null, healthLogId: null, isFavorite: false, keywords: [],
      calories: 320, proteinG: 12, carbsG: 28, fatG: 18, fiberG: 2, sodiumMg: 450,
      saturatedFatG: null, transFatG: null, sugarsG: null, caloriesFromFat: null,
      confidence: "high", notes: null, date: "2026-03-09", time: "12:00",
      mealTypeId: 3,
    };

    const { editAnalysis } = await import("@/lib/claude");
    await collectEvents(editAnalysis(
      [{ role: "user", content: "Change to 200g" }],
      entry, "user-123", "2026-03-09",
    ));

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain("User profile: Targets 2200 cal/day.");
  });
});

describe("runToolLoop profile integration", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("uses dynamic chat prompt when no custom systemPrompt", async () => {
    mockBuildUserProfile.mockResolvedValue("User profile: Targets 2200 cal/day.");
    mockStream.mockReturnValueOnce(makeTextStream("Here's your info"));

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(runToolLoop(
      [{ role: "user", content: [{ type: "text", text: "What did I eat?" }] }],
      "user-123",
      "2026-03-09",
    ));

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain("User profile: Targets 2200 cal/day.");
  });

  it("does not override custom systemPrompt", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("Done"));

    const { runToolLoop } = await import("@/lib/claude");
    await collectEvents(runToolLoop(
      [{ role: "user", content: [{ type: "text", text: "test" }] }],
      "user-123",
      "2026-03-09",
      { systemPrompt: "Custom prompt" },
    ));

    const call = mockStream.mock.calls[0][0];
    expect(call.system[0].text).toContain("Custom prompt");
    expect(mockBuildUserProfile).not.toHaveBeenCalled();
  });
});

// =============================================================================
// validateFoodAnalysis — confidence coercion (FOO-862)
// =============================================================================

describe("validateFoodAnalysis — confidence coercion", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("coerces undefined confidence to medium", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { confidence, ...withoutConfidence } = validAnalysis;
    const result = validateFoodAnalysis(withoutConfidence);
    expect(result.confidence).toBe("medium");
  });

  it("coerces invalid string confidence to medium", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, confidence: "VERY_HIGH" });
    expect(result.confidence).toBe("medium");
  });

  it("coerces non-string confidence to medium", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, confidence: 123 });
    expect(result.confidence).toBe("medium");
  });

  it("preserves valid confidence", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, confidence: "high" });
    expect(result.confidence).toBe("high");
  });
});

// =============================================================================
// validateFoodAnalysis — keywords coercion (FOO-862)
// =============================================================================

describe("validateFoodAnalysis — keywords coercion", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("coerces string keywords to array", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, keywords: "empanada" });
    expect(result.keywords).toEqual(["empanada"]);
  });

  it("normalizes coerced string keywords", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, keywords: "  Empanada  " });
    expect(result.keywords).toEqual(["empanada"]);
  });

  it("derives keywords from food_name when null", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, keywords: null });
    expect(result.keywords).toEqual(["empanada", "de", "carne"]);
  });

  it("derives keywords from food_name when undefined", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { keywords, ...withoutKeywords } = validAnalysis;
    const result = validateFoodAnalysis(withoutKeywords);
    expect(result.keywords).toEqual(["empanada", "de", "carne"]);
  });

  it("derives keywords from food_name when non-string non-array", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, keywords: 123 });
    expect(result.keywords).toEqual(["empanada", "de", "carne"]);
  });

  it("derives keywords from food_name when empty array", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, keywords: [] });
    expect(result.keywords).toEqual(["empanada", "de", "carne"]);
  });

  it("filters non-string array elements and falls back to food_name", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, keywords: [123, true] });
    expect(result.keywords).toEqual(["empanada", "de", "carne"]);
  });

  it("preserves valid keywords array", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, keywords: ["cerveza", "sin-alcohol"] });
    expect(result.keywords).toEqual(["cerveza", "sin-alcohol"]);
  });
});

// =============================================================================
// REPORT_NUTRITION_TOOL — serving_unit schema migration (Task 21)
// =============================================================================

describe("REPORT_NUTRITION_TOOL — serving_unit schema (Task 21)", () => {
  afterEach(() => { vi.resetModules(); });

  it("schema has serving_unit string property, not unit_id", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    const props = REPORT_NUTRITION_TOOL.input_schema.properties as Record<string, Record<string, unknown>>;
    expect(props).toHaveProperty("serving_unit");
    expect(props).not.toHaveProperty("unit_id");
  });

  it("serving_unit has type 'string' with enum of 8 members", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    const props = REPORT_NUTRITION_TOOL.input_schema.properties as Record<string, Record<string, unknown>>;
    expect(props.serving_unit.type).toBe("string");
    const enumValues = props.serving_unit.enum as string[];
    expect(enumValues).toEqual(expect.arrayContaining(["g", "oz", "cup", "tbsp", "tsp", "ml", "slice", "serving"]));
    expect(enumValues).toHaveLength(8);
  });

  it("required includes serving_unit, not unit_id", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    expect(REPORT_NUTRITION_TOOL.input_schema.required).toContain("serving_unit");
    expect(REPORT_NUTRITION_TOOL.input_schema.required).not.toContain("unit_id");
  });

  it("input_examples use serving_unit strings, not numeric unit_ids", async () => {
    const { REPORT_NUTRITION_TOOL } = await import("@/lib/claude");
    const examples = REPORT_NUTRITION_TOOL.input_examples as Array<Record<string, unknown>>;
    expect(examples).toBeDefined();
    expect(examples.length).toBeGreaterThan(0);
    for (const ex of examples) {
      expect(ex).toHaveProperty("serving_unit");
      expect(typeof ex.serving_unit).toBe("string");
      expect(ex).not.toHaveProperty("unit_id");
    }
  });
});

// =============================================================================
// REPORT_SESSION_ITEMS_TOOL — serving_unit schema migration (Task 21)
// =============================================================================

describe("REPORT_SESSION_ITEMS_TOOL — serving_unit schema (Task 21)", () => {
  afterEach(() => { vi.resetModules(); });

  it("items sub-schema has serving_unit property, not unit_id", async () => {
    const { REPORT_SESSION_ITEMS_TOOL } = await import("@/lib/claude");
    const itemsArraySchema = (REPORT_SESSION_ITEMS_TOOL.input_schema.properties as Record<string, Record<string, unknown>>)
      .items as Record<string, unknown>;
    const itemProps = (itemsArraySchema.items as Record<string, unknown>).properties as Record<string, unknown>;
    expect(itemProps).toHaveProperty("serving_unit");
    expect(itemProps).not.toHaveProperty("unit_id");
  });

  it("items required includes serving_unit, not unit_id", async () => {
    const { REPORT_SESSION_ITEMS_TOOL } = await import("@/lib/claude");
    const itemsArraySchema = (REPORT_SESSION_ITEMS_TOOL.input_schema.properties as Record<string, Record<string, unknown>>)
      .items as Record<string, unknown>;
    const itemRequired = (itemsArraySchema.items as Record<string, unknown>).required as string[];
    expect(itemRequired).toContain("serving_unit");
    expect(itemRequired).not.toContain("unit_id");
  });
});

// =============================================================================
// validateFoodAnalysis — serving_unit coercion (Task 21)
// =============================================================================

describe("validateFoodAnalysis — serving_unit coercion (Task 21)", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("serving_unit 'cup' → result.unit_id === 'cup'", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, serving_unit: "cup" });
    expect(result.unit_id).toBe("cup");
  });

  it("missing serving_unit falls back to unit_id when present (no throw)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    // validAnalysis has unit_id: 'g' but no serving_unit — falls back to unit_id
    const result = validateFoodAnalysis({ ...validAnalysis });
    expect(result.unit_id).toBe("g");
  });

  it("missing serving_unit AND missing unit_id coerces to 'serving' (no throw)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    // No serving_unit, no unit_id — defaults to 'serving'
    const withoutUnit: Record<string, unknown> = { ...validAnalysis };
    delete withoutUnit.unit_id;
    const result = validateFoodAnalysis({ ...withoutUnit });
    expect(result.unit_id).toBe("serving");
  });

  it("invalid serving_unit 'bogus' coerces to 'serving' (no throw)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, serving_unit: "bogus" });
    expect(result.unit_id).toBe("serving");
  });

  it("numeric serving_unit (legacy 147) coerces to 'g' (no throw)", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const result = validateFoodAnalysis({ ...validAnalysis, serving_unit: 147 });
    expect(result.unit_id).toBe("g");
  });

  it("accepts all 8 valid ServingUnit string members", async () => {
    const { validateFoodAnalysis } = await import("@/lib/claude");
    const units = ["g", "oz", "cup", "tbsp", "tsp", "ml", "slice", "serving"];
    for (const unit of units) {
      const result = validateFoodAnalysis({ ...validAnalysis, serving_unit: unit });
      expect(result.unit_id).toBe(unit);
    }
  });
});

// =============================================================================
// validateSessionItems — serving_unit passthrough (Task 21)
// =============================================================================

describe("validateSessionItems — serving_unit passthrough (Task 21)", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("item with serving_unit 'oz' → unit_id === 'oz'", async () => {
    const { validateSessionItems } = await import("@/lib/claude");
    const items = [{ ...validAnalysis, serving_unit: "oz" }];
    const results = validateSessionItems(items);
    expect(results).toHaveLength(1);
    expect(results[0].unit_id).toBe("oz");
  });

  it("filters out null items, keeps valid ones with serving_unit", async () => {
    const { validateSessionItems } = await import("@/lib/claude");
    const items = [
      { ...validAnalysis, serving_unit: "g" },
      null,
      { ...validAnalysis, serving_unit: "slice" },
    ];
    const results = validateSessionItems(items);
    expect(results).toHaveLength(2);
    expect(results[0].unit_id).toBe("g");
    expect(results[1].unit_id).toBe("slice");
  });
});

// =============================================================================
// A3: beta context-management stream (Task 25)
// =============================================================================

describe("A3: beta context-management stream (Task 25)", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("A3: analyzeFood calls beta.messages.stream with betas including context-management-2025-06-27", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], "empanada", "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.betas).toBeDefined();
    expect(call.betas).toContain("context-management-2025-06-27");
  });

  it("A3: analyzeFood carries context_management.edits with clear_tool_uses_20250919 excluding web_search", async () => {
    mockStream.mockReturnValueOnce(makeReportNutritionStream(rawToolInput));

    const { analyzeFood } = await import("@/lib/claude");
    await collectEvents(analyzeFood([], "empanada", "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.context_management).toBeDefined();
    const edit = call.context_management?.edits?.[0];
    expect(edit?.type).toBe("clear_tool_uses_20250919");
    expect(edit?.exclude_tools).toContain("web_search");
  });

  it("A3: conversationalRefine carries betas and context_management", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    await collectEvents(conversationalRefine([{ role: "user", content: "test" }], "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    expect(call.betas).toContain("context-management-2025-06-27");
    expect(call.context_management?.edits?.[0]?.type).toBe("clear_tool_uses_20250919");
  });

  it("A3: triageRefine carries betas and context_management", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { triageRefine } = await import("@/lib/claude");
    await collectEvents(triageRefine([{ role: "user", content: "test" }], "user-123"));

    const call = mockStream.mock.calls[0][0];
    expect(call.betas).toContain("context-management-2025-06-27");
    expect(call.context_management?.edits?.[0]?.type).toBe("clear_tool_uses_20250919");
  });

  it("A3: 40-message conversation passes all messages (no client-side truncation)", async () => {
    mockStream.mockReturnValueOnce(makeTextStream("OK"));

    const { conversationalRefine } = await import("@/lib/claude");
    // Build 40 alternating user/assistant messages
    const messages = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0
        ? { role: "user" as const, content: `user turn ${i}` }
        : { role: "assistant" as const, content: `assistant turn ${i}` }
    );
    await collectEvents(conversationalRefine(messages, "user-123", "2026-02-15"));

    const call = mockStream.mock.calls[0][0];
    // All 40 messages should be in the request (no truncation)
    expect(call.messages).toHaveLength(40);
  });

  it("A3: truncateConversation is not exported from claude module", async () => {
    const claudeModule = await import("@/lib/claude");
    expect((claudeModule as Record<string, unknown>).truncateConversation).toBeUndefined();
  });
});

// =============================================================================
// Task 26: role-prompt decoupling (characterization tests — pass before and after)
// =============================================================================

describe("Task 26: role-instructions characterization", () => {
  beforeEach(() => { setupMocks(); });
  afterEach(() => { vi.resetModules(); });

  it("ANALYSIS_ROLE_INSTRUCTIONS is exported and non-empty", async () => {
    const { ANALYSIS_ROLE_INSTRUCTIONS } = await import("@/lib/claude");
    expect(typeof ANALYSIS_ROLE_INSTRUCTIONS).toBe("string");
    expect(ANALYSIS_ROLE_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it("CHAT_ROLE_INSTRUCTIONS is exported and non-empty", async () => {
    const { CHAT_ROLE_INSTRUCTIONS } = await import("@/lib/claude");
    expect(typeof CHAT_ROLE_INSTRUCTIONS).toBe("string");
    expect(CHAT_ROLE_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it("EDIT_ROLE_INSTRUCTIONS is exported and non-empty", async () => {
    const { EDIT_ROLE_INSTRUCTIONS } = await import("@/lib/claude");
    expect(typeof EDIT_ROLE_INSTRUCTIONS).toBe("string");
    expect(EDIT_ROLE_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it("ANALYSIS_SYSTEM_PROMPT equals SYSTEM_PROMPT + ANALYSIS_ROLE_INSTRUCTIONS", async () => {
    const { ANALYSIS_SYSTEM_PROMPT, SYSTEM_PROMPT, ANALYSIS_ROLE_INSTRUCTIONS } = await import("@/lib/claude");
    expect(ANALYSIS_SYSTEM_PROMPT).toBe(`${SYSTEM_PROMPT}${ANALYSIS_ROLE_INSTRUCTIONS}`);
  });

  it("CHAT_SYSTEM_PROMPT equals SYSTEM_PROMPT + CHAT_ROLE_INSTRUCTIONS", async () => {
    const { CHAT_SYSTEM_PROMPT, SYSTEM_PROMPT, CHAT_ROLE_INSTRUCTIONS } = await import("@/lib/claude");
    expect(CHAT_SYSTEM_PROMPT).toBe(`${SYSTEM_PROMPT}${CHAT_ROLE_INSTRUCTIONS}`);
  });

  it("EDIT_SYSTEM_PROMPT equals SYSTEM_PROMPT + EDIT_ROLE_INSTRUCTIONS", async () => {
    const { EDIT_SYSTEM_PROMPT, SYSTEM_PROMPT, EDIT_ROLE_INSTRUCTIONS } = await import("@/lib/claude");
    expect(EDIT_SYSTEM_PROMPT).toBe(`${SYSTEM_PROMPT}${EDIT_ROLE_INSTRUCTIONS}`);
  });
});

// =============================================================================
// Task 26: mapStopReasonToError helper
// =============================================================================

describe("Task 26: mapStopReasonToError", () => {
  afterEach(() => { vi.resetModules(); });

  it("returns non-null message for model_context_window_exceeded", async () => {
    const { mapStopReasonToError } = await import("@/lib/claude");
    const result = mapStopReasonToError("model_context_window_exceeded");
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
  });

  it("returns non-null message for refusal", async () => {
    const { mapStopReasonToError } = await import("@/lib/claude");
    const result = mapStopReasonToError("refusal");
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
  });

  it("returns non-null message for max_tokens", async () => {
    const { mapStopReasonToError } = await import("@/lib/claude");
    const result = mapStopReasonToError("max_tokens");
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
  });

  it("returns null for end_turn", async () => {
    const { mapStopReasonToError } = await import("@/lib/claude");
    expect(mapStopReasonToError("end_turn")).toBeNull();
  });

  it("returns null for tool_use", async () => {
    const { mapStopReasonToError } = await import("@/lib/claude");
    expect(mapStopReasonToError("tool_use")).toBeNull();
  });
});
