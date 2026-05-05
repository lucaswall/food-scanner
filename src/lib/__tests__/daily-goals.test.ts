import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Fitbit-cache mocks (module created by Worker 2) ───────────────────────
const mockGetCachedFitbitProfile = vi.fn();
const mockGetCachedFitbitWeightKg = vi.fn();
const mockGetCachedFitbitWeightGoal = vi.fn();
const mockGetCachedActivitySummary = vi.fn();

vi.mock("@/lib/fitbit-cache", () => ({
  getCachedFitbitProfile: (...args: unknown[]) => mockGetCachedFitbitProfile(...args),
  getCachedFitbitWeightKg: (...args: unknown[]) => mockGetCachedFitbitWeightKg(...args),
  getCachedFitbitWeightGoal: (...args: unknown[]) => mockGetCachedFitbitWeightGoal(...args),
  getCachedActivitySummary: (...args: unknown[]) => mockGetCachedActivitySummary(...args),
}));

// ─── DB mock ────────────────────────────────────────────────────────────────
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

vi.mock("@/db/index", () => ({ getDb: () => mockDb }));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => `eq:${val}`),
  and: vi.fn((...args: unknown[]) => `and:(${args.join(",")})`),
  gte: vi.fn((_col: unknown, val: unknown) => `gte:${val}`),
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: mockLogger, createRequestLogger: vi.fn(() => mockLogger) };
});

// ─── DB helper factories ────────────────────────────────────────────────────
function mockSelectOnce(rows: Record<string, unknown>[] = []) {
  const where = vi.fn().mockResolvedValueOnce(rows);
  const from = vi.fn().mockReturnValue({ where });
  mockDb.select.mockReturnValueOnce({ from });
  return { where };
}

