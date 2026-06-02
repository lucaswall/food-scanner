import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockValidateApiRequest = vi.fn();
vi.mock("@/lib/api-auth", () => ({
  validateApiRequest: (...args: unknown[]) => mockValidateApiRequest(...args),
  hashForRateLimit: (key: string) => `hashed-${key.slice(0, 8)}`,
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const mockGetOrComputeDailyGoals = vi.fn();
const mockMapComputeResultToNutritionGoals = vi.fn();
vi.mock("@/lib/daily-goals", () => ({
  getOrComputeDailyGoals: (...args: unknown[]) => mockGetOrComputeDailyGoals(...args),
  mapComputeResultToNutritionGoals: (...args: unknown[]) =>
    mockMapComputeResultToNutritionGoals(...args),
}));

const mockGetDailyGoalsByDateRange = vi.fn();
vi.mock("@/lib/nutrition-goals", () => ({
  getDailyGoalsByDateRange: (...args: unknown[]) => mockGetDailyGoalsByDateRange(...args),
}));

const mockGetUserGoalSettings = vi.fn();
vi.mock("@/lib/users", () => ({
  getUserGoalSettings: (...args: unknown[]) => mockGetUserGoalSettings(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

vi.mock("@/lib/date-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/date-utils")>("@/lib/date-utils");
  return {
    ...actual,
    getTodayDate: () => "2026-05-04",
  };
});

const { GET } = await import("@/app/api/v1/nutrition-goals/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/v1/nutrition-goals (FOO-1008)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    // Default: user has goals configured (range mode tests can override).
    mockGetUserGoalSettings.mockResolvedValue({
      activityLevel: "moderate",
      goalWeightKg: "70",
      goalRateKgPerWeek: "0.5",
    });
    mockMapComputeResultToNutritionGoals.mockImplementation((result) => {
      if (result.status === "ok") {
        return {
          calories: result.goals.calorieGoal,
          proteinG: result.goals.proteinGoal,
          carbsG: result.goals.carbsGoal,
          fatG: result.goals.fatGoal,
          status: "ok",
          audit: result.audit,
        };
      }
      return { calories: null, proteinG: null, carbsG: null, fatG: null, status: "blocked" };
    });
  });

  it("auth required: missing Bearer → 401", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 },
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest("http://localhost:3000/api/v1/nutrition-goals");
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const request = createRequest("http://localhost:3000/api/v1/nutrition-goals", {
      Authorization: "Bearer valid-key",
    });
    const response = await GET(request);

    expect(response.status).toBe(429);
  });

  it("uses 30 req/min rate limit on the v1 nutrition-goals key", async () => {
    mockGetOrComputeDailyGoals.mockResolvedValue({
      status: "ok",
      goals: { calorieGoal: 2200, proteinGoal: 140, carbsGoal: 220, fatGoal: 80 },
      audit: {},
    });

    const request = createRequest("http://localhost:3000/api/v1/nutrition-goals", {
      Authorization: "Bearer test-api-key-abc",
    });
    await GET(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "v1:nutrition-goals:hashed-test-api",
      30,
      60_000,
    );
  });

  describe("single-date mode", () => {
    it("returns engine-computed goals for ?date= param", async () => {
      mockGetOrComputeDailyGoals.mockResolvedValue({
        status: "ok",
        goals: { calorieGoal: 2289, proteinGoal: 218, carbsGoal: 136, fatGoal: 97 },
        audit: { rmr: 2070 },
      });

      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?date=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.date).toBe("2026-05-04");
      expect(body.data.calories).toBe(2289);
      expect(body.data.proteinG).toBe(218);
      expect(body.data).not.toHaveProperty("profileKey");
      expect(body.data.status).toBe("ok");
      expect(mockGetOrComputeDailyGoals).toHaveBeenCalledWith("user-123", "2026-05-04", expect.any(Object));
    });

    it("defaults to today when no date is given", async () => {
      mockGetOrComputeDailyGoals.mockResolvedValue({
        status: "ok",
        goals: { calorieGoal: 2200, proteinGoal: 140, carbsGoal: 220, fatGoal: 80 },
        audit: {},
      });

      const request = createRequest("http://localhost:3000/api/v1/nutrition-goals", {
        Authorization: "Bearer valid-key",
      });
      const response = await GET(request);
      const body = await response.json();

      expect(body.data.date).toBe("2026-05-04");
    });

    it("validates date format", async () => {
      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?date=garbage",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
    });

    it("maps Google Health errors to HTTP codes", async () => {
      mockGetOrComputeDailyGoals.mockRejectedValue(new Error("HEALTH_RATE_LIMIT_LOW"));

      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?date=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);

      expect(response.status).toBe(503);
    });
  });

  describe("range mode", () => {
    it("returns rows from getDailyGoalsByDateRange (no engine backfill)", async () => {
      mockGetDailyGoalsByDateRange.mockResolvedValue([
        { date: "2026-05-01", calorieGoal: 2200, proteinGoal: 140, carbsGoal: 220, fatGoal: 80 },
        { date: "2026-05-02", calorieGoal: 2300, proteinGoal: 145, carbsGoal: 230, fatGoal: 82 },
        { date: "2026-05-03", calorieGoal: 0, proteinGoal: null, carbsGoal: null, fatGoal: null },
        { date: "2026-05-04", calorieGoal: 2400, proteinGoal: 150, carbsGoal: 240, fatGoal: 85 },
      ]);

      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?from=2026-05-01&to=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.entries).toHaveLength(4);
      expect(body.data.entries[0].calories).toBe(2200);
      expect(body.data.entries[0].status).toBe("ok");
      expect(body.data.entries[2].calories).toBeNull();
      expect(body.data.entries[2].status).toBe("blocked");
      // Default mock has settings configured → incomplete row → not_computed (FOO-1063).
      expect(body.data.entries[2].reason).toBe("not_computed");
      expect(body.data).not.toHaveProperty("profileKey");
      // Should NOT call the engine for any of the days
      expect(mockGetOrComputeDailyGoals).not.toHaveBeenCalled();
    });

    it("rejects spans > 90 days", async () => {
      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?from=2026-01-01&to=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
    });

    it("rejects to < from", async () => {
      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?from=2026-05-04&to=2026-05-01",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
    });

    it("validates from/to format", async () => {
      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?from=garbage&to=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
    });

    it("rejects partial range params (only `from` provided) (bug-hunter Bug 2)", async () => {
      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?from=2026-05-01",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
    });

    it("rejects partial range params (only `to` provided) (bug-hunter Bug 2)", async () => {
      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?to=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);

      expect(response.status).toBe(400);
    });

    // ─── FOO-1033 (PR review P1): gap-fill missing dates as goals_not_set ───
    it("emits blocked/not_computed entries for dates with no row when settings ARE configured (FOO-1063)", async () => {
      // Configured user — gaps in range mean rows haven't been computed yet,
      // not that goals aren't set up.
      mockGetDailyGoalsByDateRange.mockResolvedValue([
        { date: "2026-05-02", calorieGoal: 2300, proteinGoal: 145, carbsGoal: 230, fatGoal: 82 },
        { date: "2026-05-04", calorieGoal: 2400, proteinGoal: 150, carbsGoal: 240, fatGoal: 85 },
      ]);

      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?from=2026-05-01&to=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.entries).toHaveLength(4);
      expect(body.data.entries.map((e: { date: string }) => e.date)).toEqual([
        "2026-05-01",
        "2026-05-02",
        "2026-05-03",
        "2026-05-04",
      ]);
      // 2026-05-01: missing + configured → not_computed
      expect(body.data.entries[0]).toMatchObject({
        date: "2026-05-01",
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        status: "blocked",
        reason: "not_computed",
      });
      expect(body.data.entries[1]).toMatchObject({
        date: "2026-05-02",
        calories: 2300,
        status: "ok",
      });
      // 2026-05-03: missing + configured → not_computed
      expect(body.data.entries[2]).toMatchObject({
        date: "2026-05-03",
        status: "blocked",
        reason: "not_computed",
      });
      expect(body.data.entries[3]).toMatchObject({
        date: "2026-05-04",
        calories: 2400,
        status: "ok",
      });
    });

    it("emits blocked/goals_not_set entries when user settings are NULL (FOO-1063)", async () => {
      mockGetUserGoalSettings.mockResolvedValue({
        activityLevel: null,
        goalWeightKg: null,
        goalRateKgPerWeek: null,
      });
      mockGetDailyGoalsByDateRange.mockResolvedValue([
        { date: "2026-05-02", calorieGoal: 2300, proteinGoal: 145, carbsGoal: 230, fatGoal: 82 },
      ]);

      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?from=2026-05-01&to=2026-05-03",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.entries).toHaveLength(3);
      // 2026-05-01: missing + settings null → goals_not_set
      expect(body.data.entries[0]).toMatchObject({
        date: "2026-05-01",
        status: "blocked",
        reason: "goals_not_set",
      });
      // 2026-05-03: missing + settings null → goals_not_set
      expect(body.data.entries[2]).toMatchObject({
        date: "2026-05-03",
        status: "blocked",
        reason: "goals_not_set",
      });
    });

    it("returns single entry (not_computed) for one-day range with no row when settings ARE configured", async () => {
      mockGetDailyGoalsByDateRange.mockResolvedValue([]);

      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?from=2026-05-04&to=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.entries).toHaveLength(1);
      expect(body.data.entries[0]).toMatchObject({
        date: "2026-05-04",
        status: "blocked",
        reason: "not_computed",
      });
    });

    it("returns 500 INTERNAL_ERROR when getUserGoalSettings rejects (FOO-1063 negative path)", async () => {
      mockGetDailyGoalsByDateRange.mockResolvedValue([]);
      mockGetUserGoalSettings.mockRejectedValueOnce(new Error("DB error"));

      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?from=2026-05-01&to=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });

    it("returns single entry (goals_not_set) for one-day range with no row when settings are NULL", async () => {
      mockGetUserGoalSettings.mockResolvedValue({
        activityLevel: null,
        goalWeightKg: null,
        goalRateKgPerWeek: null,
      });
      mockGetDailyGoalsByDateRange.mockResolvedValue([]);

      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?from=2026-05-04&to=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.entries).toHaveLength(1);
      expect(body.data.entries[0]).toMatchObject({
        date: "2026-05-04",
        status: "blocked",
        reason: "goals_not_set",
      });
    });
  });

  // ─── FOO-1025: response headers ─────────────────────────────────────────
  describe("response headers", () => {
    beforeEach(() => {
      mockGetOrComputeDailyGoals.mockResolvedValue({
        status: "ok",
        goals: { calorieGoal: 2289, proteinGoal: 218, carbsGoal: 136, fatGoal: 97 },
        audit: { rmr: 2070 },
      });
    });

    it("sets Cache-Control: private, no-cache on success", async () => {
      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?date=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);

      expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
    });

    it("returns ETag header on success", async () => {
      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?date=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);

      expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
    });
  });

  // ─── FOO-1026: Fitbit error-code mapping ────────────────────────────────
  // Note: HEALTH_SCOPE_MISSING when thrown maps to 403; getOrComputeDailyGoals
  // also catches it upstream and converts it to a resolved blocked/scope_mismatch
  // result (see "blocked-status mapping" describe block below for that path).
  describe("Google Health error mapping", () => {
    const cases: { error: string; status: number; code: string }[] = [
      { error: "HEALTH_TOKEN_INVALID", status: 401, code: "HEALTH_TOKEN_INVALID" },
      { error: "HEALTH_SCOPE_MISSING", status: 403, code: "HEALTH_SCOPE_MISSING" },
      { error: "HEALTH_RATE_LIMIT", status: 429, code: "HEALTH_RATE_LIMIT" },
      { error: "HEALTH_TIMEOUT", status: 504, code: "HEALTH_TIMEOUT" },
      { error: "HEALTH_API_ERROR", status: 502, code: "HEALTH_API_ERROR" },
    ];

    for (const { error, status, code } of cases) {
      it(`maps ${error} → ${status}`, async () => {
        mockGetOrComputeDailyGoals.mockRejectedValue(new Error(error));

        const request = createRequest(
          "http://localhost:3000/api/v1/nutrition-goals?date=2026-05-04",
          { Authorization: "Bearer valid-key" },
        );
        const response = await GET(request);
        const body = await response.json();

        expect(response.status).toBe(status);
        expect(body.error.code).toBe(code);
      });
    }
  });

  // ─── FOO-1031: blocked-status → HTTP error mapping (PR review P1) ────────
  // getOrComputeDailyGoals catches HEALTH_SCOPE_MISSING from underlying Google
  // Health calls and returns a *resolved* `blocked/scope_mismatch` ComputeResult —
  // not a thrown error. The external API contract requires 403 (re-auth signal) for
  // this case, so the route maps the blocked reason to an HTTP error.
  describe("blocked-status mapping", () => {
    it("maps blocked/scope_mismatch → 403 HEALTH_SCOPE_MISSING", async () => {
      mockGetOrComputeDailyGoals.mockResolvedValue({
        status: "blocked",
        reason: "scope_mismatch",
      });

      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?date=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error.code).toBe("HEALTH_SCOPE_MISSING");
    });

    it("returns 200 blocked/goals_not_set when user has not set up daily goals", async () => {
      mockGetOrComputeDailyGoals.mockResolvedValue({
        status: "blocked",
        reason: "goals_not_set",
      });
      mockMapComputeResultToNutritionGoals.mockReturnValue({
        calories: null, proteinG: null, carbsG: null, fatG: null,
        status: "blocked", reason: "goals_not_set",
      });

      const request = createRequest(
        "http://localhost:3000/api/v1/nutrition-goals?date=2026-05-04",
        { Authorization: "Bearer valid-key" },
      );
      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data.status).toBe("blocked");
      expect(body.data.reason).toBe("goals_not_set");
      expect(body.data.calories).toBeNull();
    });
  });
});
