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

function makeResponse(headers: Record<string, string>): Response {
  return new Response(null, { status: 200, headers });
}

describe("fitbit-rate-limit", () => {
  let recordRateLimitHeaders: (
    userId: string | undefined,
    response: Response,
    log?: Logger,
  ) => void;
  let getRateLimitSnapshot: (
    userId: string,
  ) => { limit: number; remaining: number; resetAt: number } | null;
  let assertRateLimitAllowed: (
    userId: string,
    criticality: "critical" | "important" | "optional",
    log?: Logger,
  ) => void;
  let _resetForTests: () => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/lib/fitbit-rate-limit");
    recordRateLimitHeaders = mod.recordRateLimitHeaders;
    getRateLimitSnapshot = mod.getRateLimitSnapshot;
    assertRateLimitAllowed = mod.assertRateLimitAllowed;
    _resetForTests = mod._resetForTests;
    _resetForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("recordRateLimitHeaders", () => {
    it("populates a snapshot from all three headers", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "120",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );

      const snap = getRateLimitSnapshot("user-a");
      expect(snap).not.toBeNull();
      expect(snap!.limit).toBe(150);
      expect(snap!.remaining).toBe(120);
      // resetAt = now + 1800 * 1000
      expect(snap!.resetAt).toBe(Date.now() + 1800 * 1000);
    });

    it("leaves prior snapshot unchanged when a header is missing", () => {
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "120",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      const before = getRateLimitSnapshot("user-a");

      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "100",
          // Reset header missing
        }),
        fakeLog,
      );
      const after = getRateLimitSnapshot("user-a");

      expect(after).toEqual(before);
    });

    it("ignores NaN headers", () => {
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "abc",
          "Fitbit-Rate-Limit-Remaining": "120",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      expect(getRateLimitSnapshot("user-a")).toBeNull();
    });

    it("does nothing when userId is undefined", () => {
      recordRateLimitHeaders(
        undefined,
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "120",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      // No userId so nothing to query — just confirm no throw and no warn
      expect(warnMock).not.toHaveBeenCalled();
    });

    it("warns when remaining crosses into <30 tier", () => {
      // First snapshot: 50 remaining → no warn
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "50",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      expect(warnMock).not.toHaveBeenCalled();

      // Cross into <30 tier: 25 remaining → warn
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "25",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      expect(warnMock).toHaveBeenCalledTimes(1);
      const call = warnMock.mock.calls[0]!;
      expect(call[0]).toMatchObject({
        action: "fitbit_rate_limit_warn",
        remaining: 25,
        limit: 150,
        userId: "user-a",
      });
    });

    it("does not re-warn for the same tier", () => {
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "25",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "20",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      // Both responses are in the <30 tier — only one warn
      expect(warnMock).toHaveBeenCalledTimes(1);
    });

    it("warns again when crossing into <10 tier", () => {
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "25",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "8",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      expect(warnMock).toHaveBeenCalledTimes(2);
    });

    it("isolates state per user", () => {
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "120",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );

      expect(getRateLimitSnapshot("user-b")).toBeNull();
      expect(getRateLimitSnapshot("user-a")).not.toBeNull();
    });

    it("re-warns after a fresh window with high remaining is followed by a new degradation", () => {
      // Drive into critical tier
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "8",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      expect(warnMock).toHaveBeenCalledTimes(1);

      // New window: budget replenished — tier returns to "ok"
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "140",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      // No new warn for ok tier (rank 0 not greater than rank 0)
      expect(warnMock).toHaveBeenCalledTimes(1);

      // Degrade again — should warn again because lastTier was reset to "ok"
      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "8",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
      expect(warnMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("getRateLimitSnapshot", () => {
    it("returns null when never observed", () => {
      expect(getRateLimitSnapshot("user-a")).toBeNull();
    });

    it("returns null when snapshot is stale (resetAt past)", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "120",
          "Fitbit-Rate-Limit-Reset": "60", // resetAt = now + 60s
        }),
        fakeLog,
      );

      // Fast-forward past resetAt
      vi.setSystemTime(new Date("2026-05-04T12:02:00Z"));
      expect(getRateLimitSnapshot("user-a")).toBeNull();
    });

    it("returns the snapshot when fresh", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      recordRateLimitHeaders(
        "user-a",
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "120",
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );

      vi.setSystemTime(new Date("2026-05-04T12:10:00Z"));
      const snap = getRateLimitSnapshot("user-a");
      expect(snap).not.toBeNull();
      expect(snap!.remaining).toBe(120);
    });
  });

  describe("assertRateLimitAllowed (circuit breaker)", () => {
    function seedRemaining(userId: string, remaining: number): void {
      recordRateLimitHeaders(
        userId,
        makeResponse({
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": String(remaining),
          "Fitbit-Rate-Limit-Reset": "1800",
        }),
        fakeLog,
      );
    }

    it("allows all criticalities when snapshot is null (cold start)", () => {
      expect(() => assertRateLimitAllowed("user-a", "critical", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "important", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "optional", fakeLog)).not.toThrow();
    });

    it("allows all criticalities when snapshot is stale", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

      seedRemaining("user-a", 2); // very low remaining
      // make snapshot stale
      vi.setSystemTime(new Date("2026-05-04T13:00:00Z"));

      expect(() => assertRateLimitAllowed("user-a", "critical", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "important", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "optional", fakeLog)).not.toThrow();
    });

    it("allows all criticalities when remaining ≥ 20", () => {
      seedRemaining("user-a", 50);
      expect(() => assertRateLimitAllowed("user-a", "critical", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "important", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "optional", fakeLog)).not.toThrow();
    });

    it("rejects optional but allows critical+important when 5 ≤ remaining < 20", () => {
      seedRemaining("user-a", 15);
      expect(() => assertRateLimitAllowed("user-a", "critical", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "important", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "optional", fakeLog)).toThrow(
        "FITBIT_RATE_LIMIT_LOW",
      );
    });

    it("allows all criticalities at remaining=20 (boundary: optional floor inclusive)", () => {
      seedRemaining("user-a", 20);
      expect(() => assertRateLimitAllowed("user-a", "critical", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "important", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "optional", fakeLog)).not.toThrow();
    });

    it("rejects important and optional but allows critical when remaining < 5", () => {
      seedRemaining("user-a", 4);
      expect(() => assertRateLimitAllowed("user-a", "critical", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "important", fakeLog)).toThrow(
        "FITBIT_RATE_LIMIT_LOW",
      );
      expect(() => assertRateLimitAllowed("user-a", "optional", fakeLog)).toThrow(
        "FITBIT_RATE_LIMIT_LOW",
      );
    });

    it("allows critical+important but rejects optional at remaining=5 (boundary: important floor inclusive)", () => {
      seedRemaining("user-a", 5);
      expect(() => assertRateLimitAllowed("user-a", "critical", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "important", fakeLog)).not.toThrow();
      expect(() => assertRateLimitAllowed("user-a", "optional", fakeLog)).toThrow(
        "FITBIT_RATE_LIMIT_LOW",
      );
    });

    it("rejection log includes the snapshot's remaining count", () => {
      seedRemaining("user-a", 15);
      warnMock.mockClear();
      expect(() => assertRateLimitAllowed("user-a", "optional", fakeLog)).toThrow();

      const rejectionCall = warnMock.mock.calls.find(
        (c) => (c[0] as { action?: string }).action === "fitbit_breaker_reject",
      );
      expect(rejectionCall).toBeDefined();
      expect(rejectionCall![0]).toMatchObject({
        action: "fitbit_breaker_reject",
        userId: "user-a",
        criticality: "optional",
        remaining: 15,
      });
    });
  });
});
