import { describe, it, expect } from "vitest";
import { shouldDropOverloadedSdkError } from "@/lib/sentry-filters";

interface SentryExceptionValue {
  type?: string;
  value?: string;
  mechanism?: {
    type?: string;
  };
}

interface SentryEvent {
  exception?: {
    values?: SentryExceptionValue[];
  };
}

describe("shouldDropOverloadedSdkError", () => {
  it("returns true for Anthropic SDK overloaded_error with stream_error mechanism", () => {
    const event: SentryEvent = {
      exception: {
        values: [
          {
            mechanism: { type: "auto.ai.anthropic.stream_error" },
            value: "Error: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}",
          },
        ],
      },
    };
    expect(shouldDropOverloadedSdkError(event)).toBe(true);
  });

  it("returns false for app-level pino error (FOOD-SCANNER-E)", () => {
    const event: SentryEvent = {
      exception: {
        values: [
          {
            mechanism: { type: "auto.log.pino" },
            value: "Claude API persistently overloaded, exhausted retries",
          },
        ],
      },
    };
    expect(shouldDropOverloadedSdkError(event)).toBe(false);
  });

  it("returns false for Anthropic SDK error that is not overloaded", () => {
    const event: SentryEvent = {
      exception: {
        values: [
          {
            mechanism: { type: "auto.ai.anthropic.stream_error" },
            value: "Error: 500 Internal Server Error",
          },
        ],
      },
    };
    expect(shouldDropOverloadedSdkError(event)).toBe(false);
  });

  it("returns false for events without exceptions", () => {
    expect(shouldDropOverloadedSdkError({})).toBe(false);
  });

  it("returns false for events with empty exception values", () => {
    const event: SentryEvent = {
      exception: { values: [] },
    };
    expect(shouldDropOverloadedSdkError(event)).toBe(false);
  });
});
