import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Logger } from "@/lib/logger";

// ─── Fitbit-cache mocks ──────────────────────────────────────────────────────
const mockGetCachedFitbitProfile = vi.fn();
const mockGetCachedFitbitWeightKg = vi.fn();

vi.mock("@/lib/fitbit-cache", () => ({
  getCachedFitbitProfile: (...args: unknown[]) => mockGetCachedFitbitProfile(...args),
  getCachedFitbitWeightKg: (...args: unknown[]) => mockGetCachedFitbitWeightKg(...args),
}));

// ─── DB mock ─────────────────────────────────────────────────────────────────
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@/db/index", () => ({ getDb: () => mockDb }));

vi.mock("drizzle-orm", () => ({
  eq:  vi.fn((_col: unknown, val: unknown) => `eq:${val}`),
  and: vi.fn((...args: unknown[]) => `and:(${args.join(",")})`),
  gte: vi.fn((_col: unknown, val: unknown) => `gte:${val}`),
  lt:  vi.fn((_col: unknown, val: unknown) => `lt:${val}`),
  desc: vi.fn((col: unknown) => `desc:${String(col)}`),
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: mockLogger, createRequestLogger: vi.fn(() => mockLogger) };
});

// Pin "today"
vi.mock("@/lib/date-utils", () => ({
  getTodayDate: () => "2026-05-08",
}));

// ─── DB helper factories ──────────────────────────────────────────────────────

/** Queue a simple `.select({}).from(t).where(...)` returning `rows`. */
function mockSelectOnce(rows: Record<string, unknown>[] = []) {
  const where = vi.fn().mockResolvedValueOnce(rows);
  const from = vi.fn().mockReturnValue({ where });
  mockDb.select.mockReturnValueOnce({ from });
  return { where };
}

