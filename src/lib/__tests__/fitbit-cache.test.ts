import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FitbitProfile, FitbitWeightLog, FitbitWeightGoal, ActivitySummary } from "@/types";
import type { Logger } from "@/lib/logger";

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
  let getCachedFitbitProfile: (userId: string, log?: Logger) => Promise<FitbitProfile>;
  let getCachedFitbitWeightKg: (userId: string, targetDate: string, log?: Logger) => Promise<FitbitWeightLog | null>;
  let getCachedFitbitWeightGoal: (userId: string, log?: Logger) => Promise<FitbitWeightGoal | null>;
  let getCachedActivitySummary: (userId: string, targetDate: string, log?: Logger) => Promise<ActivitySummary>;
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
      expect(mockGetFitbitProfile).toHaveBeenCalledWith("test-access-token", expect.any(Object));
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
  });

  // ─── getCachedFitbitWeightKg ──────────────────────────────────────────────

  describe("getCachedFitbitWeightKg", () => {
    it("calls getFitbitLatestWeightKg on first call", async () => {
      mockGetFitbitLatestWeightKg.mockResolvedValue(mockWeightLog);

      const result = await getCachedFitbitWeightKg("user-1", "2024-01-15");

      expect(mockGetFitbitLatestWeightKg).toHaveBeenCalledWith("test-access-token", "2024-01-15", expect.any(Object));
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

      expect(mockGetFitbitWeightGoal).toHaveBeenCalledWith("test-access-token", expect.any(Object));
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

      expect(mockGetActivitySummary).toHaveBeenCalledWith("test-access-token", "2024-01-15", expect.any(Object));
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
  });
});
