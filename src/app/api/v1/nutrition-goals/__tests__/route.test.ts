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
const mockLoadUserMacroProfileKey = vi.fn();
vi.mock("@/lib/daily-goals", () => ({
  getOrComputeDailyGoals: (...args: unknown[]) => mockGetOrComputeDailyGoals(...args),
  mapComputeResultToNutritionGoals: (...args: unknown[]) =>
    mockMapComputeResultToNutritionGoals(...args),
  loadUserMacroProfileKey: (...args: unknown[]) => mockLoadUserMacroProfileKey(...args),
}));

const mockGetDailyGoalsByDateRange = vi.fn();
vi.mock("@/lib/nutrition-goals", () => ({
  getDailyGoalsByDateRange: (...args: unknown[]) => mockGetDailyGoalsByDateRange(...args),
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
    mockLoadUserMacroProfileKey.mockResolvedValue("muscle_preserve");
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
      expect(body.data.profileKey).toBe("muscle_preserve");
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

    it("maps Fitbit errors to HTTP codes", async () => {
      mockGetOrComputeDailyGoals.mockRejectedValue(new Error("FITBIT_RATE_LIMIT_LOW"));

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
      expect(body.data.entries[2].reason).toBe("not_computed");
      expect(body.data.profileKey).toBe("muscle_preserve");
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
  describe("Fitbit error mapping", () => {
    const cases: { error: string; status: number; code: string }[] = [
      { error: "FITBIT_CREDENTIALS_MISSING", status: 424, code: "FITBIT_CREDENTIALS_MISSING" },
      { error: "FITBIT_TOKEN_INVALID", status: 401, code: "FITBIT_TOKEN_INVALID" },
      { error: "FITBIT_SCOPE_MISSING", status: 403, code: "FITBIT_SCOPE_MISSING" },
      { error: "FITBIT_RATE_LIMIT", status: 429, code: "FITBIT_RATE_LIMIT" },
      { error: "FITBIT_TIMEOUT", status: 504, code: "FITBIT_TIMEOUT" },
      { error: "FITBIT_API_ERROR", status: 502, code: "FITBIT_API_ERROR" },
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
});