/** Queue an `insert().values().onConflictDoUpdate(...)`. */
function mockUpsertOnce() {
  const onConflictDoUpdate = vi.fn().mockResolvedValueOnce(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  mockDb.insert.mockReturnValueOnce({ values });
  return { values, onConflictDoUpdate };
}

/** Queue an `update().set().where(...)`. */
function mockUpdateOnce() {
  const where = vi.fn().mockResolvedValueOnce(undefined);
  const set = vi.fn().mockReturnValue({ where });
  mockDb.update.mockReturnValueOnce({ set });
  return { where, set };
}

/** Queue a `delete(t).where(...)`. */
function mockDeleteOnce() {
  const where = vi.fn().mockResolvedValueOnce(undefined);
  mockDb.delete.mockReturnValueOnce({ where });
  return { where };
}

// ─── Sample data ──────────────────────────────────────────────────────────────

const USER_SETTINGS = {
  activityLevel: "moderate",
  goalWeightKg: "70",
  goalRateKgPerWeek: "0.5",
};

const USER_SETTINGS_NULL = {
  activityLevel: null,
  goalWeightKg: null,
  goalRateKgPerWeek: null,
};

const FITBIT_PROFILE_MALE = { sex: "MALE" as const, ageYears: 30, heightCm: 175 };
// 30y/M/175cm → RMR = round(10*80 + 6.25*175 - 5*30 + 5) = 1749
const WEIGHT_LOG = { weightKg: 80, loggedDate: "2026-05-08" };

// Pre-computed for: 30y/M/175cm/80kg, moderate (1.55), LOSE goal=70, rate=0.5
// RMR = 1749, TDEE = round(1749*1.55) = 2711, deficit = round(0.5*1100) = 550
// targetKcal = 2161, protein = round(2.2*80) = 176
// fat = round(max(80*0.8, 2161*0.25/9)) = round(max(64, 60.03)) = 64
// carbs residual = (2161 - 176*4 - 64*9) / 4 = (2161-704-576)/4 = 881/4 = 220.25
// carbs floor10 = 2161*0.1/4 = 54.025
// carbsG = round(max(220.25, 130, 54.025)) = 220
const COMPUTED_GOALS = {
  calorieGoal: 2161,
  proteinGoal: 176,
  carbsGoal: 220,
  fatGoal: 64,
};

/** A fully-populated new-engine row (as stored in DB). */
const CACHED_ROW = {
  calorieGoal: 2161,
  proteinGoal: 176,
  carbsGoal: 220,
  fatGoal: 64,
  weightKg: "80",
  rmr: 1749,
  weightLoggedDate: "2026-05-08",
  activityLevel: "moderate",
  goalWeightKg: "70",
  goalRateKgPerWeek: "0.5",
  tdee: 2711,
  deficitKcal: -550,
};

// ─── Module import (after mocks set up) ─────────────────────────────────────
const {
  getOrComputeDailyGoals,
  getDailyGoalsByDate,
  mapComputeResultToNutritionGoals,
  invalidateUserDailyGoalsForDate,
  invalidateUserDailyGoalsForSettingsChange,
} = await import("@/lib/daily-goals");

describe("getOrComputeDailyGoals — goals not set (FOO-1042)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("returns blocked/goals_not_set when activityLevel is null", async () => {
    mockSelectOnce([{ ...USER_SETTINGS_NULL }]);
    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result).toEqual({ status: "blocked", reason: "goals_not_set" });
    // Must NOT insert any row
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns blocked/goals_not_set when goalWeightKg is null", async () => {
    mockSelectOnce([{ activityLevel: "moderate", goalWeightKg: null, goalRateKgPerWeek: "0.5" }]);
    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result).toEqual({ status: "blocked", reason: "goals_not_set" });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns blocked/goals_not_set when goalRateKgPerWeek is null", async () => {
    mockSelectOnce([{ activityLevel: "moderate", goalWeightKg: "70", goalRateKgPerWeek: null }]);
    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result).toEqual({ status: "blocked", reason: "goals_not_set" });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns blocked/goals_not_set when user row not found", async () => {
    mockSelectOnce([]);  // no user row
    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result).toEqual({ status: "blocked", reason: "goals_not_set" });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe("getOrComputeDailyGoals — cache-hit past date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("returns cached row for past date without hitting Fitbit", async () => {
    // Select 1: users settings
    mockSelectOnce([USER_SETTINGS]);
    // Select 2: existing daily goals row for past date
    mockSelectOnce([CACHED_ROW]);

    const result = await getOrComputeDailyGoals("user-1", "2026-05-01"); // past
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.goals.calorieGoal).toBe(CACHED_ROW.calorieGoal);
    }
    // Must NOT call Fitbit
    expect(mockGetCachedFitbitProfile).not.toHaveBeenCalled();
    expect(mockGetCachedFitbitWeightKg).not.toHaveBeenCalled();
    // Must NOT write to DB
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("returns audit with new fields for a cached new-engine row", async () => {
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([CACHED_ROW]);

    const result = await getOrComputeDailyGoals("user-1", "2026-05-01");
    expect(result.status).toBe("ok");
    if (result.status === "ok" && result.audit) {
      expect(result.audit.rmr).toBe(CACHED_ROW.rmr);
      expect(result.audit.tdee).toBe(CACHED_ROW.tdee);
      expect(result.audit.deficitKcal).toBe(CACHED_ROW.deficitKcal);
      expect(result.audit.activityLevel).toBe("moderate");
      expect(result.audit.goalWeightKg).toBe(70);
      expect(result.audit.goalRateKgPerWeek).toBe(0.5);
    }
  });
});

describe("getOrComputeDailyGoals — today cache-hit with matching settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("returns cached row for today when settings match", async () => {
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([CACHED_ROW]); // same settings

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result.status).toBe("ok");
    expect(mockGetCachedFitbitProfile).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

