import { describe, it, expect } from "vitest";
import { mapHealthError, isExpectedHealthError } from "@/lib/health-error-response";

describe("mapHealthError", () => {
  it("maps each known HEALTH_* code to its HTTP status", () => {
    expect(mapHealthError(new Error("HEALTH_TOKEN_INVALID")).status).toBe(401);
    expect(mapHealthError(new Error("HEALTH_SCOPE_MISSING")).status).toBe(403);
    expect(mapHealthError(new Error("HEALTH_RATE_LIMIT")).status).toBe(429);
    expect(mapHealthError(new Error("HEALTH_RATE_LIMIT_LOW")).status).toBe(503);
    expect(mapHealthError(new Error("HEALTH_TIMEOUT")).status).toBe(504);
    expect(mapHealthError(new Error("HEALTH_REFRESH_TRANSIENT")).status).toBe(502);
    expect(mapHealthError(new Error("HEALTH_TOKEN_SAVE_FAILED")).status).toBe(500);
    expect(mapHealthError(new Error("HEALTH_API_ERROR")).status).toBe(502);
  });

  it("falls back to 500 for unknown / non-Error values", () => {
    expect(mapHealthError(new Error("something unexpected")).status).toBe(500);
    expect(mapHealthError("plain string").status).toBe(500);
    expect(mapHealthError(undefined).status).toBe(500);
  });
});

describe("isExpectedHealthError", () => {
  it("returns true for expected, operational HEALTH_* conditions (logged at warn, not error)", () => {
    for (const code of [
      "HEALTH_TOKEN_INVALID",
      "HEALTH_SCOPE_MISSING",
      "HEALTH_RATE_LIMIT",
      "HEALTH_RATE_LIMIT_LOW",
      "HEALTH_TIMEOUT",
      "HEALTH_REFRESH_TRANSIENT",
    ]) {
      expect(isExpectedHealthError(new Error(code))).toBe(true);
    }
    // string form (some callers stringify before passing)
    expect(isExpectedHealthError("HEALTH_TIMEOUT")).toBe(true);
  });

  it("returns false for genuine faults and unknown values (logged at error)", () => {
    expect(isExpectedHealthError(new Error("HEALTH_API_ERROR"))).toBe(false);
    expect(isExpectedHealthError(new Error("HEALTH_TOKEN_SAVE_FAILED"))).toBe(false);
    expect(isExpectedHealthError(new Error("something unexpected"))).toBe(false);
    expect(isExpectedHealthError(undefined)).toBe(false);
  });
});
