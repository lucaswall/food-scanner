import { describe, it, expect, vi, beforeEach } from "vitest";

// Need to reset module between tests to clear the in-memory store
let checkRateLimit: typeof import("@/lib/rate-limit").checkRateLimit;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("@/lib/rate-limit");
  checkRateLimit = mod.checkRateLimit;
});

describe("checkRateLimit", () => {
  it("returns allowed: true when under limit", () => {
    const result = checkRateLimit("test-ip", 5, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("returns allowed: false when limit exceeded", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("test-ip", 5, 60000);
    }
    const result = checkRateLimit("test-ip", 5, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("tracks by key independently", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("ip-1", 5, 60000);
    }
    // ip-1 is exhausted
    expect(checkRateLimit("ip-1", 5, 60000).allowed).toBe(false);
    // ip-2 still has capacity
    expect(checkRateLimit("ip-2", 5, 60000).allowed).toBe(true);
  });

  it("resets after window expires", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 5; i++) {
        checkRateLimit("test-ip", 5, 60000);
      }
      expect(checkRateLimit("test-ip", 5, 60000).allowed).toBe(false);

      // Advance past the window
      vi.advanceTimersByTime(60001);

      const result = checkRateLimit("test-ip", 5, 60000);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("decrements remaining correctly", () => {
    expect(checkRateLimit("test-ip", 3, 60000).remaining).toBe(2);
    expect(checkRateLimit("test-ip", 3, 60000).remaining).toBe(1);
    expect(checkRateLimit("test-ip", 3, 60000).remaining).toBe(0);
    expect(checkRateLimit("test-ip", 3, 60000).allowed).toBe(false);
  });
});