describe("getOrComputeDailyGoals — today settings drift → recompute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("recomputes when today's cached activityLevel differs from users settings", async () => {
    const driftedRow = { ...CACHED_ROW, activityLevel: "sedentary" }; // row says sedentary
    // users settings say moderate
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([driftedRow]);

    // Fitbit calls for recompute
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);

    // Upsert
    mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result.status).toBe("ok");
    expect(mockGetCachedFitbitProfile).toHaveBeenCalledOnce();
    expect(mockDb.insert).toHaveBeenCalledOnce(); // upsert fired
  });

  it("recomputes when today's cached goalWeightKg differs", async () => {
    const driftedRow = { ...CACHED_ROW, goalWeightKg: "65" }; // row says 65, users say 70
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([driftedRow]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);
    mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result.status).toBe("ok");
    expect(mockDb.insert).toHaveBeenCalledOnce();
  });
});

describe("getOrComputeDailyGoals — fresh compute path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("reads Fitbit, computes, and upserts for first call today", async () => {
    // No existing row
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]); // no existing daily goals row

    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);

    const { onConflictDoUpdate } = mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");

    expect(result.status).toBe("ok");
    expect(mockGetCachedFitbitProfile).toHaveBeenCalledOnce();
    expect(mockGetCachedFitbitWeightKg).toHaveBeenCalledOnce();
    expect(onConflictDoUpdate).toHaveBeenCalledOnce();
  });

  it("returns correct computed goals in fresh compute", async () => {
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);
    mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.goals.calorieGoal).toBe(COMPUTED_GOALS.calorieGoal);
      expect(result.goals.proteinGoal).toBe(COMPUTED_GOALS.proteinGoal);
      expect(result.goals.carbsGoal).toBe(COMPUTED_GOALS.carbsGoal);
      expect(result.goals.fatGoal).toBe(COMPUTED_GOALS.fatGoal);
    }
  });

  it("returns correct audit shape in fresh compute", async () => {
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);
    mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.audit).toBeDefined();
      const audit = result.audit!;
      expect(audit.rmr).toBe(1749);
      expect(audit.palMultiplier).toBe(1.55);
      expect(audit.tdee).toBe(2711);
      expect(audit.weightKg).toBe("80");
      expect(audit.weightLoggedDate).toBe("2026-05-08");
      expect(audit.activityLevel).toBe("moderate");
      expect(audit.goalWeightKg).toBe(70);
      expect(audit.goalRateKgPerWeek).toBe(0.5);
      expect(audit.deficitKcal).toBe(-550);
      expect(audit.direction).toBe("LOSE");
    }
  });

  it("passes user settings to computeMacroTargets (activityLevel, goalWeightKg, goalRateKgPerWeek)", async () => {
    mockSelectOnce([{ activityLevel: "light", goalWeightKg: "75", goalRateKgPerWeek: "0.3" }]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);
    mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.audit!.activityLevel).toBe("light");
      expect(result.audit!.goalWeightKg).toBe(75);
      expect(result.audit!.goalRateKgPerWeek).toBe(0.3);
    }
  });
});

describe("getOrComputeDailyGoals — blocked reasons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("returns blocked/no_weight when weightLog is null", async () => {
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(null);

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result).toEqual({ status: "blocked", reason: "no_weight" });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns blocked/sex_unset when profile.sex is NA", async () => {
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce({ sex: "NA", ageYears: 30, heightCm: 170 });
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result).toEqual({ status: "blocked", reason: "sex_unset" });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns blocked/scope_mismatch when getCachedFitbitProfile throws FITBIT_SCOPE_MISSING", async () => {
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockRejectedValueOnce(new Error("FITBIT_SCOPE_MISSING"));

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result).toEqual({ status: "blocked", reason: "scope_mismatch" });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns blocked/invalid_profile when profile data is invalid", async () => {
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    // Profile with invalid height → engine throws INVALID_PROFILE_DATA
    mockGetCachedFitbitProfile.mockResolvedValueOnce({ sex: "MALE", ageYears: 30, heightCm: 0 });
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result).toEqual({ status: "blocked", reason: "invalid_profile" });
  });
});

