import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HealthProfile, HealthWeightLog, ActivitySummary } from "@/types";
import type { Logger } from "@/lib/logger";
import type { HealthCallCriticality } from "@/lib/google-health-rate-limit";

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
const mockGetHealthProfile = vi.fn();
const mockGetHealthLatestWeightKg = vi.fn();
const mockGetHealthActivitySummary = vi.fn();

vi.mock("@/lib/google-health", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  getHealthProfile: (...args: unknown[]) => mockGetHealthProfile(...args),
  getHealthLatestWeightKg: (...args: unknown[]) => mockGetHealthLatestWeightKg(...args),
  getHealthActivitySummary: (...args: unknown[]) => mockGetHealthActivitySummary(...args),
}));

const mockProfile: HealthProfile = { ageYears: 34, sex: "MALE", heightCm: 180 };
const mockWeightLog: HealthWeightLog = { weightKg: 90.5, loggedDate: "2024-01-15" };
const mockActivity: ActivitySummary = { caloriesOut: 2345 };

describe("health-cache", () => {
  // Re-import module in each test to get fresh Map state
  let getCachedHealthProfile: (
    userId: string,
    log?: Logger,
    criticality?: HealthCallCriticality,
  ) => Promise<HealthProfile>;
  let getCachedHealthWeightKg: (
    userId: string,
    targetDate: string,
    log?: Logger,
    criticality?: HealthCallCriticality,
  ) => Promise<HealthWeightLog | null>;
  let getCachedHealthActivitySummary: (
    userId: string,
    targetDate: string,
    log?: Logger,
    criticality?: HealthCallCriticality,
    zoneOffset?: string | null,
  ) => Promise<ActivitySummary>;
  let invalidateHealthProfileCache: (userId: string) => void;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import("@/lib/health-cache");
    getCachedHealthProfile = mod.getCachedHealthProfile;
    getCachedHealthWeightKg = mod.getCachedHealthWeightKg;
    getCachedHealthActivitySummary = mod.getCachedHealthActivitySummary;
    invalidateHealthProfileCache = mod.invalidateHealthProfileCache;
    mockEnsureFreshToken.mockResolvedValue("test-access-token");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── getCachedHealthProfile ───────────────────────────────────────────────

  describe("getCachedHealthProfile", () => {
    it("calls ensureFreshToken and getHealthProfile on first call", async () => {
      mockGetHealthProfile.mockResolvedValue(mockProfile);

      const result = await getCachedHealthProfile("user-1");

      expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-1", expect.any(Object));
      expect(mockGetHealthProfile).toHaveBeenCalledWith("test-access-token", expect.any(Object), "user-1", "optional");
      expect(result).toEqual(mockProfile);
    });

    it("returns cached value on second call within TTL (no second fetch)", async () => {
      mockGetHealthProfile.mockResolvedValue(mockProfile);

      await getCachedHealthProfile("user-1");
      await getCachedHealthProfile("user-1");

      expect(mockGetHealthProfile).toHaveBeenCalledTimes(1);
    });

    it("re-fetches after TTL expiry (24h)", async () => {
      mockGetHealthProfile.mockResolvedValue(mockProfile);
      const now = Date.now();
      vi.setSystemTime(now);

      await getCachedHealthProfile("user-1");

      // Advance 24h + 1ms
      vi.setSystemTime(now + 24 * 60 * 60 * 1000 + 1);
      await getCachedHealthProfile("user-1");

      expect(mockGetHealthProfile).toHaveBeenCalledTimes(2);
    });

    it("two simultaneous calls collapse via in-flight Promise (single fetch)", async () => {
      let resolveProfile!: (v: HealthProfile) => void;
      const profilePromise = new Promise<HealthProfile>((resolve) => {
        resolveProfile = resolve;
      });
      mockGetHealthProfile.mockReturnValue(profilePromise);

      const p1 = getCachedHealthProfile("user-1");
      const p2 = getCachedHealthProfile("user-1");

      resolveProfile(mockProfile);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(mockGetHealthProfile).toHaveBeenCalledTimes(1);
      expect(r1).toEqual(mockProfile);
      expect(r2).toEqual(mockProfile);
    });

    it("does not share cache between different users", async () => {
      mockGetHealthProfile.mockResolvedValue(mockProfile);

      await getCachedHealthProfile("user-1");
      await getCachedHealthProfile("user-2");

      expect(mockGetHealthProfile).toHaveBeenCalledTimes(2);
    });

    it("isolates in-flight by criticality so a rejected lower-tier call does not propagate to a higher-tier call", async () => {
      let rejectOptional: ((err: Error) => void) | undefined;
      const optionalHanging = new Promise<HealthProfile>((_, reject) => {
        rejectOptional = reject;
      });

      mockGetHealthProfile.mockImplementation((_token, _log, _userId, criticality) => {
        if (criticality === "optional") return optionalHanging;
        return Promise.resolve(mockProfile);
      });

      const optionalPromise = getCachedHealthProfile("user-1", undefined, "optional");
      await new Promise((r) => setImmediate(r));
      const importantPromise = getCachedHealthProfile("user-1", undefined, "important");

      rejectOptional!(new Error("HEALTH_RATE_LIMIT_LOW"));

      await expect(optionalPromise).rejects.toThrow("HEALTH_RATE_LIMIT_LOW");
      await expect(importantPromise).resolves.toEqual(mockProfile);
      expect(mockGetHealthProfile).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getCachedHealthWeightKg ──────────────────────────────────────────────

  describe("getCachedHealthWeightKg", () => {
    it("calls getHealthLatestWeightKg on first call", async () => {
      mockGetHealthLatestWeightKg.mockResolvedValue(mockWeightLog);

      const result = await getCachedHealthWeightKg("user-1", "2024-01-15");

      expect(mockGetHealthLatestWeightKg).toHaveBeenCalledWith("test-access-token", "2024-01-15", expect.any(Object), "user-1", "optional");
      expect(result).toEqual(mockWeightLog);
    });

    it("returns cached value on second call within TTL (no second fetch)", async () => {
      mockGetHealthLatestWeightKg.mockResolvedValue(mockWeightLog);

      await getCachedHealthWeightKg("user-1", "2024-01-15");
      await getCachedHealthWeightKg("user-1", "2024-01-15");

      expect(mockGetHealthLatestWeightKg).toHaveBeenCalledTimes(1);
    });

    it("uses per-user per-date cache key", async () => {
      mockGetHealthLatestWeightKg.mockResolvedValue(mockWeightLog);

      await getCachedHealthWeightKg("user-1", "2024-01-15");
      await getCachedHealthWeightKg("user-1", "2024-01-16"); // different date
      await getCachedHealthWeightKg("user-2", "2024-01-15"); // different user

      expect(mockGetHealthLatestWeightKg).toHaveBeenCalledTimes(3);
    });

    it("re-fetches after TTL expiry (1h)", async () => {
      mockGetHealthLatestWeightKg.mockResolvedValue(mockWeightLog);
      const now = Date.now();
      vi.setSystemTime(now);

      await getCachedHealthWeightKg("user-1", "2024-01-15");

      // Advance 1h + 1ms
      vi.setSystemTime(now + 60 * 60 * 1000 + 1);
      await getCachedHealthWeightKg("user-1", "2024-01-15");

      expect(mockGetHealthLatestWeightKg).toHaveBeenCalledTimes(2);
    });

    it("caches null results too", async () => {
      mockGetHealthLatestWeightKg.mockResolvedValue(null);

      const r1 = await getCachedHealthWeightKg("user-1", "2024-01-15");
      const r2 = await getCachedHealthWeightKg("user-1", "2024-01-15");

      expect(r1).toBeNull();
      expect(r2).toBeNull();
      expect(mockGetHealthLatestWeightKg).toHaveBeenCalledTimes(1);
    });

    it("two simultaneous calls collapse via in-flight Promise", async () => {
      let resolveWeight!: (v: HealthWeightLog | null) => void;
      const weightPromise = new Promise<HealthWeightLog | null>((resolve) => {
        resolveWeight = resolve;
      });
      mockGetHealthLatestWeightKg.mockReturnValue(weightPromise);

      const p1 = getCachedHealthWeightKg("user-1", "2024-01-15");
      const p2 = getCachedHealthWeightKg("user-1", "2024-01-15");

      resolveWeight(mockWeightLog);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(mockGetHealthLatestWeightKg).toHaveBeenCalledTimes(1);
      expect(r1).toEqual(mockWeightLog);
      expect(r2).toEqual(mockWeightLog);
    });
  });

  // ─── getCachedHealthActivitySummary ──────────────────────────────────────────

  describe("getCachedHealthActivitySummary", () => {
    it("calls getHealthActivitySummary on first call", async () => {
      mockGetHealthActivitySummary.mockResolvedValue(mockActivity);

      const result = await getCachedHealthActivitySummary("user-1", "2024-01-15");

      expect(mockGetHealthActivitySummary).toHaveBeenCalledWith("test-access-token", "2024-01-15", expect.any(Object), "user-1", "optional");
      expect(result).toEqual(mockActivity);
    });

    it("does NOT pass zoneOffset to getHealthActivitySummary (CivilDateTime forbids an offset; it stays in the cache key)", async () => {
      mockGetHealthActivitySummary.mockResolvedValue(mockActivity);

      await getCachedHealthActivitySummary("user-1", "2024-01-15", undefined, "optional", "-03:00");

      expect(mockGetHealthActivitySummary).toHaveBeenCalledWith("test-access-token", "2024-01-15", expect.any(Object), "user-1", "optional");
    });

    it("keys the cache by zoneOffset (different offsets do not collide)", async () => {
      mockGetHealthActivitySummary.mockResolvedValue(mockActivity);

      await getCachedHealthActivitySummary("user-1", "2024-01-15", undefined, "optional", "-03:00");
      await getCachedHealthActivitySummary("user-1", "2024-01-15", undefined, "optional", "+05:30");

      // Same user+date but different civil-day windows → two distinct fetches.
      expect(mockGetHealthActivitySummary).toHaveBeenCalledTimes(2);
    });

    it("returns cached value on second call within TTL", async () => {
      mockGetHealthActivitySummary.mockResolvedValue(mockActivity);

      await getCachedHealthActivitySummary("user-1", "2024-01-15");
      await getCachedHealthActivitySummary("user-1", "2024-01-15");

      expect(mockGetHealthActivitySummary).toHaveBeenCalledTimes(1);
    });

    it("re-fetches after TTL expiry (5min)", async () => {
      mockGetHealthActivitySummary.mockResolvedValue(mockActivity);
      const now = Date.now();
      vi.setSystemTime(now);

      await getCachedHealthActivitySummary("user-1", "2024-01-15");

      // Advance 5min + 1ms
      vi.setSystemTime(now + 5 * 60 * 1000 + 1);
      await getCachedHealthActivitySummary("user-1", "2024-01-15");

      expect(mockGetHealthActivitySummary).toHaveBeenCalledTimes(2);

      // But NOT re-fetched before 5min
      vi.resetModules();
      const mod2 = await import("@/lib/health-cache");
      vi.clearAllMocks();
      mockEnsureFreshToken.mockResolvedValue("test-access-token");
      mockGetHealthActivitySummary.mockResolvedValue(mockActivity);

      await mod2.getCachedHealthActivitySummary("user-1", "2024-01-15");
      vi.setSystemTime(now + 4 * 60 * 1000); // Only 4 min elapsed
      await mod2.getCachedHealthActivitySummary("user-1", "2024-01-15");
      expect(mockGetHealthActivitySummary).toHaveBeenCalledTimes(1);
    });

    it("two simultaneous calls collapse via in-flight Promise", async () => {
      let resolveActivity!: (v: ActivitySummary) => void;
      const activityPromise = new Promise<ActivitySummary>((resolve) => {
        resolveActivity = resolve;
      });
      mockGetHealthActivitySummary.mockReturnValue(activityPromise);

      const p1 = getCachedHealthActivitySummary("user-1", "2024-01-15");
      const p2 = getCachedHealthActivitySummary("user-1", "2024-01-15");

      resolveActivity(mockActivity);

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(mockGetHealthActivitySummary).toHaveBeenCalledTimes(1);
      expect(r1).toEqual(mockActivity);
      expect(r2).toEqual(mockActivity);
    });
  });

  // ─── bounded cache (Task 9 / FOO-1147) ──────────────────────────────────────

  describe("expired-entry eviction on read", () => {
    it("treats an expired profile cache entry as a miss and removes it from the map", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      mockGetHealthProfile.mockResolvedValue(mockProfile);

      // First call — populates cache (TTL 24h)
      await getCachedHealthProfile("user-evict");
      expect(mockGetHealthProfile).toHaveBeenCalledTimes(1);

      // Advance past 24h TTL so the entry is expired
      vi.setSystemTime(now + 25 * 60 * 60 * 1000);
      vi.clearAllMocks();
      mockEnsureFreshToken.mockResolvedValue("test-access-token");
      mockGetHealthProfile.mockResolvedValue(mockProfile);

      // Second call — must be a miss (expired entry must have been removed)
      await getCachedHealthProfile("user-evict");
      expect(mockGetHealthProfile).toHaveBeenCalledTimes(1);
    });

    it("treats an expired weight cache entry as a miss and removes it from the map", async () => {
      vi.useFakeTimers();
      const now = Date.now();
      vi.setSystemTime(now);

      mockGetHealthLatestWeightKg.mockResolvedValue(mockWeightLog);

      await getCachedHealthWeightKg("user-evict", "2024-01-15");
      expect(mockGetHealthLatestWeightKg).toHaveBeenCalledTimes(1);

      // Advance past 1h TTL (positive result)
      vi.setSystemTime(now + 2 * 60 * 60 * 1000);
      vi.clearAllMocks();
      mockEnsureFreshToken.mockResolvedValue("test-access-token");
      mockGetHealthLatestWeightKg.mockResolvedValue(mockWeightLog);

      await getCachedHealthWeightKg("user-evict", "2024-01-15");
      expect(mockGetHealthLatestWeightKg).toHaveBeenCalledTimes(1);
    });
  });

  describe("bounded cache size", () => {
    it("profile cache evicts oldest entries when size cap is exceeded", async () => {
      mockGetHealthProfile.mockResolvedValue(mockProfile);

      // Import the module to access MAX size (task says MAX_*_SIZE mirrors rate-limit = 1000)
      // We test by inserting many users and checking the map stays bounded.
      // Use a smaller bound test: insert 1002 users, verify size <= 1001 (cap+1 triggers evict)
      // In practice we just test that repeated inserts don't grow unboundedly.
      const mod = await import("@/lib/health-cache");

      // Insert entries for 1002 distinct users
      for (let i = 0; i < 1002; i++) {
        mockGetHealthProfile.mockResolvedValueOnce(mockProfile);
        await mod.getCachedHealthProfile(`size-user-${i}`);
      }

      // The cache must not exceed MAX_PROFILE_CACHE_SIZE (1000)
      // We can't access the internal map directly, but we verify that a new cache miss
      // for a previously-evicted user triggers a fresh fetch (meaning it's gone from cache).
      // Since we can't inspect the map, the behavioral test is: after many inserts, re-fetching
      // an early entry (user-0) causes a new getHealthProfile call (it was evicted).
      vi.clearAllMocks();
      mockEnsureFreshToken.mockResolvedValue("test-access-token");
      mockGetHealthProfile.mockResolvedValueOnce(mockProfile);

      // user-size-user-0 was the oldest; it should have been evicted
      await mod.getCachedHealthProfile("size-user-0");
      expect(mockGetHealthProfile).toHaveBeenCalledTimes(1);
    });
  });

  // ─── invalidateHealthProfileCache ────────────────────────────────────────

  describe("invalidateHealthProfileCache", () => {
    it("clears profile, weight, and activity entries for the given user (no weight-goal)", async () => {
      mockGetHealthProfile.mockResolvedValue(mockProfile);
      mockGetHealthLatestWeightKg.mockResolvedValue(mockWeightLog);
      mockGetHealthActivitySummary.mockResolvedValue(mockActivity);

      // Populate caches for user-1
      await getCachedHealthProfile("user-1");
      await getCachedHealthWeightKg("user-1", "2024-01-15");
      await getCachedHealthActivitySummary("user-1", "2024-01-15");

      vi.clearAllMocks();
      mockEnsureFreshToken.mockResolvedValue("test-access-token");
      mockGetHealthProfile.mockResolvedValue(mockProfile);
      mockGetHealthLatestWeightKg.mockResolvedValue(mockWeightLog);
      mockGetHealthActivitySummary.mockResolvedValue(mockActivity);

      // Invalidate
      invalidateHealthProfileCache("user-1");

      // All user-1 caches should be gone — re-fetches expected
      await getCachedHealthProfile("user-1");
      await getCachedHealthWeightKg("user-1", "2024-01-15");
      await getCachedHealthActivitySummary("user-1", "2024-01-15");

      expect(mockGetHealthProfile).toHaveBeenCalledTimes(1);
      expect(mockGetHealthLatestWeightKg).toHaveBeenCalledTimes(1);
      expect(mockGetHealthActivitySummary).toHaveBeenCalledTimes(1);
    });

    it("does not clear cache entries for other users", async () => {
      mockGetHealthProfile.mockResolvedValue(mockProfile);

      // Populate caches for both users
      await getCachedHealthProfile("user-1");
      await getCachedHealthProfile("user-2");

      vi.clearAllMocks();
      mockEnsureFreshToken.mockResolvedValue("test-access-token");
      mockGetHealthProfile.mockResolvedValue(mockProfile);

      // Invalidate only user-1
      invalidateHealthProfileCache("user-1");

      // user-2's cache should still be valid
      await getCachedHealthProfile("user-2");
      expect(mockGetHealthProfile).not.toHaveBeenCalled();

      // user-1's cache should be gone
      await getCachedHealthProfile("user-1");
      expect(mockGetHealthProfile).toHaveBeenCalledTimes(1);
    });

    it("orphan in-flight fetch from before invalidation does not overwrite fresh post-invalidation cache", async () => {
      let resolveOrphan!: (v: HealthProfile) => void;
      const orphanPromise = new Promise<HealthProfile>((resolve) => {
        resolveOrphan = resolve;
      });
      mockGetHealthProfile.mockReturnValueOnce(orphanPromise);

      const orphan = getCachedHealthProfile("user-1");
      await new Promise((r) => setImmediate(r));

      invalidateHealthProfileCache("user-1");

      const freshProfile: HealthProfile = { ageYears: 35, sex: "MALE", heightCm: 181 };
      mockGetHealthProfile.mockResolvedValueOnce(freshProfile);
      await getCachedHealthProfile("user-1");

      // Now resolve the orphan with stale data — its write must be suppressed.
      const staleProfile: HealthProfile = { ageYears: 99, sex: "FEMALE", heightCm: 100 };
      resolveOrphan(staleProfile);
      await orphan;

      // A subsequent read should return the fresh value, not the stale orphan
      mockGetHealthProfile.mockClear();
      const cached = await getCachedHealthProfile("user-1");
      expect(cached).toEqual(freshProfile);
      expect(mockGetHealthProfile).not.toHaveBeenCalled();
    });

    it("orphan settling after invalidation does not delete the newer in-flight entry", async () => {
      let resolveOrphan!: (v: HealthProfile) => void;
      const orphanPromise = new Promise<HealthProfile>((resolve) => {
        resolveOrphan = resolve;
      });
      let resolveRefresh!: (v: HealthProfile) => void;
      const refreshPromise = new Promise<HealthProfile>((resolve) => {
        resolveRefresh = resolve;
      });
      mockGetHealthProfile
        .mockReturnValueOnce(orphanPromise)
        .mockReturnValueOnce(refreshPromise);

      const orphan = getCachedHealthProfile("user-1");
      await new Promise((r) => setImmediate(r)); // orphan registers in-flight

      invalidateHealthProfileCache("user-1");

      const refresh = getCachedHealthProfile("user-1");
      await new Promise((r) => setImmediate(r)); // refresh registers in-flight

      // Settle orphan — its finally must skip the delete.
      resolveOrphan({ ageYears: 99, sex: "FEMALE", heightCm: 100 });
      await orphan;

      const concurrent = getCachedHealthProfile("user-1");

      const freshProfile: HealthProfile = { ageYears: 35, sex: "MALE", heightCm: 181 };
      resolveRefresh(freshProfile);
      const [r1, r2] = await Promise.all([refresh, concurrent]);

      expect(r1).toEqual(freshProfile);
      expect(r2).toEqual(freshProfile);
      expect(mockGetHealthProfile).toHaveBeenCalledTimes(2);
    });

    it("invalidating one user does not suppress cache writes for another user's in-flight fetch", async () => {
      let resolveB!: (v: HealthProfile) => void;
      const bPromise = new Promise<HealthProfile>((resolve) => {
        resolveB = resolve;
      });
      mockGetHealthProfile.mockImplementation((_t, _l, userId) => {
        if (userId === "user-b") return bPromise;
        return Promise.resolve(mockProfile);
      });

      const bFetch = getCachedHealthProfile("user-b");
      await new Promise((r) => setImmediate(r));

      invalidateHealthProfileCache("user-a");

      const bProfile: HealthProfile = { ageYears: 42, sex: "MALE", heightCm: 175 };
      resolveB(bProfile);
      await bFetch;

      mockGetHealthProfile.mockClear();
      const cached = await getCachedHealthProfile("user-b");
      expect(cached).toEqual(bProfile);
      expect(mockGetHealthProfile).not.toHaveBeenCalled();
    });

    it("clears in-flight dedup entries so a refresh after a pending fetch triggers a new call", async () => {
      let resolveFirst!: (v: HealthProfile) => void;
      const firstFetchPromise = new Promise<HealthProfile>((resolve) => {
        resolveFirst = resolve;
      });
      mockGetHealthProfile.mockReturnValueOnce(firstFetchPromise);

      const inflight = getCachedHealthProfile("user-1");
      await new Promise((r) => setImmediate(r));

      invalidateHealthProfileCache("user-1");

      mockGetHealthProfile.mockResolvedValueOnce(mockProfile);
      const refresh = getCachedHealthProfile("user-1");

      resolveFirst({ ageYears: 99, sex: "FEMALE", heightCm: 100 });
      await Promise.all([inflight, refresh]);

      expect(mockGetHealthProfile).toHaveBeenCalledTimes(2);
    });
  });
});
