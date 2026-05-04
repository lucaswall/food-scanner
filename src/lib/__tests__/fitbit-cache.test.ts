import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FitbitProfile, FitbitWeightLog, FitbitWeightGoal, ActivitySummary } from "@/types";
import type { Logger } from "@/lib/logger";
import type { FitbitCallCriticality } from "@/lib/fitbit-rate-limit";

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
  startTimer: () => () => 42,
}));

const mockEnsureFreshToken = vi.fn();
const mockGetFitbitProfile = vi.fn();
const mockGetFitbitLatestWeightKg = vi.fn();
const mockGetFitbitWeightGoal = vi.fn();
const mockGetActivitySummary = vi.fn();

vi.mock("@/lib/fitbit", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  getFitbitProfile: (...args: unknown[]) => mockGetFitbitProfile(...args),
  getFitbitLatestWeightKg: (...args: unknown[]) => mockGetFitbitLatestWeightKg(...args),
  getFitbitWeightGoal: (...args: unknown[]) => mockGetFitbitWeightGoal(...args),
  getActivitySummary: (...args: unknown[]) => mockGetActivitySummary(...args),
}));

const mockProfile: FitbitProfile = { ageYears: 34, sex: "MALE", heightCm: 180 };
const mockWeightLog: FitbitWeightLog = { weightKg: 90.5, loggedDate: "2024-01-15" };
const mockWeightGoal: FitbitWeightGoal = { goalType: "LOSE" };
const mockActivity: ActivitySummary = { caloriesOut: 2345 };