function mockInsertOnce() {
  const onConflictDoNothing = vi.fn().mockResolvedValueOnce(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  mockDb.insert.mockReturnValueOnce({ values });
  return { onConflictDoNothing, values };
}

function mockUpdateOnce() {
  const where = vi.fn().mockResolvedValueOnce(undefined);
  const set = vi.fn().mockReturnValue({ where });
  mockDb.update.mockReturnValueOnce({ set });
  return { where, set };
}

/**
 * Queue the macro-profile lookup that doCompute performs after the no_weight /
 * sex_unset guards but before computing macros. Defaults to muscle_preserve so
 * existing scenario assertions (which use muscle-preserve coefficients) hold.
 */
function mockMacroProfileSelect(key: string = "muscle_preserve", version: number = 1) {
  return mockSelectOnce([{ macroProfile: key, macroProfileVersion: version }]);
}

/** Queue the version-only select used by the cache-hit race-safety check (FOO-996). */
function mockMacroProfileVersionSelect(version: number = 1) {
  return mockSelectOnce([{ macroProfileVersion: version }]);
}

// ─── Sample data ─────────────────────────────────────────────────────────────
const PROFILE_MALE = { sex: "MALE" as const, ageYears: 49, heightCm: 176 };
const PROFILE_FEMALE = { sex: "FEMALE" as const, ageYears: 44, heightCm: 162 };
const PROFILE_NA = { sex: "NA" as const, ageYears: 30, heightCm: 170 };
const WEIGHT_GOAL_LOSE = { goalType: "LOSE" as const };
const WEIGHT_GOAL_MAINTAIN = { goalType: "MAINTAIN" as const };
const ACTIVITY_3000 = { caloriesOut: 3000 };
const ACTIVITY_NULL = { caloriesOut: null };

// Expected computed row for MALE/LOSE/121kg/3000 caloriesOut scenario
const COMPUTED_ROW = {
  calorieGoal: 2289,
  proteinGoal: 218,
  carbsGoal: 136,
  fatGoal: 97,
  weightKg: "121",
  caloriesOut: 3000,
  rmr: 2070,
  activityKcal: 791,
  goalType: "LOSE" as const,
  bmiTier: "ge30" as const,
  profileVersion: 1,
  weightLoggedDate: "2026-05-03",
};

// ─── Module import (after mocks set up) ─────────────────────────────────────
const { getOrComputeDailyGoals, getDailyGoalsByDate } = await import("@/lib/daily-goals");

describe("getOrComputeDailyGoals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mockReturnValueOnce queues to prevent bleed between tests
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── Status: ok — fresh compute ──────────────────────────────────────────
  describe("first call — writes row and returns ok", () => {
    it("returns status: ok with goals and audit", async () => {
      mockSelectOnce([]); // no existing row
      mockMacroProfileSelect();
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]); // read-back
      // Cache-hit path re-fetches profile/goal for bmiTier/goalType
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-a", "2026-05-03");

      expect(result.status).toBe("ok");
    });

    it("returns correct goals from computed row", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-b", "2026-05-03");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.goals.calorieGoal).toBe(2289);
      expect(result.goals.proteinGoal).toBe(218);
      expect(result.goals.carbsGoal).toBe(136);
      expect(result.goals.fatGoal).toBe(97);
    });

    it("returns audit with rmr, activityKcal, tdee, bmiTier, goalType, caloriesOut", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-c", "2026-05-03");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.audit.rmr).toBe(2070);
      expect(result.audit.activityKcal).toBe(791);
      expect(result.audit.tdee).toBe(2861);
      expect(result.audit.bmiTier).toBe("ge30"); // BMI=39 for 121kg/176cm
      expect(result.audit.goalType).toBe("LOSE");
      expect(result.audit.weightKg).toBe("121");
      expect(result.audit.caloriesOut).toBe(3000);
    });

    it("calls INSERT with ON CONFLICT DO NOTHING", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      const { onConflictDoNothing } = mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      await getOrComputeDailyGoals("user-d", "2026-05-03");

      expect(onConflictDoNothing).toHaveBeenCalled();
    });

    it("persists goal_type, bmi_tier, profile_version, weight_logged_date on INSERT", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect("muscle_preserve", 7);
      const { values } = mockInsertOnce();
      // Fresh insert (no conflict) — read-back reflects what was just inserted (profileVersion=7).
      mockSelectOnce([{ ...COMPUTED_ROW, profileVersion: 7 }]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-02" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      await getOrComputeDailyGoals("user-persist", "2026-05-03");

      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({
          goalType: "LOSE",
          bmiTier: "ge30",
          profileVersion: 7,
          weightLoggedDate: "2026-05-02",
        }),
      );
    });
  });

  // ─── In-flight Promise dedup ──────────────────────────────────────────────
  describe("concurrent calls dedupe via in-flight map", () => {
    it("two simultaneous calls return the same promise", async () => {
      // Both calls fire before the first resolves
      // We hold activity mock as a deferred promise
      let resolveActivity!: (val: { caloriesOut: number }) => void;
      const activityPromise = new Promise<{ caloriesOut: number }>((resolve) => {
        resolveActivity = resolve;
      });

      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      // Activity is deferred
      mockGetCachedActivitySummary.mockReturnValue(activityPromise);

      const p1 = getOrComputeDailyGoals("user-dedup", "2026-05-01");
      const p2 = getOrComputeDailyGoals("user-dedup", "2026-05-01");

      // Both calls should be the same promise object
      expect(p1).toBe(p2);

      // Now resolve the deferred activity
      resolveActivity({ caloriesOut: 3000 });
      // Also need profile re-fetch for cache-hit path after insert
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(r2); // same object reference
    });

    it("underlying Fitbit fetch is called exactly once", async () => {
      let resolveActivity!: (val: { caloriesOut: number }) => void;
      const activityPromise = new Promise<{ caloriesOut: number }>((resolve) => {
        resolveActivity = resolve;
      });

      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockReturnValue(activityPromise);

      const p1 = getOrComputeDailyGoals("user-dedup2", "2026-05-02");
      const p2 = getOrComputeDailyGoals("user-dedup2", "2026-05-02");

      resolveActivity({ caloriesOut: 3000 });
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      await Promise.all([p1, p2]);

      // getCachedActivitySummary called only once despite two callers
      expect(mockGetCachedActivitySummary).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Cache-hit: subsequent same-day call reads DB ─────────────────────────
  describe("cache-hit: subsequent same-day call reads existing row", () => {
    it("returns ok with cached data when row has macro+audit columns", async () => {
      // Row already has macros populated
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect(); // FOO-996 race-safety check
      // Re-fetch profile/goal for bmiTier + goalType
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      const result = await getOrComputeDailyGoals("user-cache", "2026-04-30");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.goals.proteinGoal).toBe(218);
      expect(result.audit.bmiTier).toBe("ge30");
    });

    it("calls getCachedActivitySummary with 'optional' criticality on cache-hit (FOO-1009 ratchet)", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      // Same caloriesOut → no ratchet UPDATE, but the fetch still happens.
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: 3000 });

      await getOrComputeDailyGoals("user-cache2", "2026-04-29");

      expect(mockGetCachedActivitySummary).toHaveBeenCalledWith(
        "user-cache2",
        "2026-04-29",
        expect.any(Object),
        "optional",
      );
    });

    it("does NOT call INSERT when row is cached", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      await getOrComputeDailyGoals("user-cache3", "2026-04-28");

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("falls back to degraded audit when breaker rejects optional re-fetches on legacy row (FOO-1014)", async () => {
      // Legacy row predating F1 — no stored goalType/bmiTier, so the cache-hit
      // path must rely on the live re-fetch, which the breaker rejects here.
      const legacyRow = {
        ...COMPUTED_ROW,
        goalType: null,
        bmiTier: null,
        profileVersion: null,
        weightLoggedDate: null,
      };
      mockSelectOnce([legacyRow]);
      // Both optional re-fetches are blocked by the breaker.
      mockGetCachedFitbitProfile.mockRejectedValue(new Error("FITBIT_RATE_LIMIT_LOW"));
      mockGetCachedFitbitWeightGoal.mockRejectedValue(new Error("FITBIT_RATE_LIMIT_LOW"));

      const result = await getOrComputeDailyGoals("user-breaker", "2026-04-30");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      // Stored macros are still served
      expect(result.goals.proteinGoal).toBe(218);
      expect(result.goals.calorieGoal).toBe(2289);
      // Audit is degraded — bmiTier defaults to "lt25", goalType to "MAINTAIN"
      expect(result.audit.bmiTier).toBe("lt25");
      expect(result.audit.goalType).toBe("MAINTAIN");
    });

    it("re-throws non-breaker errors from the cache-hit re-fetch", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockGetCachedFitbitProfile.mockRejectedValue(new Error("FITBIT_TOKEN_INVALID"));
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      await expect(getOrComputeDailyGoals("user-fail", "2026-04-30")).rejects.toThrow(
        "FITBIT_TOKEN_INVALID",
      );
    });

    it("uses 'optional' criticality on the cache-hit re-fetch", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      await getOrComputeDailyGoals("user-cache4", "2026-04-30");

      expect(mockGetCachedFitbitProfile).toHaveBeenCalledWith(
        "user-cache4",
        expect.any(Object),
        "optional",
      );
      expect(mockGetCachedFitbitWeightGoal).toHaveBeenCalledWith(
        "user-cache4",
        expect.any(Object),
        "optional",
      );
    });

    // ─── FOO-1009: ratchet-up recompute on read ──────────────────────────────
    it("ratchet-up: cache-hit re-fetches activity and updates row when new target exceeds stored", async () => {
      // Stored: caloriesOut 3000, calorieGoal 2289 (LOSE).
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockMacroProfileSelect(); // ratchet's loadUserMacroProfile
      const ratchetUpdate = mockUpdateOnce();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      // After a workout: caloriesOut grows to 4500.
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: 4500 });

      const result = await getOrComputeDailyGoals("user-ratchet-up", "2026-05-03");

      // computeMacroTargets(MALE, 49y, 176cm, 121kg, 4500, LOSE):
      // RMR=2070, activity=round(max(0,2430)*0.85)=2066, tdee=4136, target=round(4136*0.80)=3309
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.audit.caloriesOut).toBe(4500);
      expect(result.goals.calorieGoal).toBeGreaterThan(2289);
      expect(ratchetUpdate.set).toHaveBeenCalled();
    });

    it("ratchet-up: does NOT update when new target equals stored", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockMacroProfileSelect(); // ratchet's loadUserMacroProfile
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      // Same caloriesOut → same target.
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: 3000 });

      await getOrComputeDailyGoals("user-ratchet-equal", "2026-05-03");

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("ratchet-up: does NOT update when new target lower than stored", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockMacroProfileSelect(); // ratchet's loadUserMacroProfile (still called)
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      // Live caloriesOut DROPS — sedentary device sample. Don't ratchet down.
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: 2200 });

      const result = await getOrComputeDailyGoals("user-ratchet-down", "2026-05-03");

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      // Stored target preserved.
      expect(result.goals.calorieGoal).toBe(2289);
    });

    it("ratchet-up: skipped when activity below RMR×1.05 threshold", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      // Below RMR threshold (2070*1.05=2173.5) — too noisy to anchor.
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: 1500 });

      await getOrComputeDailyGoals("user-ratchet-noisy", "2026-05-03");

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("ratchet-up: gracefully degrades when activity fetch rejected by breaker", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockRejectedValue(new Error("FITBIT_RATE_LIMIT_LOW"));

      const result = await getOrComputeDailyGoals("user-ratchet-breaker", "2026-05-03");

      // Stored target served — no UPDATE.
      expect(mockDb.update).not.toHaveBeenCalled();
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.goals.calorieGoal).toBe(2289);
    });

    it("ratchet-up: serves stored row when activity fetch fails with non-breaker error (bug-hunter Bug 1)", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      // Any non-breaker activity error must NOT bubble — the ratchet is optional.
      mockGetCachedActivitySummary.mockRejectedValue(new Error("FITBIT_API_ERROR"));

      const result = await getOrComputeDailyGoals("user-act-error", "2026-05-03");

      expect(mockDb.update).not.toHaveBeenCalled();
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.goals.calorieGoal).toBe(2289);
    });

    // ─── FOO-996: profile version mismatch triggers full recompute ──────────
    it("cache-hit falls through to full compute when stored profile_version mismatches user version", async () => {
      // Stored row has profileVersion 1; user has bumped to 2.
      const oldVersionRow = { ...COMPUTED_ROW, profileVersion: 1 };
      mockSelectOnce([oldVersionRow]); // queryRow
      mockMacroProfileVersionSelect(2); // cache-hit version check sees 2 → mismatch
      mockMacroProfileSelect("muscle_preserve", 2); // slow-path profile load
      mockInsertOnce();
      mockSelectOnce([{ ...COMPUTED_ROW, profileVersion: 2 }]); // read-back

      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      await getOrComputeDailyGoals("user-version-mismatch", "2026-05-03");

      // Full-compute path was taken — getCachedActivitySummary called with the
      // slow-path "important" criticality (cache-hit fast path uses "optional").
      // FOO-1027: discriminates the slow path; toHaveBeenCalled() alone passes
      // both paths because the ratchet on cache-hit also fetches activity.
      expect(mockGetCachedActivitySummary).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        "important",
      );
    });

    // ─── FOO-1029 (PR review P1): version mismatch persists recomputed row ──
    it("forces UPDATE of stale row when persisted profile_version mismatches user version", async () => {
      // Race scenario: an older in-flight compute wrote profileVersion=1, then
      // PATCH bumped users.macro_profile_version to 2. Next read sees mismatch
      // and falls through to full compute. The INSERT...ON CONFLICT DO NOTHING
      // is a no-op (row exists), so the read-back returns the OLD row with
      // profileVersion=1. Without the version-aware UPDATE, the row stays
      // stale and every subsequent read mismatches → infinite recompute storm.
      const staleVersionRow = { ...COMPUTED_ROW, profileVersion: 1, calorieGoal: 1000 };
      mockSelectOnce([staleVersionRow]); // queryRow
      mockMacroProfileVersionSelect(2); // cache-hit version check sees 2 → mismatch
      mockMacroProfileSelect("muscle_preserve", 2); // slow-path profile load
      mockInsertOnce(); // no-op due to row exists
      mockSelectOnce([staleVersionRow]); // read-back: row STILL stale (insert was no-op)
      const updateMock = mockUpdateOnce(); // expect forced UPDATE because version stale

      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-version-stale", "2026-05-03");

      expect(mockDb.update).toHaveBeenCalled();
      expect(updateMock.set).toHaveBeenCalledWith(
        expect.objectContaining({
          profileVersion: 2,
          calorieGoal: 2289,
          proteinGoal: 218,
          carbsGoal: 136,
          fatGoal: 97,
        }),
      );
      // The returned goals must match what we just persisted (engineOut), not
      // the in-memory stale row.calorieGoal — otherwise this call serves stale
      // data even though the DB has been refreshed.
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.goals.calorieGoal).toBe(2289);
    });

    // ─── FOO-1023: cache-hit guarded against null caloriesOut ───────────────
    it("cache-hit bypassed when stored row has null caloriesOut", async () => {
      // Row has macros populated but caloriesOut is null — hasMacros() must
      // reject it so the cache-hit fast path doesn't return audit.caloriesOut!
      // as a number (latent null deref in TargetsCard).
      const nullCaloriesOutRow = { ...COMPUTED_ROW, caloriesOut: null };
      mockSelectOnce([nullCaloriesOutRow]); // queryRow — hasMacros returns false
      // No FOO-996 version select queued: hasMacros=false short-circuits the
      // cacheHit && check before loadUserMacroProfileVersion runs.
      mockMacroProfileSelect(); // slow-path loadUserMacroProfile
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]); // read-back

      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      await getOrComputeDailyGoals("user-null-cout", "2026-05-03");

      // Slow path takes "important" criticality; cache-hit ratchet uses "optional".
      expect(mockGetCachedActivitySummary).toHaveBeenCalledWith(
        "user-null-cout",
        "2026-05-03",
        expect.any(Object),
        "important",
      );
    });

    // ─── FOO-1010: weight staleness ─────────────────────────────────────────
    it("audit exposes weightLoggedDate and weightStale flag set when >7 days old", async () => {
      // Target date is 2026-05-03; weight logged 2026-04-25 (8 days ago) → stale.
      const staleRow = { ...COMPUTED_ROW, weightLoggedDate: "2026-04-25" };
      mockSelectOnce([staleRow]);
      mockMacroProfileVersionSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      const result = await getOrComputeDailyGoals("user-stale", "2026-05-03");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.audit.weightLoggedDate).toBe("2026-04-25");
      expect(result.weightStale).toBe(true);
    });

    it("does NOT set weightStale when log is within 7 days", async () => {
      // Target 2026-05-03; weight logged 2026-04-30 (3 days ago) → fresh.
      const freshRow = { ...COMPUTED_ROW, weightLoggedDate: "2026-04-30" };
      mockSelectOnce([freshRow]);
      mockMacroProfileVersionSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      const result = await getOrComputeDailyGoals("user-fresh", "2026-05-03");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.weightStale).toBeFalsy();
    });

    // ─── FOO-1000: audit exposes raw caloriesOut ─────────────────────────────
    it("audit includes raw caloriesOut from stored row", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      const result = await getOrComputeDailyGoals("user-co", "2026-05-03");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.audit.caloriesOut).toBe(3000);
      expect(result.audit.activityKcal).toBe(791);
    });

    // ─── FOO-993: stored audit columns (goalType, bmiTier) ──────────────────
    it("returns stored goalType and bmiTier from row, not current Fitbit state", async () => {
      // Row was written under LOSE goal (goalType: "LOSE" stored).
      mockSelectOnce([COMPUTED_ROW]);
      mockMacroProfileVersionSelect();
      // User has since changed Fitbit goal to MAINTAIN.
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_MAINTAIN);

      const result = await getOrComputeDailyGoals("user-stored-audit", "2026-05-03");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.audit.goalType).toBe("LOSE");
      expect(result.audit.bmiTier).toBe("ge30");
    });

    it("falls back to current Fitbit goalType/bmiTier when stored values are null (legacy row)", async () => {
      // Legacy row predating F1 — goalType/bmiTier columns are null.
      const legacyRow = {
        ...COMPUTED_ROW,
        goalType: null,
        bmiTier: null,
        profileVersion: null,
        weightLoggedDate: null,
      };
      mockSelectOnce([legacyRow]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      const result = await getOrComputeDailyGoals("user-legacy", "2026-05-03");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.audit.goalType).toBe("LOSE");
      expect(result.audit.bmiTier).toBe("ge30");
    });
  });

  describe("full-compute breaker propagation (FOO-1014)", () => {
    it.each([
      ["getCachedFitbitProfile", "profile"],
      ["getCachedFitbitWeightKg", "weight"],
      ["getCachedFitbitWeightGoal", "weightGoal"],
      ["getCachedActivitySummary", "activity"],
    ] as const)(
      "propagates FITBIT_RATE_LIMIT_LOW thrown by %s",
      async (_name, which) => {
        mockSelectOnce([]); // no existing row → take the full-compute path

        const lowError = new Error("FITBIT_RATE_LIMIT_LOW");
        mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
        mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 80, loggedDate: "2026-05-04" });
        mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_MAINTAIN);
        mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

        if (which === "profile") mockGetCachedFitbitProfile.mockRejectedValue(lowError);
        if (which === "weight") mockGetCachedFitbitWeightKg.mockRejectedValue(lowError);
        if (which === "weightGoal") mockGetCachedFitbitWeightGoal.mockRejectedValue(lowError);
        if (which === "activity") mockGetCachedActivitySummary.mockRejectedValue(lowError);

        await expect(getOrComputeDailyGoals(`user-low-${which}`, "2026-05-04")).rejects.toThrow(
          "FITBIT_RATE_LIMIT_LOW",
        );
      },
    );

    it("uses 'important' criticality on the full-compute fan-out", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 80, loggedDate: "2026-05-04" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_MAINTAIN);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);
      mockInsertOnce();
      mockSelectOnce([{ ...COMPUTED_ROW, weightKg: "80" }]);

      await getOrComputeDailyGoals("user-imp", "2026-05-04");

      expect(mockGetCachedActivitySummary).toHaveBeenCalledWith(
        "user-imp",
        "2026-05-04",
        expect.any(Object),
        "important",
      );
    });
  });

  // ─── Status: blocked — no_weight ─────────────────────────────────────────
  describe("blocked: no_weight", () => {
    it("returns blocked/no_weight when weight walk-back is null", async () => {
      mockSelectOnce([]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(null); // walk-back returned null
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_MAINTAIN);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-nw", "2026-05-03");

      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") return;
      expect(result.reason).toBe("no_weight");
    });
  });

  // ─── Status: blocked — sex_unset ─────────────────────────────────────────
  describe("blocked: sex_unset", () => {
    it("returns blocked/sex_unset when profile sex is NA", async () => {
      mockSelectOnce([]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_NA);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 70, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_MAINTAIN);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-na", "2026-05-03");

      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") return;
      expect(result.reason).toBe("sex_unset");
    });
  });

  // ─── Status: blocked — scope_mismatch ────────────────────────────────────
  // ─── Status: blocked — invalid_activity ──────────────────────────────────
  describe("blocked: invalid_activity (FOO-998)", () => {
    it("returns blocked/invalid_activity when computeMacroTargets throws INVALID_ACTIVITY_DATA", async () => {
      mockSelectOnce([]); // no existing row
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 70, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_MAINTAIN);
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: Number.NaN });

      const result = await getOrComputeDailyGoals("user-bad-activity", "2026-05-03");

      expect(result).toEqual({ status: "blocked", reason: "invalid_activity" });
    });

    // ─── FOO-1030 (PR review P2): negative caloriesOut blocks, not partial ──
    it("returns blocked/invalid_activity when caloriesOut is negative (not partial)", async () => {
      // Negative caloriesOut is < rmrThreshold, so the FOO-999 partial gate
      // would mask it as a normal "partial" state — bypassing the macro-engine
      // INVALID_ACTIVITY_DATA validation. The fix gates invalid values explicitly.
      mockSelectOnce([]); // no existing row
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: -100 });

      const result = await getOrComputeDailyGoals("user-neg-cout", "2026-05-03");

      expect(result).toEqual({ status: "blocked", reason: "invalid_activity" });
    });
  });

  describe("blocked: invalid_profile", () => {
    it("returns blocked/invalid_profile when computeMacroTargets throws INVALID_PROFILE_DATA", async () => {
      mockSelectOnce([]); // no existing row
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue({ sex: "MALE", ageYears: 30, heightCm: 0 });
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 70, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_MAINTAIN);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-bad-profile", "2026-05-03");

      expect(result).toEqual({ status: "blocked", reason: "invalid_profile" });
    });
  });

  describe("blocked: scope_mismatch", () => {
    it("returns blocked/scope_mismatch when FITBIT_SCOPE_MISSING is thrown", async () => {
      mockSelectOnce([]);
      mockGetCachedFitbitProfile.mockRejectedValue(new Error("FITBIT_SCOPE_MISSING"));

      const result = await getOrComputeDailyGoals("user-scope", "2026-05-03");

      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") return;
      expect(result.reason).toBe("scope_mismatch");
    });

    it("propagates non-Fitbit errors", async () => {
      mockSelectOnce([]);
      mockGetCachedFitbitProfile.mockRejectedValue(new Error("DATABASE_ERROR"));

      await expect(getOrComputeDailyGoals("user-err", "2026-05-03")).rejects.toThrow("DATABASE_ERROR");
    });
  });

  // ─── Status: partial — activity has no caloriesOut ───────────────────────
  describe("partial: activity has no caloriesOut", () => {
    it("returns partial with proteinG and fatG", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_NULL);

      const result = await getOrComputeDailyGoals("user-partial", "2026-05-03");

      expect(result.status).toBe("partial");
      if (result.status !== "partial") return;
      // BMI = 39 → "ge30", LOSE → coeff 1.8
      // protein_g = round(121 * 1.8) = 218
      expect(result.proteinG).toBe(218);
      // fat_g = round(121 * 0.8) = 97
      expect(result.fatG).toBe(97);
    });

    it("does NOT call INSERT for partial result", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_NULL);

      await getOrComputeDailyGoals("user-partial2", "2026-05-03");

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    // ─── FOO-999: below-RMR caloriesOut → partial ────────────────────────────
    // For 49y/M/176cm/121kg, RMR = 2070. Threshold = 2070 * 1.05 = 2173.5
    it("returns partial when caloriesOut === 0 (FOO-999)", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: 0 });

      const result = await getOrComputeDailyGoals("user-zero-co", "2026-05-03");

      expect(result.status).toBe("partial");
    });

    it("returns partial when caloriesOut equals RMR exactly (FOO-999)", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: 2070 });

      const result = await getOrComputeDailyGoals("user-eq-rmr", "2026-05-03");

      expect(result.status).toBe("partial");
    });

    it("returns partial when caloriesOut just below 1.05 × RMR (FOO-999)", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: Math.floor(2070 * 1.04) });

      const result = await getOrComputeDailyGoals("user-below-thresh", "2026-05-03");

      expect(result.status).toBe("partial");
    });

    it("returns ok when caloriesOut at 1.05 × RMR (FOO-999)", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: Math.ceil(2070 * 1.05) });

      const result = await getOrComputeDailyGoals("user-at-thresh", "2026-05-03");

      expect(result.status).toBe("ok");
    });

    it("uses default MAINTAIN goalType for partial when weight goal is unavailable", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_FEMALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 65, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(null); // goal not available
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_NULL);

      const result = await getOrComputeDailyGoals("user-partial3", "2026-05-03");

      expect(result.status).toBe("partial");
      if (result.status !== "partial") return;
      // BMI = 65/(1.62^2) ≈ 24.77 → "lt25", MAINTAIN → coeff 1.6
      // protein_g = round(65 * 1.6) = 104
      expect(result.proteinG).toBe(104);
    });
  });

  // ─── ON CONFLICT race: Lumen-backfilled row gets macros updated ──────────
  describe("Lumen-backfilled row gets macros only", () => {
    it("UPDATEs macro+audit columns when row exists with null macros after INSERT conflict", async () => {
      const lumenRow = {
        calorieGoal: 1800, // Lumen-set calorie goal
        proteinGoal: null,
        carbsGoal: null,
        fatGoal: null,
        weightKg: null,
        caloriesOut: null,
        rmr: null,
        activityKcal: null,
      };
      mockSelectOnce([]); // initial check: no row with macros
      mockMacroProfileSelect();
      mockInsertOnce(); // ON CONFLICT DO NOTHING (Lumen row exists, no-op)
      mockSelectOnce([lumenRow]); // read-back: returns Lumen row (null macros)
      mockUpdateOnce(); // UPDATE macro+audit columns
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-lumen", "2026-05-03");

      expect(result.status).toBe("ok");
      expect(mockDb.update).toHaveBeenCalled();
    });

    it("preserves the Lumen calorieGoal (does not overwrite with targetKcal)", async () => {
      const lumenRow = {
        calorieGoal: 1800,
        proteinGoal: null,
        carbsGoal: null,
        fatGoal: null,
        weightKg: null,
        caloriesOut: null,
        rmr: null,
        activityKcal: null,
      };
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockInsertOnce();
      mockSelectOnce([lumenRow]);
      mockUpdateOnce();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-lumen2", "2026-05-03");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      // calorieGoal should come from the existing Lumen row
      expect(result.goals.calorieGoal).toBe(1800);
    });

    it("does NOT UPDATE when macros are already populated", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]); // read-back has macros populated
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      await getOrComputeDailyGoals("user-nomacro", "2026-05-03");

      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it("uses engine targetKcal when existing row has calorieGoal=0 placeholder", async () => {
      const placeholderRow = {
        calorieGoal: 0, // backfill placeholder for days with no daily_calorie_goals row
        proteinGoal: null,
        carbsGoal: null,
        fatGoal: null,
        weightKg: null,
        caloriesOut: null,
        rmr: null,
        activityKcal: null,
      };
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockInsertOnce();
      mockSelectOnce([placeholderRow]);
      const updateMock = mockUpdateOnce();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 121, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-placeholder", "2026-05-03");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.goals.calorieGoal).toBe(COMPUTED_ROW.calorieGoal);
      expect(result.goals.calorieGoal).toBeGreaterThan(0);
      // The recompute UPDATE should also overwrite the placeholder calorieGoal
      expect(updateMock.set).toHaveBeenCalledWith(
        expect.objectContaining({ calorieGoal: COMPUTED_ROW.calorieGoal }),
      );
    });
  });

  // ─── Female scenario ──────────────────────────────────────────────────────
  describe("female scenario: 44y/F/162cm/65kg/MAINTAIN/2200", () => {
    const FEMALE_COMPUTED_ROW = {
      calorieGoal: 2062,
      proteinGoal: 104,
      carbsGoal: 283,
      fatGoal: 57,
      weightKg: "65",
      caloriesOut: 2200,
      rmr: 1282,
      activityKcal: 780,
      profileVersion: 1,
    };

    it("returns correct goals and audit for female scenario", async () => {
      mockSelectOnce([]);
      mockMacroProfileSelect();
      mockInsertOnce();
      mockSelectOnce([FEMALE_COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_FEMALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 65, loggedDate: "2026-05-03" });
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_MAINTAIN);
      mockGetCachedActivitySummary.mockResolvedValue({ caloriesOut: 2200 });

      const result = await getOrComputeDailyGoals("user-female", "2026-05-03");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.goals.proteinGoal).toBe(104);
      expect(result.audit.bmiTier).toBe("lt25"); // BMI ≈ 24.77
    });
  });
});

