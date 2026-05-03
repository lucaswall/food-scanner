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
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]); // read-back
      // Cache-hit path re-fetches profile/goal for bmiTier/goalType
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-a", "2026-05-03");

      expect(result.status).toBe("ok");
    });

    it("returns correct goals from computed row", async () => {
      mockSelectOnce([]);
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
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

    it("returns audit with rmr, activityKcal, tdee, bmiTier, goalType", async () => {
      mockSelectOnce([]);
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
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
    });

    it("calls INSERT with ON CONFLICT DO NOTHING", async () => {
      mockSelectOnce([]);
      const { onConflictDoNothing } = mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      await getOrComputeDailyGoals("user-d", "2026-05-03");

      expect(onConflictDoNothing).toHaveBeenCalled();
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
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
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
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
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
      // Re-fetch profile/goal for bmiTier + goalType
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      const result = await getOrComputeDailyGoals("user-cache", "2026-04-30");

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.goals.proteinGoal).toBe(218);
      expect(result.audit.bmiTier).toBe("ge30");
    });

    it("does NOT call getCachedActivitySummary when row is cached", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      await getOrComputeDailyGoals("user-cache2", "2026-04-29");

      expect(mockGetCachedActivitySummary).not.toHaveBeenCalled();
    });

    it("does NOT call INSERT when row is cached", async () => {
      mockSelectOnce([COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);

      await getOrComputeDailyGoals("user-cache3", "2026-04-28");

      expect(mockDb.insert).not.toHaveBeenCalled();
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
      mockGetCachedFitbitWeightKg.mockResolvedValue(70);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_MAINTAIN);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      const result = await getOrComputeDailyGoals("user-na", "2026-05-03");

      expect(result.status).toBe("blocked");
      if (result.status !== "blocked") return;
      expect(result.reason).toBe("sex_unset");
    });
  });

  // ─── Status: blocked — scope_mismatch ────────────────────────────────────
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
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
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
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_NULL);

      await getOrComputeDailyGoals("user-partial2", "2026-05-03");

      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it("uses default MAINTAIN goalType for partial when weight goal is unavailable", async () => {
      mockSelectOnce([]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_FEMALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(65);
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
      mockInsertOnce(); // ON CONFLICT DO NOTHING (Lumen row exists, no-op)
      mockSelectOnce([lumenRow]); // read-back: returns Lumen row (null macros)
      mockUpdateOnce(); // UPDATE macro+audit columns
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
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
      mockInsertOnce();
      mockSelectOnce([lumenRow]);
      mockUpdateOnce();
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
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
      mockInsertOnce();
      mockSelectOnce([COMPUTED_ROW]); // read-back has macros populated
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_MALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(121);
      mockGetCachedFitbitWeightGoal.mockResolvedValue(WEIGHT_GOAL_LOSE);
      mockGetCachedActivitySummary.mockResolvedValue(ACTIVITY_3000);

      await getOrComputeDailyGoals("user-nomacro", "2026-05-03");

      expect(mockDb.update).not.toHaveBeenCalled();
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
    };

    it("returns correct goals and audit for female scenario", async () => {
      mockSelectOnce([]);
      mockInsertOnce();
      mockSelectOnce([FEMALE_COMPUTED_ROW]);
      mockGetCachedFitbitProfile.mockResolvedValue(PROFILE_FEMALE);
      mockGetCachedFitbitWeightKg.mockResolvedValue(65);
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
