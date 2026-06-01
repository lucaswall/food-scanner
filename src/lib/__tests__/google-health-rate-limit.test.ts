import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "@/lib/logger";

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const warnMock = vi.fn();
const debugMock = vi.fn();
const infoMock = vi.fn();
const errorMock = vi.fn();

vi.mock("@/lib/logger", () => ({
  logger: {
    info: infoMock,
    warn: warnMock,
    error: errorMock,
    debug: debugMock,
    child: vi.fn(),
  },
  startTimer: () => () => 42,
}));

const fakeLog: Logger = {
  warn: warnMock,
  debug: debugMock,
  info: infoMock,
  error: errorMock,
} as unknown as Logger;

function make429Response(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 429, headers });
}

describe("google-health-rate-limit", () => {
  let recordRateLimitHeaders: (
    userId: string | undefined,
    response: Response,
    log?: Logger,
  ) => void;
  let getRateLimitSnapshot: (
    userId: string,
  ) => { cooldownUntil: number } | null;
  let assertRateLimitAllowed: (
    userId: string,
    criticality: "critical" | "important" | "optional",
    log?: Logger,
  ) => void;
  let _resetForTests: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/lib/google-health-rate-limit");
    recordRateLimitHeaders = mod.recordRateLimitHeaders;
    getRateLimitSnapshot = mod.getRateLimitSnapshot;
    assertRateLimitAllowed = mod.assertRateLimitAllowed;
    _resetForTests = mod._resetForTests;
    _resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // (a) Cold start: allows all three criticalities when no cooldown has been recorded
  describe("cold start (no cooldown recorded)", () => {
    it("allows critical, important, and optional when no 429 cooldown exists", () => {
      expect(() => assertRateLimitAllowed("user-a", "critical", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "important", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "optional", fakeLog)).not.toThrow();
    });

    it("does nothing for non-429 responses", () => {
      const okResponse = new Response(null, { status: 200 });
      recordRateLimitHeaders("user-a", okResponse, fakeLog);
      expect(getRateLimitSnapshot("user-a")).toBeNull();
      expect(() => assertRateLimitAllowed("user-a", "optional", fakeLog)).not.toThrow();
    });

    it("does nothing when userId is undefined", () => {
      recordRateLimitHeaders(undefined, make429Response({ "Retry-After": "60" }), fakeLog);
      expect(warnMock).not.toHaveBeenCalled();
    });
  });

  // (b) After a 429 cooldown: throws HEALTH_RATE_LIMIT_LOW for optional, returns for important/critical
  describe("after a 429 cooldown", () => {
    it("throws HEALTH_RATE_LIMIT_LOW for optional but allows important and critical", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders("user-a", make429Response({ "Retry-After": "60" }), fakeLog);

      expect(() =>
        assertRateLimitAllowed("user-a", "optional", fakeLog),
      ).toThrow("HEALTH_RATE_LIMIT_LOW");
      expect(() =>
        assertRateLimitAllowed("user-a", "important", fakeLog),
      ).not.toThrow();
      expect(() =>
        assertRateLimitAllowed("user-a", "critical", fakeLog),
      ).not.toThrow();
    });

    it("sets cooldownUntil to now + Retry-After seconds", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders("user-a", make429Response({ "Retry-After": "60" }), fakeLog);

      const snap = getRateLimitSnapshot("user-a");
      expect(snap).not.toBeNull();
      expect(snap!.cooldownUntil).toBe(Date.now() + 60 * 1000);
    });

    it("uses default cooldown when Retry-After is absent", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders("user-a", make429Response(), fakeLog);

      const snap = getRateLimitSnapshot("user-a");
      expect(snap).not.toBeNull();
      // Default cooldown is 60s
      expect(snap!.cooldownUntil).toBe(Date.now() + 60_000);
    });

    it("logs a warn when a 429 cooldown is recorded", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders("user-a", make429Response({ "Retry-After": "30" }), fakeLog);

      expect(warnMock).toHaveBeenCalledWith(
        expect.objectContaining({ action: "health_rate_limit_cooldown", userId: "user-a" }),
        expect.any(String),
      );
    });
  });

  // (c) 'critical' during cooldown emits a warn log and still returns
  describe("critical bypass during cooldown", () => {
    it("emits a warn log but does NOT throw for critical during cooldown", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders("user-a", make429Response({ "Retry-After": "60" }), fakeLog);
      warnMock.mockClear();

      expect(() =>
        assertRateLimitAllowed("user-a", "critical", fakeLog),
      ).not.toThrow();
      expect(warnMock).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "health_breaker_critical_bypass",
          userId: "user-a",
        }),
        expect.any(String),
      );
    });

    it("important during cooldown returns silently (no warn)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders("user-a", make429Response({ "Retry-After": "60" }), fakeLog);
      warnMock.mockClear();

      expect(() =>
        assertRateLimitAllowed("user-a", "important", fakeLog),
      ).not.toThrow();
      // important should NOT warn — only critical warns
      const bypassCall = warnMock.mock.calls.find(
        (c) => (c[0] as { action?: string }).action === "health_breaker_critical_bypass",
      );
      expect(bypassCall).toBeUndefined();
    });
  });

  // (d) Once cooldownUntil elapses all criticalities are allowed again
  describe("cooldown expiry", () => {
    it("allows all criticalities once cooldownUntil elapses", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders("user-a", make429Response({ "Retry-After": "60" }), fakeLog);

      // Still in cooldown — optional blocked
      expect(() =>
        assertRateLimitAllowed("user-a", "optional", fakeLog),
      ).toThrow("HEALTH_RATE_LIMIT_LOW");

      // Advance past the 60s cooldown
      vi.setSystemTime(new Date("2026-05-04T12:01:01Z"));

      expect(() =>
        assertRateLimitAllowed("user-a", "optional", fakeLog),
      ).not.toThrow();
      expect(() =>
        assertRateLimitAllowed("user-a", "important", fakeLog),
      ).not.toThrow();
      expect(() =>
        assertRateLimitAllowed("user-a", "critical", fakeLog),
      ).not.toThrow();
    });

    it("getRateLimitSnapshot returns null after cooldown elapses", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders("user-a", make429Response({ "Retry-After": "60" }), fakeLog);
      expect(getRateLimitSnapshot("user-a")).not.toBeNull();

      vi.setSystemTime(new Date("2026-05-04T12:01:01Z"));
      expect(getRateLimitSnapshot("user-a")).toBeNull();
    });

    it("isolates cooldown state per user", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders("user-a", make429Response({ "Retry-After": "60" }), fakeLog);

      // user-b has no cooldown
      expect(() =>
        assertRateLimitAllowed("user-b", "optional", fakeLog),
      ).not.toThrow();

      // user-a is blocked
      expect(() =>
        assertRateLimitAllowed("user-a", "optional", fakeLog),
      ).toThrow("HEALTH_RATE_LIMIT_LOW");
    });
  });

  // (e) _resetForTests clears all state
  describe("_resetForTests", () => {
    it("clears all cooldown state so subsequent calls behave as cold start", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders("user-a", make429Response({ "Retry-After": "60" }), fakeLog);
      expect(() =>
        assertRateLimitAllowed("user-a", "optional", fakeLog),
      ).toThrow("HEALTH_RATE_LIMIT_LOW");

      _resetForTests();

      // After reset: no cooldown active
      expect(getRateLimitSnapshot("user-a")).toBeNull();
      expect(() =>
        assertRateLimitAllowed("user-a", "optional", fakeLog),
      ).not.toThrow();
    });
  });
});