describe("getOrComputeDailyGoals — weightStale flag (FOO-1010)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.delete.mockReset();
  });

  it("sets weightStale = true when weight log is > 7 days old", async () => {
    // Today = 2026-05-08, logged 2026-04-30 → 8 days → stale
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce({ weightKg: 80, loggedDate: "2026-04-30" });
    mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.weightStale).toBe(true);
    }
  });

  it("does NOT set weightStale when weight log is ≤ 7 days old", async () => {
    // Today = 2026-05-08, logged 2026-05-01 → 7 days → NOT stale
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce({ weightKg: 80, loggedDate: "2026-05-01" });
    mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.weightStale).toBeFalsy();
    }
  });
});

describe("getOrComputeDailyGoals — past-date computes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.delete.mockReset();
  });

  it("computes and stores past-date row with CURRENT user settings", async () => {
    // Past date, no existing row → full compute with current settings
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]); // no existing row for past date
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);
    mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-01-01"); // past
    expect(result.status).toBe("ok");
    expect(mockDb.insert).toHaveBeenCalledOnce();
  });
});

// ─── FOO-1053: past-date row stability under settings drift ──────────────────
describe("getOrComputeDailyGoals — past-date row stability under settings drift (FOO-1053)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("returns past-date row as-is even when users settings have drifted", async () => {
    // Past-date row stored with one set of settings
    const driftedPastRow = {
      ...CACHED_ROW,
      activityLevel: "sedentary",
      goalWeightKg: "80",
      goalRateKgPerWeek: "1.0",
    };
    // Users now have different settings (moderate / 70 / 0.5)
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([driftedPastRow]);

    const result = await getOrComputeDailyGoals("user-1", "2026-05-03"); // past
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      // Goals reflect the stored historical row, not current settings
      expect(result.goals.calorieGoal).toBe(driftedPastRow.calorieGoal);
      expect(result.goals.proteinGoal).toBe(driftedPastRow.proteinGoal);
      expect(result.audit?.activityLevel).toBe("sedentary");
      expect(result.audit?.goalWeightKg).toBe(80);
      expect(result.audit?.goalRateKgPerWeek).toBe(1.0);
    }
    // No Fitbit call, no DB write
    expect(mockGetCachedFitbitProfile).not.toHaveBeenCalled();
    expect(mockGetCachedFitbitWeightKg).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});

// ─── FOO-1066: setWhere guard against stale-compute overwrite ────────────────
describe("getOrComputeDailyGoals — UPSERT setWhere guard (FOO-1066)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("includes a setWhere clause matching the input settings to prevent stale-compute overwrites", async () => {
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);
    const { onConflictDoUpdate } = mockUpsertOnce();

    await getOrComputeDailyGoals("user-1", "2026-05-08");

    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        setWhere: expect.anything(),
      }),
    );
    // Mocked drizzle helpers serialize `eq(col, val)` to `eq:val` and
    // `and(...args)` to `and:(arg1,arg2,...)`. Verify the setWhere is the
    // full and/eq composition with our exact input settings, in order.
    // Substring matches would be ambiguous (e.g. "eq:70" ⊂ "eq:700").
    const args = onConflictDoUpdate.mock.calls[0][0] as { setWhere: unknown };
    expect(String(args.setWhere)).toBe("and:(eq:moderate,eq:70,eq:0.5)");
  });
});

