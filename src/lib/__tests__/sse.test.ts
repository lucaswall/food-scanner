import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatSSEEvent,
  createSSEResponse,
  parseSSEEvents,
  type StreamEvent,
} from "@/lib/sse";

// Mock logger for error-handling tests
vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { logger } from "@/lib/logger";

describe("formatSSEEvent", () => {
  it("formats text_delta event as SSE data line with double newline", () => {
    const event: StreamEvent = { type: "text_delta", text: "hello" };
    const result = formatSSEEvent(event);
    expect(result).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("formats tool_start event correctly", () => {
    const event: StreamEvent = { type: "tool_start", tool: "analyze_food" };
    const result = formatSSEEvent(event);
    expect(result).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("formats done event correctly", () => {
    const event: StreamEvent = { type: "done" };
    const result = formatSSEEvent(event);
    expect(result).toBe('data: {"type":"done"}\n\n');
  });

  it("formats error event correctly", () => {
    const event: StreamEvent = { type: "error", message: "Something failed", code: "INTERNAL_ERROR" };
    const result = formatSSEEvent(event);
    expect(result).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("formats analysis event with full FoodAnalysis", () => {
    const event: StreamEvent = {
      type: "analysis",
      analysis: {
        food_name: "Apple",
        amount: 1,
        unit_id: 304,
        calories: 95,
        protein_g: 0.5,
        carbs_g: 25,
        fat_g: 0.3,
        fiber_g: 4,
        sodium_mg: 1,
        saturated_fat_g: null,
        trans_fat_g: null,
        sugars_g: 19,
        calories_from_fat: null,
        confidence: "high",
        notes: "",
        description: "A medium apple",
        keywords: ["fruit", "apple"],
      },
    };
    const result = formatSSEEvent(event);
    expect(result).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("formats needs_chat event correctly", () => {
    const event: StreamEvent = { type: "needs_chat", message: "Need more info" };
    const result = formatSSEEvent(event);
    expect(result).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it("formats usage event correctly", () => {
    const event: StreamEvent = {
      type: "usage",
      data: {
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 20,
        cacheReadTokens: 30,
      },
    };
    const result = formatSSEEvent(event);
    expect(result).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });
});

describe("createSSEResponse", () => {
  it("returns a Response with Content-Type: text/event-stream", async () => {
    async function* emptyGen(): AsyncGenerator<StreamEvent> {}
    const response = createSSEResponse(emptyGen());
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("returns a Response with Cache-Control: no-cache", async () => {
    async function* emptyGen(): AsyncGenerator<StreamEvent> {}
    const response = createSSEResponse(emptyGen());
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("returns a Response with Connection: keep-alive", async () => {
    async function* emptyGen(): AsyncGenerator<StreamEvent> {}
    const response = createSSEResponse(emptyGen());
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });

  it("streams events from the async generator as SSE data", async () => {
    async function* gen(): AsyncGenerator<StreamEvent> {
      yield { type: "text_delta", text: "hello" };
      yield { type: "done" };
    }

    const response = createSSEResponse(gen());
    const text = await response.text();

    const event1: StreamEvent = { type: "text_delta", text: "hello" };
    const event2: StreamEvent = { type: "done" };

    expect(text).toBe(
      `data: ${JSON.stringify(event1)}\n\ndata: ${JSON.stringify(event2)}\n\n`
    );
  });

  it("handles an empty generator (no events)", async () => {
    async function* emptyGen(): AsyncGenerator<StreamEvent> {}
    const response = createSSEResponse(emptyGen());
    const text = await response.text();
    expect(text).toBe("");
  });
});

describe("parseSSEEvents", () => {
  it("parses a single complete SSE event from a chunk", () => {
    const event: StreamEvent = { type: "done" };
    const chunk = `data: ${JSON.stringify(event)}\n\n`;
    const result = parseSSEEvents(chunk, "");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(event);
    expect(result.remaining).toBe("");
  });

  it("parses multiple complete SSE events from a single chunk", () => {
    const event1: StreamEvent = { type: "text_delta", text: "hello" };
    const event2: StreamEvent = { type: "done" };
    const chunk = `data: ${JSON.stringify(event1)}\n\ndata: ${JSON.stringify(event2)}\n\n`;
    const result = parseSSEEvents(chunk, "");
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toEqual(event1);
    expect(result.events[1]).toEqual(event2);
    expect(result.remaining).toBe("");
  });

  it("returns remaining buffer when chunk ends mid-event", () => {
    const event: StreamEvent = { type: "text_delta", text: "hello world" };
    const fullData = `data: ${JSON.stringify(event)}\n\n`;
    // Split mid-event
    const chunk1 = fullData.slice(0, 20);
    const chunk2 = fullData.slice(20);

    const result1 = parseSSEEvents(chunk1, "");
    expect(result1.events).toHaveLength(0);
    expect(result1.remaining).toBe(chunk1);

    const result2 = parseSSEEvents(chunk2, result1.remaining);
    expect(result2.events).toHaveLength(1);
    expect(result2.events[0]).toEqual(event);
    expect(result2.remaining).toBe("");
  });

  it("handles partial chunk followed by complete chunk", () => {
    const event1: StreamEvent = { type: "tool_start", tool: "analyze_food" };
    const event2: StreamEvent = { type: "done" };
    const fullChunk1 = `data: ${JSON.stringify(event1)}\n\n`;
    const fullChunk2 = `data: ${JSON.stringify(event2)}\n\n`;

    // First chunk is partial
    const partialChunk = fullChunk1.slice(0, 15);
    const rest = fullChunk1.slice(15) + fullChunk2;

    const result1 = parseSSEEvents(partialChunk, "");
    expect(result1.events).toHaveLength(0);

    const result2 = parseSSEEvents(rest, result1.remaining);
    expect(result2.events).toHaveLength(2);
    expect(result2.events[0]).toEqual(event1);
    expect(result2.events[1]).toEqual(event2);
    expect(result2.remaining).toBe("");
  });

  it("uses the existing buffer correctly when combining with new chunk", () => {
    const event: StreamEvent = { type: "text_delta", text: "ab" };
    const fullData = `data: ${JSON.stringify(event)}\n\n`;
    // We'll split exactly at the midpoint
    const mid = Math.floor(fullData.length / 2);
    const chunk1 = fullData.slice(0, mid);
    const chunk2 = fullData.slice(mid);

    const result1 = parseSSEEvents(chunk1, "");
    const result2 = parseSSEEvents(chunk2, result1.remaining);
    expect(result2.events).toHaveLength(1);
    expect(result2.events[0]).toEqual(event);
  });

  it("skips non-data lines in SSE stream", () => {
    // SSE can have comment lines starting with ':'
    const event: StreamEvent = { type: "done" };
    const chunk = `: keep-alive\n\ndata: ${JSON.stringify(event)}\n\n`;
    const result = parseSSEEvents(chunk, "");
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual(event);
  });
});

describe("createSSEResponse - error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends generic error message to client when generator throws, does not leak internal details", async () => {
    const internalError = new Error("db connection: password authentication failed for user postgres");

    async function* badGenerator(): AsyncGenerator<StreamEvent> {
      throw internalError;
    }

    const response = createSSEResponse(badGenerator());
    const text = await response.text();
    const { events } = parseSSEEvents(text, "");

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.type).toBe("error");

    const msg = (errorEvent as { type: "error"; message: string }).message;
    // Must NOT expose internal error details to the client
    expect(msg).not.toContain("password authentication");
    expect(msg).not.toContain("failed for user postgres");
    // Must use a generic message
    expect(msg).toBe("An internal error occurred");
  });

  it("does not throw when generator errors after stream is cancelled", async () => {
    // In production, if the client disconnects and the generator throws,
    // controller.enqueue()/close() in the catch block can throw on the cancelled stream.
    // The defensive guard wraps them in a nested try/catch.
    // jsdom's ReadableStream handles this gracefully, so we verify the response
    // is consumable without unhandled rejections after cancel + generator error.
    async function* throwingGen(): AsyncGenerator<StreamEvent> {
      throw new Error("Generator error after disconnect");
    }

    const response = createSSEResponse(throwingGen());
    const reader = response.body!.getReader();

    // Cancel (simulates client disconnect) then consume remaining
    await reader.cancel();

    // If the guard is missing in production, controller.enqueue/close throw
    // after cancel. Verify no unhandled rejections by waiting a tick.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("logs the actual error server-side when generator throws", async () => {
    const internalError = new Error("Internal database failure at row 42");

    async function* badGenerator(): AsyncGenerator<StreamEvent> {
      throw internalError;
    }

    const response = createSSEResponse(badGenerator());
    await response.text();

    // Must log the actual error server-side with pino
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: internalError }),
      expect.any(String),
    );
  });

  it("logs client-disconnect TypeError at warn level, not error", async () => {
    // In production, controller.enqueue() throws TypeError when client disconnects.
    // Simulate by having the generator throw a TypeError with the controller message.
    const disconnectError = new TypeError("Failed to execute 'enqueue' on 'ReadableStreamDefaultController': Cannot enqueue a chunk into a closed readable stream");

    async function* disconnectGen(): AsyncGenerator<StreamEvent> {
      throw disconnectError;
    }

    const response = createSSEResponse(disconnectGen());
    await response.text();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: disconnectError }),
      expect.stringContaining("disconnect"),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs non-controller TypeError at error level, not warn", async () => {
    // A TypeError from inside the generator (programming bug) should still be error level.
    const generatorBug = new TypeError("Cannot read properties of null (reading 'content')");

    async function* buggyGen(): AsyncGenerator<StreamEvent> {
      throw generatorBug;
    }

    const response = createSSEResponse(buggyGen());
    await response.text();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: generatorBug }),
      expect.any(String),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("sends the actual error message and AI_OVERLOADED code when generator throws an overloaded error", async () => {
    const overloadedError = Object.assign(
      new Error("Claude API is currently overloaded, please try again later"),
      { name: "CLAUDE_API_ERROR" },
    );

    async function* overloadedGenerator(): AsyncGenerator<StreamEvent> {
      throw overloadedError;
    }

    const response = createSSEResponse(overloadedGenerator());
    const text = await response.text();
    const { events } = parseSSEEvents(text, "");

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();

    const typedEvent = errorEvent as { type: "error"; message: string; code?: string };
    // Must pass through the actual error message (not a generic one)
    expect(typedEvent.message).toBe(overloadedError.message);
    expect(typedEvent.message).not.toBe("An internal error occurred");
    // Must use AI_OVERLOADED code
    expect(typedEvent.code).toBe("AI_OVERLOADED");
  });
});
