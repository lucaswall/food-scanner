import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("allows requests up to maxRequests", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit("test-key", 5, 60_000);
      expect(result.allowed).toBe(true);
    }
  });

  it("denies requests beyond maxRequests", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    for (let i = 0; i < 5; i++) {
      checkRateLimit("test-key", 5, 60_000);
    }
    const result = checkRateLimit("test-key", 5, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("resets after window expires", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    for (let i = 0; i < 5; i++) {
      checkRateLimit("test-key", 5, 1000);
    }
    expect(checkRateLimit("test-key", 5, 1000).allowed).toBe(false);

    vi.spyOn(Date, "now").mockReturnValue(now + 1001);
    const result = checkRateLimit("test-key", 5, 1000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it("cleans expired entries periodically even under low traffic", async () => {
    const { checkRateLimit, _getStoreSize } = await import("@/lib/rate-limit");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);

    // Create entries that will expire
    for (let i = 0; i < 50; i++) {
      checkRateLimit(`key-${i}`, 10, 1000);
    }
    expect(_getStoreSize()).toBe(50);

    // Advance past expiration, trigger enough calls for periodic cleanup
    vi.spyOn(Date, "now").mockReturnValue(now + 2000);
    for (let i = 0; i < 100; i++) {
      checkRateLimit("cleanup-trigger", 10000, 60_000);
    }

    // Expired entries should have been cleaned up
    // Store should have cleanup-trigger + no expired keys
    expect(_getStoreSize()).toBeLessThanOrEqual(2);
  });

  it("enforces hard cap by evicting oldest entries when all are active", async () => {
    const { checkRateLimit, _getStoreSize, _getMaxStoreSize } = await import("@/lib/rate-limit");

    const maxSize = _getMaxStoreSize();

    // Fill store beyond max with active (non-expired) entries
    for (let i = 0; i < maxSize + 100; i++) {
      checkRateLimit(`flood-${i}`, 10, 60_000);
    }

    // Store should be capped at MAX_STORE_SIZE
    expect(_getStoreSize()).toBeLessThanOrEqual(maxSize);
  });
});