// ─── FOO-1062: migration-cutover safety — past row visible under null users.* ─
describe("getOrComputeDailyGoals — past-date row visible under null user settings (FOO-1062)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("returns past historical row even when users.* goal settings are all null (migration cutover)", async () => {
    // Migration cutover state: user just got the new schema, settings are NULL
    // but their daily_calorie_goals history still exists.
    mockSelectOnce([USER_SETTINGS_NULL]);
    mockSelectOnce([CACHED_ROW]);

    const result = await getOrComputeDailyGoals("user-1", "2026-05-01"); // past
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.goals.calorieGoal).toBe(CACHED_ROW.calorieGoal);
    }
    // Must NOT call Fitbit
    expect(mockGetCachedFitbitProfile).not.toHaveBeenCalled();
    expect(mockGetCachedFitbitWeightKg).not.toHaveBeenCalled();
    // Must NOT write to DB
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("returns blocked/goals_not_set for past date when settings null AND no historical row", async () => {
    mockSelectOnce([USER_SETTINGS_NULL]);
    mockSelectOnce([]); // no historical row

    const result = await getOrComputeDailyGoals("user-1", "2026-05-01");
    expect(result).toEqual({ status: "blocked", reason: "goals_not_set" });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("returns blocked/goals_not_set for today even when settings null (no migration-cutover backstop for today)", async () => {
    mockSelectOnce([USER_SETTINGS_NULL]);

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08"); // today
    expect(result).toEqual({ status: "blocked", reason: "goals_not_set" });
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});

// ─── FOO-1054: MAINTAIN direction at integration level ───────────────────────
describe("getOrComputeDailyGoals — MAINTAIN direction (FOO-1054)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("Case A: goalWeightKg === currentWeightKg → MAINTAIN with deficitKcal=0", async () => {
    // Current weight 80, goal weight 80 → MAINTAIN regardless of rate
    mockSelectOnce([{ activityLevel: "moderate", goalWeightKg: "80", goalRateKgPerWeek: "0.5" }]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG); // 80kg
    const { values } = mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.audit?.direction).toBe("MAINTAIN");
      expect(result.audit?.deficitKcal).toBe(0);
    }
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ deficitKcal: 0 }));
  });

  it("Case B: goalRateKgPerWeek=0 → MAINTAIN even with mismatched weights", async () => {
    // Current 80, goal 70, rate 0 → MAINTAIN (rate forces it)
    mockSelectOnce([{ activityLevel: "moderate", goalWeightKg: "70", goalRateKgPerWeek: "0" }]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);
    const { values } = mockUpsertOnce();

    const result = await getOrComputeDailyGoals("user-1", "2026-05-08");
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.audit?.direction).toBe("MAINTAIN");
      expect(result.audit?.deficitKcal).toBe(0);
    }
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ deficitKcal: 0 }));
  });

  it("Case C: buildAuditFromRow reconstructs MAINTAIN when stored deficitKcal=0", async () => {
    // Past-date cache hit on a row with deficit_kcal = 0 and tdee = rmr × pal
    const maintainRow = {
      ...CACHED_ROW,
      deficitKcal: 0,
      tdee: 2711, // 1749 × 1.55 (rounded)
    };
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([maintainRow]);

    const result = await getOrComputeDailyGoals("user-1", "2026-05-01"); // past
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.audit?.direction).toBe("MAINTAIN");
      expect(result.audit?.deficitKcal).toBe(0);
    }
  });
});

// ─── FOO-1052: log conversions of upstream errors in doCompute ───────────────
describe("getOrComputeDailyGoals — log conversions (FOO-1052)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReset();
    mockDb.insert.mockReset();
    mockDb.update.mockReset();
    mockDb.delete.mockReset();
  });

  it("warns when engine throws INVALID_PROFILE_DATA", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce({ sex: "MALE", ageYears: 30, heightCm: 0 });
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);

    await getOrComputeDailyGoals("user-1", "2026-05-08", log as unknown as Logger);

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "daily_goals_blocked", reason: "invalid_profile" }),
      expect.any(String),
    );
  });

  it("warns when getCachedFitbitProfile throws FITBIT_SCOPE_MISSING", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockRejectedValueOnce(new Error("FITBIT_SCOPE_MISSING"));

    await getOrComputeDailyGoals("user-1", "2026-05-08", log as unknown as Logger);

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "daily_goals_blocked", reason: "scope_mismatch" }),
      expect.any(String),
    );
  });

  it("debugs when goals_not_set (expected user state)", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    mockSelectOnce([USER_SETTINGS_NULL]);

    await getOrComputeDailyGoals("user-1", "2026-05-08", log as unknown as Logger);

    expect(log.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: "daily_goals_blocked", reason: "goals_not_set" }),
      expect.any(String),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("warns when Fitbit profile.sex === NA (sex_unset)", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce({ sex: "NA", ageYears: 30, heightCm: 175 });
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(WEIGHT_LOG);

    await getOrComputeDailyGoals("user-1", "2026-05-08", log as unknown as Logger);

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "daily_goals_blocked", reason: "sex_unset" }),
      expect.any(String),
    );
  });

  it("warns when weightLog is null (no_weight)", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    mockSelectOnce([USER_SETTINGS]);
    mockSelectOnce([]);
    mockGetCachedFitbitProfile.mockResolvedValueOnce(FITBIT_PROFILE_MALE);
    mockGetCachedFitbitWeightKg.mockResolvedValueOnce(null);

    await getOrComputeDailyGoals("user-1", "2026-05-08", log as unknown as Logger);

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "daily_goals_blocked", reason: "no_weight" }),
      expect.any(String),
    );
  });
});