// ─── invalidateUserDailyGoalsForProfileChange + invalidateUserDailyGoalsForDate ─
const {
  invalidateUserDailyGoalsForProfileChange,
  invalidateUserDailyGoalsForDate,
} = await import("@/lib/daily-goals");

describe("invalidateUserDailyGoalsForDate (FOO-992)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReset();
  });

  it("scopes the UPDATE to the single (userId, date) row", async () => {
    const updateMock = mockUpdateOnce();

    await invalidateUserDailyGoalsForDate("user-x", "2026-05-04");

    const whereCall = updateMock.where.mock.calls[0][0];
    expect(String(whereCall)).toContain("eq:user-x");
    expect(String(whereCall)).toContain("eq:2026-05-04");
  });

  it("zeroes macro+audit columns including F1 columns", async () => {
    const updateMock = mockUpdateOnce();

    await invalidateUserDailyGoalsForDate("user-x", "2026-05-04");

    expect(updateMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        calorieGoal: 0,
        proteinGoal: null,
        goalType: null,
        bmiTier: null,
        profileVersion: null,
        weightLoggedDate: null,
      }),
    );
  });
});

describe("invalidateUserDailyGoalsForProfileChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReset();
  });

  it("scopes the UPDATE to today + future dates only (FOO-995)", async () => {
    const updateMock = mockUpdateOnce();

    await invalidateUserDailyGoalsForProfileChange("user-a", "2026-05-04");

    // The where clause must combine the userId equality and a gte:date constraint.
    const whereCall = updateMock.where.mock.calls[0][0];
    expect(String(whereCall)).toContain("eq:user-a");
    expect(String(whereCall)).toContain("gte:2026-05-04");
  });

  it("clears in-flight keys only for fromDate and after", async () => {
    // Run with fromDate = 2026-05-04. Past dates should NOT be touched.
    // We can only assert behavior indirectly through the SQL built by where().
    mockUpdateOnce();
    await invalidateUserDailyGoalsForProfileChange("user-b", "2026-05-04");
    // No specific assertion beyond not throwing — the SQL assertion above
    // already covers the date scoping; the in-flight scoping is internal.
  });
});

