import type { FoodAnalysis } from "@/types";
import { logger } from "@/lib/logger";

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; tool: string }
  | { type: "analysis"; analysis: FoodAnalysis }
  | { type: "needs_chat"; message: string }
  | {
      type: "usage";
      data: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationTokens: number;
        cacheReadTokens: number;
      };
    }
  | { type: "error"; message: string; code?: string }
  | { type: "done" };

export function formatSSEEvent(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function createSSEResponse(
  generator: AsyncGenerator<StreamEvent>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of generator) {
          controller.enqueue(encoder.encode(formatSSEEvent(event)));
        }
        controller.close();
      } catch (err) {
        logger.error({ err }, "SSE generator threw an unexpected error");
        const errorEvent: StreamEvent = {
          type: "error",
          message: "An internal error occurred",
          code: "STREAM_ERROR",
        };
        controller.enqueue(encoder.encode(formatSSEEvent(errorEvent)));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * Client-side SSE parser. Combines the existing buffer with a new chunk and
 * extracts any complete events (delimited by `\n\n`).
 *
 * Returns:
 * - `events`: fully-parsed StreamEvent objects from complete SSE frames
 * - `remaining`: any partial data that did not yet form a complete event
 */
export function parseSSEEvents(
  chunk: string,
  buffer: string,
): { events: StreamEvent[]; remaining: string } {
  const combined = buffer + chunk;
  const parts = combined.split("\n\n");
  // The last element may be an incomplete frame (or empty string if the
  // chunk ended exactly on a double-newline boundary).
  const remaining = parts.pop() ?? "";

  const events: StreamEvent[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    // Each part may contain multiple lines; find the data line.
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("data: ")) {
        const json = line.slice("data: ".length);
        try {
          const parsed = JSON.parse(json) as StreamEvent;
          events.push(parsed);
        } catch {
          // Ignore malformed JSON
        }
        break; // Only one data line per event frame
      }
      // Skip comment lines (start with ':') and other non-data lines
    }
  }

  return { events, remaining };
}
