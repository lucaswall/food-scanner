import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { Logger } from "@/lib/logger";
import { createStreamWithRetry } from "@/lib/claude";

vi.mock("@/lib/claude-usage", () => ({ recordUsage: vi.fn().mockResolvedValue(undefined) }));

// Exercises the REAL @anthropic-ai/sdk (no SDK mock) so wrappers around the client that break
// the SDK's own stream handling are caught. FOO-1179: Sentry.instrumentAnthropicAiClient replaced
// the SDK Stream inside beta.messages.stream() and every stream threw
// "Cannot read properties of undefined (reading 'signal')" after the last event.

const SSE_EVENTS = [
  { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: "claude-test", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 0 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
  { type: "message_stop" },
];

const fetchMock = vi.fn(async () =>
  new Response(SSE_EVENTS.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  }),
);

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

describe("createStreamWithRetry with the real Anthropic SDK", () => {
  beforeAll(() => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetchMock);
    // jsdom exposes window + navigator, which the SDK treats as a browser and refuses to run in
    vi.stubGlobal("navigator", undefined);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("streams text deltas and returns the final message (FOO-1179)", async () => {
    const generator = createStreamWithRetry(
      { model: "claude-test", max_tokens: 16, messages: [{ role: "user", content: "hi" }] },
      { signal: new AbortController().signal },
      log,
    );

    const events = [];
    let result = await generator.next();
    while (!result.done) {
      events.push(result.value);
      result = await generator.next();
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ type: "text_delta", text: "Hello" }]);
    expect(result.value.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(result.value.stop_reason).toBe("end_turn");
  });
});