describe("fitbit-cache", () => {
  // Re-import module in each test to get fresh Map state
  let getCachedFitbitProfile: (
    userId: string,
    log?: Logger,
    criticality?: FitbitCallCriticality,
  ) => Promise<FitbitProfile>;
  let getCachedFitbitWeightKg: (
    userId: string,
    targetDate: string,
    log?: Logger,
    criticality?: FitbitCallCriticality,
  ) => Promise<FitbitWeightLog | null>;
  let getCachedFitbitWeightGoal: (
    userId: string,
    log?: Logger,
    criticality?: FitbitCallCriticality,
  ) => Promise<FitbitWeightGoal | null>;
  let getCachedActivitySummary: (
    userId: string,
    targetDate: string,
    log?: Logger,
    criticality?: FitbitCallCriticality,
  ) => Promise<ActivitySummary>;
  let invalidateFitbitProfileCache: (userId: string) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/lib/fitbit-cache");
    getCachedFitbitProfile = mod.getCachedFitbitProfile;
    getCachedFitbitWeightKg = mod.getCachedFitbitWeightKg;
    getCachedFitbitWeightGoal = mod.getCachedFitbitWeightGoal;
    getCachedActivitySummary = mod.getCachedActivitySummary;
    invalidateFitbitProfileCache = mod.invalidateFitbitProfileCache;
    mockEnsureFreshToken.mockResolvedValue("test-access-token");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── getCachedFitbitProfile ───────────────────────────────────────────────

  describe("getCachedFitbitProfile", () => {
    it("calls ensureFreshToken and getFitbitProfile on first call", async () => {
      mockGetFitbitProfile.mockResolvedValue(mockProfile);

      const result = await getCachedFitbitProfile("user-1");

      expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-1", expect.any(Object));
      expect(mockGetFitbitProfile).toHaveBeenCalledWith("test-access-token", expect.any(Object), "user-1", "optional");
      expect(result).toEqual(mockProfile);
    });

    it("returns cached value on second call within TTL (no second fetch)", async () => {
      mockGetFitbitProfile.mockResolvedValue(mockProfile);

      await getCachedFitbitProfile("user-1");
      await getCachedFitbitProfile("user-1");

      expect(mockGetFitbitProfile).toHaveBeenCalledTimes(1);
    });

    it("re-fetches after TTL expiry (24h)", async () => {
      mockGetFitbitProfile.mockResolvedValue(mockProfile);
      const now = Date.now();
      vi.setSystemTime(now);

      await getCachedFitbitProfile("user-1");

      // Advance 24h + 1ms
      vi.setSystemTime(now + 24 * 60 * 60 * 1000 + 1);
      await getCachedFitbitProfile("user-1");

      expect(mockGetFitbitProfile).toHaveBeenCalledTimes(2);
    });

    it("two simultaneous calls collapse via in-flight Promise (single fetch)", async () => {
      let resolveProfile!: (v: FitbitProfile) => void;
      const profilePromise = new Promise<FitbitProfile>((resolve) => {
        resolveProfile = resolve;
      });
      mockGetFitbitProfile.mockReturnValue(profilePromise);

      const p1 = getCachedFitbitProfile("user-1");
      const p2 = getCachedFitbitProfile("user-1");

      resolveProfile(mockProfile);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(mockGetFitbitProfile).toHaveBeenCalledTimes(1);
      expect(r1).toEqual(mockProfile);
      expect(r2).toEqual(mockProfile);
    });

    it("does not share cache between different users", async () => {
      mockGetFitbitProfile.mockResolvedValue(mockProfile);

      await getCachedFitbitProfile("user-1");
      await getCachedFitbitProfile("user-2");

      expect(mockGetFitbitProfile).toHaveBeenCalledTimes(2);
    });

    it("isolates in-flight by criticality so a rejected lower-tier call does not propagate to a higher-tier call", async () => {
      // Bug: when in-flight dedup ignored criticality, a concurrent `important` call
      // arriving while an `optional` call was in flight would inherit the optional
      // call's `FITBIT_RATE_LIMIT_LOW` rejection from the breaker — defeating the
      // whole point of tiered criticality.
      let rejectOptional: ((err: Error) => void) | undefined;
      const optionalHanging = new Promise<FitbitProfile>((_, reject) => {
        rejectOptional = reject;
      });

      mockGetFitbitProfile.mockImplementation((_token, _log, _userId, criticality) => {
        if (criticality === "optional") return optionalHanging;
        return Promise.resolve(mockProfile);
      });

      const optionalPromise = getCachedFitbitProfile("user-1", undefined, "optional");
      // Flush microtasks so optional's IIFE reaches `await getFitbitProfile(...)`
      await new Promise((r) => setImmediate(r));
      const importantPromise = getCachedFitbitProfile("user-1", undefined, "important");

      rejectOptional!(new Error("FITBIT_RATE_LIMIT_LOW"));

      await expect(optionalPromise).rejects.toThrow("FITBIT_RATE_LIMIT_LOW");
      await expect(importantPromise).resolves.toEqual(mockProfile);
      // Both tiers triggered their own underlying fetch — no cross-tier dedup.
      expect(mockGetFitbitProfile).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getCachedFitbitWeightKg ──────────────────────────────────────────────

  describe("getCachedFitbitWeightKg", () => {
    it("calls getFitbitLatestWeightKg on first call", async () => {
      mockGetFitbitLatestWeightKg.mockResolvedValue(mockWeightLog);

      const result = await getCachedFitbitWeightKg("user-1", "2024-01-15");

      expect(mockGetFitbitLatestWeightKg).toHaveBeenCalledWith("test-access-token", "2024-01-15", expect.any(Object), "user-1", "optional");
      expect(result).toEqual(mockWeightLog);
    });

    it("returns cached value on second call within TTL (no second fetch)", async () => {
      mockGetFitbitLatestWeightKg.mockResolvedValue(mockWeightLog);

      await getCachedFitbitWeightKg("user-1", "2024-01-15");
      await getCachedFitbitWeightKg("user-1", "2024-01-15");

      expect(mockGetFitbitLatestWeightKg).toHaveBeenCalledTimes(1);
    });

    it("uses per-user per-date cache key", async () => {
      mockGetFitbitLatestWeightKg.mockResolvedValue(mockWeightLog);

      await getCachedFitbitWeightKg("user-1", "2024-01-15");
      await getCachedFitbitWeightKg("user-1", "2024-01-16"); // different date
      await getCachedFitbitWeightKg("user-2", "2024-01-15"); // different user

      expect(mockGetFitbitLatestWeightKg).toHaveBeenCalledTimes(3);
    });

    it("re-fetches after TTL expiry (1h)", async () => {
      mockGetFitbitLatestWeightKg.mockResolvedValue(mockWeightLog);
      const now = Date.now();
      vi.setSystemTime(now);

      await getCachedFitbitWeightKg("user-1", "2024-01-15");

      // Advance 1h + 1ms
      vi.setSystemTime(now + 60 * 60 * 1000 + 1);
      await getCachedFitbitWeightKg("user-1", "2024-01-15");

      expect(mockGetFitbitLatestWeightKg).toHaveBeenCalledTimes(2);
    });

    it("caches null results too", async () => {
      mockGetFitbitLatestWeightKg.mockResolvedValue(null);

      const r1 = await getCachedFitbitWeightKg("user-1", "2024-01-15");
      const r2 = await getCachedFitbitWeightKg("user-1", "2024-01-15");

      expect(r1).toBeNull();
      expect(r2).toBeNull();
      expect(mockGetFitbitLatestWeightKg).toHaveBeenCalledTimes(1);
    });

    it("two simultaneous calls collapse via in-flight Promise", async () => {
      let resolveWeight!: (v: FitbitWeightLog | null) => void;
      const weightPromise = new Promise<FitbitWeightLog | null>((resolve) => {
        resolveWeight = resolve;
      });
      mockGetFitbitLatestWeightKg.mockReturnValue(weightPromise);

      const p1 = getCachedFitbitWeightKg("user-1", "2024-01-15");
      const p2 = getCachedFitbitWeightKg("user-1", "2024-01-15");

      resolveWeight(mockWeightLog);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(mockGetFitbitLatestWeightKg).toHaveBeenCalledTimes(1);
      expect(r1).toEqual(mockWeightLog);
      expect(r2).toEqual(mockWeightLog);
    });
  });

  // ─── getCachedFitbitWeightGoal ────────────────────────────────────────────

  describe("getCachedFitbitWeightGoal", () => {
    it("calls getFitbitWeightGoal on first call", async () => {
      mockGetFitbitWeightGoal.mockResolvedValue(mockWeightGoal);

      const result = await getCachedFitbitWeightGoal("user-1");

      expect(mockGetFitbitWeightGoal).toHaveBeenCalledWith("test-access-token", expect.any(Object), "user-1", "optional");
      expect(result).toEqual(mockWeightGoal);
    });

    it("returns cached value on second call within TTL", async () => {
      mockGetFitbitWeightGoal.mockResolvedValue(mockWeightGoal);

      await getCachedFitbitWeightGoal("user-1");
      await getCachedFitbitWeightGoal("user-1");

      expect(mockGetFitbitWeightGoal).toHaveBeenCalledTimes(1);
    });

    it("re-fetches after TTL expiry (24h)", async () => {
      mockGetFitbitWeightGoal.mockResolvedValue(mockWeightGoal);
      const now = Date.now();
      vi.setSystemTime(now);

      await getCachedFitbitWeightGoal("user-1");

      vi.setSystemTime(now + 24 * 60 * 60 * 1000 + 1);
      await getCachedFitbitWeightGoal("user-1");

      expect(mockGetFitbitWeightGoal).toHaveBeenCalledTimes(2);
    });

    it("two simultaneous calls collapse via in-flight Promise", async () => {
      let resolveGoal!: (v: FitbitWeightGoal | null) => void;
      const goalPromise = new Promise<FitbitWeightGoal | null>((resolve) => {
        resolveGoal = resolve;
      });
      mockGetFitbitWeightGoal.mockReturnValue(goalPromise);

      const p1 = getCachedFitbitWeightGoal("user-1");
      const p2 = getCachedFitbitWeightGoal("user-1");

      resolveGoal(mockWeightGoal);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(mockGetFitbitWeightGoal).toHaveBeenCalledTimes(1);
      expect(r1).toEqual(mockWeightGoal);
      expect(r2).toEqual(mockWeightGoal);
    });
  });

  // ─── getCachedActivitySummary ─────────────────────────────────────────────

  describe("getCachedActivitySummary", () => {
    it("calls getActivitySummary on first call", async () => {
      mockGetActivitySummary.mockResolvedValue(mockActivity);

      const result = await getCachedActivitySummary("user-1", "2024-01-15");

      expect(mockGetActivitySummary).toHaveBeenCalledWith("test-access-token", "2024-01-15", expect.any(Object), "user-1", "optional");
      expect(result).toEqual(mockActivity);
    });

    it("returns cached value on second call within TTL", async () => {
      mockGetActivitySummary.mockResolvedValue(mockActivity);

      await getCachedActivitySummary("user-1", "2024-01-15");
      await getCachedActivitySummary("user-1", "2024-01-15");

      expect(mockGetActivitySummary).toHaveBeenCalledTimes(1);
    });

    it("re-fetches after TTL expiry (5min)", async () => {
      mockGetActivitySummary.mockResolvedValue(mockActivity);
      const now = Date.now();
      vi.setSystemTime(now);

      await getCachedActivitySummary("user-1", "2024-01-15");

      // Advance 5min + 1ms
      vi.setSystemTime(now + 5 * 60 * 1000 + 1);
      await getCachedActivitySummary("user-1", "2024-01-15");

      expect(mockGetActivitySummary).toHaveBeenCalledTimes(2);

      // But NOT re-fetched before 5min
      vi.resetModules();
      const mod2 = await import("@/lib/fitbit-cache");
      vi.clearAllMocks();
      mockEnsureFreshToken.mockResolvedValue("test-access-token");
      mockGetActivitySummary.mockResolvedValue(mockActivity);

      await mod2.getCachedActivitySummary("user-1", "2024-01-15");
      vi.setSystemTime(now + 4 * 60 * 1000); // Only 4 min elapsed
      await mod2.getCachedActivitySummary("user-1", "2024-01-15");
      expect(mockGetActivitySummary).toHaveBeenCalledTimes(1);
    });

    it("two simultaneous calls collapse via in-flight Promise", async () => {
      let resolveActivity!: (v: ActivitySummary) => void;
      const activityPromise = new Promise<ActivitySummary>((resolve) => {
        resolveActivity = resolve;
      });
      mockGetActivitySummary.mockReturnValue(activityPromise);

      const p1 = getCachedActivitySummary("user-1", "2024-01-15");
      const p2 = getCachedActivitySummary("user-1", "2024-01-15");

      resolveActivity(mockActivity);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(mockGetActivitySummary).toHaveBeenCalledTimes(1);
      expect(r1).toEqual(mockActivity);
      expect(r2).toEqual(mockActivity);
    });
  });

  // ─── invalidateFitbitProfileCache ────────────────────────────────────────

  describe("invalidateFitbitProfileCache", () => {
    it("clears profile, weight, weight-goal, and activity entries for the given user", async () => {
      mockGetFitbitProfile.mockResolvedValue(mockProfile);
      mockGetFitbitLatestWeightKg.mockResolvedValue(mockWeightLog);
      mockGetFitbitWeightGoal.mockResolvedValue(mockWeightGoal);
      mockGetActivitySummary.mockResolvedValue(mockActivity);

      // Populate caches for user-1
      await getCachedFitbitProfile("user-1");
      await getCachedFitbitWeightKg("user-1", "2024-01-15");
      await getCachedFitbitWeightGoal("user-1");
      await getCachedActivitySummary("user-1", "2024-01-15");

      vi.clearAllMocks();
      mockEnsureFreshToken.mockResolvedValue("test-access-token");
      mockGetFitbitProfile.mockResolvedValue(mockProfile);
      mockGetFitbitLatestWeightKg.mockResolvedValue(mockWeightLog);
      mockGetFitbitWeightGoal.mockResolvedValue(mockWeightGoal);
      mockGetActivitySummary.mockResolvedValue(mockActivity);

      // Invalidate
      invalidateFitbitProfileCache("user-1");

      // All user-1 caches should be gone — re-fetches expected
      await getCachedFitbitProfile("user-1");
      await getCachedFitbitWeightKg("user-1", "2024-01-15");
      await getCachedFitbitWeightGoal("user-1");
      await getCachedActivitySummary("user-1", "2024-01-15");

      expect(mockGetFitbitProfile).toHaveBeenCalledTimes(1);
      expect(mockGetFitbitLatestWeightKg).toHaveBeenCalledTimes(1);
      expect(mockGetFitbitWeightGoal).toHaveBeenCalledTimes(1);
      expect(mockGetActivitySummary).toHaveBeenCalledTimes(1);
    });

    it("does not clear cache entries for other users", async () => {
      mockGetFitbitProfile.mockResolvedValue(mockProfile);

      // Populate caches for both users
      await getCachedFitbitProfile("user-1");
      await getCachedFitbitProfile("user-2");

      vi.clearAllMocks();
      mockEnsureFreshToken.mockResolvedValue("test-access-token");
      mockGetFitbitProfile.mockResolvedValue(mockProfile);

      // Invalidate only user-1
      invalidateFitbitProfileCache("user-1");

      // user-2's cache should still be valid
      await getCachedFitbitProfile("user-2");
      expect(mockGetFitbitProfile).not.toHaveBeenCalled();

      // user-1's cache should be gone
      await getCachedFitbitProfile("user-1");
      expect(mockGetFitbitProfile).toHaveBeenCalledTimes(1);
    });

    it("orphan in-flight fetch from before invalidation does not overwrite fresh post-invalidation cache", async () => {
      // Race: request A starts → invalidate → request B starts and resolves
      // first with fresh data → request A resolves last with stale data.
      // The cache must end up holding B's value, not A's.
      let resolveOrphan!: (v: FitbitProfile) => void;
      const orphanPromise = new Promise<FitbitProfile>((resolve) => {
        resolveOrphan = resolve;
      });
      mockGetFitbitProfile.mockReturnValueOnce(orphanPromise);

      const orphan = getCachedFitbitProfile("user-1");
      // Let the orphan IIFE register itself in profileInFlight.
      await new Promise((r) => setImmediate(r));

      invalidateFitbitProfileCache("user-1");

      // Refresh-triggered fetch resolves immediately with the fresh profile.
      const freshProfile: FitbitProfile = { ageYears: 35, sex: "MALE", heightCm: 181 };
      mockGetFitbitProfile.mockResolvedValueOnce(freshProfile);
      await getCachedFitbitProfile("user-1");

      // Now resolve the orphan with stale data — its write must be suppressed.
      const staleProfile: FitbitProfile = { ageYears: 99, sex: "FEMALE", heightCm: 100 };
      resolveOrphan(staleProfile);
      await orphan;

      // A subsequent read should hit the cache and return the fresh value,
      // not the stale orphan value.
      mockGetFitbitProfile.mockClear();
      const cached = await getCachedFitbitProfile("user-1");
      expect(cached).toEqual(freshProfile);
      expect(mockGetFitbitProfile).not.toHaveBeenCalled();
    });

    it("orphan settling after invalidation does not delete the newer in-flight entry", async () => {
      // After invalidate clears the in-flight key, a refresh-triggered fetch
      // can register a new promise under the same key. When the original
      // (orphan) promise later settles, its finally block must NOT delete
      // that newer entry — otherwise concurrent reads during the refresh
      // window would miss dedup and burn extra Fitbit calls.
      let resolveOrphan!: (v: FitbitProfile) => void;
      const orphanPromise = new Promise<FitbitProfile>((resolve) => {
        resolveOrphan = resolve;
      });
      let resolveRefresh!: (v: FitbitProfile) => void;
      const refreshPromise = new Promise<FitbitProfile>((resolve) => {
        resolveRefresh = resolve;
      });
      mockGetFitbitProfile
        .mockReturnValueOnce(orphanPromise)
        .mockReturnValueOnce(refreshPromise);

      const orphan = getCachedFitbitProfile("user-1");
      await new Promise((r) => setImmediate(r)); // orphan registers in-flight

      invalidateFitbitProfileCache("user-1");

      const refresh = getCachedFitbitProfile("user-1");
      await new Promise((r) => setImmediate(r)); // refresh registers in-flight

      // Settle orphan — its finally must skip the delete.
      resolveOrphan({ ageYears: 99, sex: "FEMALE", heightCm: 100 });
      await orphan;

      // A concurrent third call must dedup with the newer in-flight entry,
      // not start its own fetch. If finally clobbered the entry, this third
      // call would trigger getFitbitProfile a third time.
      const concurrent = getCachedFitbitProfile("user-1");

      const freshProfile: FitbitProfile = { ageYears: 35, sex: "MALE", heightCm: 181 };
      resolveRefresh(freshProfile);
      const [r1, r2] = await Promise.all([refresh, concurrent]);

      expect(r1).toEqual(freshProfile);
      expect(r2).toEqual(freshProfile);
      expect(mockGetFitbitProfile).toHaveBeenCalledTimes(2);
    });

    it("invalidating one user does not suppress cache writes for another user's in-flight fetch", async () => {
      // The orphan-write guard must be per-user. Otherwise user-A pressing
      // refresh transiently degrades cache hit rate for everyone — user-B's
      // unrelated in-flight fetch resolves but gets denied a cache write,
      // forcing the next read to re-hit Fitbit.
      let resolveB!: (v: FitbitProfile) => void;
      const bPromise = new Promise<FitbitProfile>((resolve) => {
        resolveB = resolve;
      });
      mockGetFitbitProfile.mockImplementation((_t, _l, userId) => {
        if (userId === "user-b") return bPromise;
        return Promise.resolve(mockProfile);
      });

      const bFetch = getCachedFitbitProfile("user-b");
      // Let user-b's IIFE register and snapshot its generation.
      await new Promise((r) => setImmediate(r));

      // Unrelated invalidation on user-a — must not affect user-b's write.
      invalidateFitbitProfileCache("user-a");

      const bProfile: FitbitProfile = { ageYears: 42, sex: "MALE", heightCm: 175 };
      resolveB(bProfile);
      await bFetch;

      // Subsequent read for user-b must hit cache (not re-fetch).
      mockGetFitbitProfile.mockClear();
      const cached = await getCachedFitbitProfile("user-b");
      expect(cached).toEqual(bProfile);
      expect(mockGetFitbitProfile).not.toHaveBeenCalled();
    });

    it("clears in-flight dedup entries so a refresh after a pending fetch triggers a new call", async () => {
      // If an in-flight fetch was running when invalidate was called, the next
      // call must NOT dedup with the (now-stale) in-flight promise — it must
      // start a fresh fetch.
      let resolveFirst!: (v: FitbitProfile) => void;
      const firstFetchPromise = new Promise<FitbitProfile>((resolve) => {
        resolveFirst = resolve;
      });
      mockGetFitbitProfile.mockReturnValueOnce(firstFetchPromise);

      const inflight = getCachedFitbitProfile("user-1");
      // Let the IIFE register itself in profileInFlight.
      await new Promise((r) => setImmediate(r));

      invalidateFitbitProfileCache("user-1");

      // Subsequent call must trigger a NEW fetch — not dedup with the orphan in-flight.
      mockGetFitbitProfile.mockResolvedValueOnce(mockProfile);
      const refresh = getCachedFitbitProfile("user-1");

      // Resolve the orphan; both promises settle.
      resolveFirst({ ageYears: 99, sex: "FEMALE", heightCm: 100 });
      await Promise.all([inflight, refresh]);

      // Two distinct fetches happened — invalidation broke the in-flight dedup.
      expect(mockGetFitbitProfile).toHaveBeenCalledTimes(2);
    });
  });
});