// ─── invalidateUserDailyGoalsForSettingsChange ────────────────────────────────

describe("invalidateUserDailyGoalsForSettingsChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.delete.mockReset();
  });

  it("deletes daily_calorie_goals rows on and after the given date", async () => {
    const { where } = mockDeleteOnce();
    await invalidateUserDailyGoalsForSettingsChange("user-1", "2026-05-08");
    expect(mockDb.delete).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledOnce();
  });
});

// ─── invalidateUserDailyGoalsForDate ─────────────────────────────────────────

describe("invalidateUserDailyGoalsForDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReset();
  });

  it("resets the row for the given date", async () => {
    mockUpdateOnce();
    await invalidateUserDailyGoalsForDate("user-1", "2026-05-08");
    expect(mockDb.update).toHaveBeenCalledOnce();
  });
});

// ─── mapComputeResultToNutritionGoals ────────────────────────────────────────

describe("mapComputeResultToNutritionGoals", () => {
  it("maps ok result to NutritionGoals with audit", () => {
    const audit = {
      rmr: 1749,
      palMultiplier: 1.55,
      tdee: 2711,
      weightKg: "80",
      weightLoggedDate: "2026-05-08",
      activityLevel: "moderate" as const,
      goalWeightKg: 70,
      goalRateKgPerWeek: 0.5,
      deficitKcal: -550,
      direction: "LOSE" as const,
    };
    const result = mapComputeResultToNutritionGoals({
      status: "ok",
      goals: { calorieGoal: 2161, proteinGoal: 176, carbsGoal: 220, fatGoal: 64 },
      audit,
    });
    expect(result.status).toBe("ok");
    expect(result.calories).toBe(2161);
    expect(result.proteinG).toBe(176);
    expect(result.audit).toEqual(audit);
    expect(result.weightStale).toBeFalsy();
  });

  it("maps blocked/goals_not_set result", () => {
    const result = mapComputeResultToNutritionGoals({
      status: "blocked",
      reason: "goals_not_set",
    });
    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("goals_not_set");
    expect(result.calories).toBeNull();
  });

  it("passes through weightStale flag", () => {
    const result = mapComputeResultToNutritionGoals({
      status: "ok",
      goals: { calorieGoal: 2000, proteinGoal: 150, carbsGoal: 200, fatGoal: 60 },
      weightStale: true,
    });
    expect(result.weightStale).toBe(true);
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
    const result = await getDailyGoalsByDate("user-1", "2026-05-08");
    expect(result).toBeNull();
  });

  it("returns row when it exists", async () => {
    mockSelectOnce([{
      date: "2026-05-08",
      calorieGoal: 2161,
      proteinGoal: 176,
      carbsGoal: 220,
      fatGoal: 64,
      weightKg: "80",
      rmr: 1749,
      tdee: 2711,
    }]);
    const result = await getDailyGoalsByDate("user-1", "2026-05-08");
    expect(result).not.toBeNull();
    expect(result?.calorieGoal).toBe(2161);
  });
});