// ─── getDailyGoalsByDate ──────────────────────────────────────────────────────
describe("getDailyGoalsByDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
  });

  it("returns null when no row exists", async () => {
    mockSelectOnce([]);

    const result = await getDailyGoalsByDate("user-1", "2026-05-03");

    expect(result).toBeNull();
  });

  it("returns row data when row exists", async () => {
    const row = {
      date: "2026-05-03",
      calorieGoal: 2289,
      proteinGoal: 218,
      carbsGoal: 136,
      fatGoal: 97,
      weightKg: "121",
      caloriesOut: 3000,
      rmr: 2070,
      activityKcal: 791,
    };
    mockSelectOnce([row]);

    const result = await getDailyGoalsByDate("user-1", "2026-05-03");

    expect(result).not.toBeNull();
    expect(result?.calorieGoal).toBe(2289);
    expect(result?.proteinGoal).toBe(218);
    expect(result?.carbsGoal).toBe(136);
    expect(result?.fatGoal).toBe(97);
    expect(result?.weightKg).toBe("121");
    expect(result?.caloriesOut).toBe(3000);
    expect(result?.rmr).toBe(2070);
    expect(result?.activityKcal).toBe(791);
  });

  it("returns null fields for uncomputed macros", async () => {
    const row = {
      date: "2026-05-03",
      calorieGoal: 1800,
      proteinGoal: null,
      carbsGoal: null,
      fatGoal: null,
      weightKg: null,
      caloriesOut: null,
      rmr: null,
      activityKcal: null,
    };
    mockSelectOnce([row]);

    const result = await getDailyGoalsByDate("user-1", "2026-05-03");

    expect(result?.calorieGoal).toBe(1800);
    expect(result?.proteinGoal).toBeNull();
    expect(result?.rmr).toBeNull();
  });
});
