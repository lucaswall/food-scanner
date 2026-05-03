import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (
    session: FullSession | null,
    options?: { requireFitbit?: boolean },
  ): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      );
    }
    if (options?.requireFitbit && !session.fitbitConnected) {
      return Response.json(
        { success: false, error: { code: "FITBIT_NOT_CONNECTED", message: "Fitbit account not connected" }, timestamp: Date.now() },
        { status: 400 },
      );
    }
    if (options?.requireFitbit && !session.hasFitbitCredentials) {
      return Response.json(
        { success: false, error: { code: "FITBIT_CREDENTIALS_MISSING", message: "Fitbit credentials not configured" }, timestamp: Date.now() },
        { status: 400 },
      );
    }
    return null;
  },
}));

const mockGetOrComputeDailyGoals = vi.fn();
vi.mock("@/lib/daily-goals", () => ({
  getOrComputeDailyGoals: (...args: unknown[]) => mockGetOrComputeDailyGoals(...args),
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const mockGetTodayDate = vi.fn();
vi.mock("@/lib/date-utils", () => ({
  getTodayDate: () => mockGetTodayDate(),
}));

const { GET } = await import("@/app/api/nutrition-goals/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

function createRequest(url = "http://localhost:3000/api/nutrition-goals"): Request {
  return new Request(url);
}

const OK_RESULT = {
  status: "ok" as const,
  goals: { calorieGoal: 2289, proteinGoal: 218, carbsGoal: 136, fatGoal: 97 },
  audit: {
    rmr: 2070,
    activityKcal: 791,
    tdee: 2861,
    weightKg: "121",
    bmiTier: "ge30" as const,
    goalType: "LOSE" as const,
  },
};

const PARTIAL_RESULT = {
  status: "partial" as const,
  proteinG: 218,
  fatG: 97,
};

describe("GET /api/nutrition-goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTodayDate.mockReturnValue("2026-05-03");
  });

  // ─── Auth ────────────────────────────────────────────────────────────────
  it("returns 401 when session is missing", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 when Fitbit is not connected", async () => {
    mockGetSession.mockResolvedValue({ ...validSession, fitbitConnected: false });

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("FITBIT_NOT_CONNECTED");
  });

  it("returns 400 when Fitbit credentials are missing (session flag)", async () => {
    mockGetSession.mockResolvedValue({ ...validSession, hasFitbitCredentials: false });

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("FITBIT_CREDENTIALS_MISSING");
  });

  // ─── Status: ok ──────────────────────────────────────────────────────────
  it("returns 200 with ok status, goals, and audit on happy path", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue(OK_RESULT);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
    expect(body.data.calories).toBe(2289);
    expect(body.data.proteinG).toBe(218);
    expect(body.data.carbsG).toBe(136);
    expect(body.data.fatG).toBe(97);
    expect(body.data.audit).toEqual({
      rmr: 2070,
      activityKcal: 791,
      tdee: 2861,
      weightKg: "121",
      bmiTier: "ge30",
      goalType: "LOSE",
    });
  });

  it("calls getOrComputeDailyGoals with userId and today date", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue(OK_RESULT);

    await GET(createRequest());

    expect(mockGetOrComputeDailyGoals).toHaveBeenCalledWith("user-123", "2026-05-03", expect.any(Object));
  });

  it("uses clientDate query param when provided", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue(OK_RESULT);

    await GET(createRequest("http://localhost:3000/api/nutrition-goals?clientDate=2026-05-04"));

    expect(mockGetOrComputeDailyGoals).toHaveBeenCalledWith("user-123", "2026-05-04", expect.any(Object));
    expect(mockGetTodayDate).not.toHaveBeenCalled();
  });

  it("falls back to server UTC date when clientDate is not provided", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue(OK_RESULT);
    mockGetTodayDate.mockReturnValue("2026-05-03");

    await GET(createRequest());

    expect(mockGetOrComputeDailyGoals).toHaveBeenCalledWith("user-123", "2026-05-03", expect.any(Object));
  });

  // ─── Status: partial ─────────────────────────────────────────────────────
  it("returns 200 with partial status when activity has no caloriesOut", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue(PARTIAL_RESULT);

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("partial");
    expect(body.data.calories).toBeNull();
    expect(body.data.proteinG).toBe(218);
    expect(body.data.carbsG).toBeNull();
    expect(body.data.fatG).toBe(97);
    expect(body.data.audit).toBeUndefined();
  });

  // ─── Status: blocked ─────────────────────────────────────────────────────
  it("returns 200 with blocked/scope_mismatch when scope is missing", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue({ status: "blocked", reason: "scope_mismatch" });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("blocked");
    expect(body.data.reason).toBe("scope_mismatch");
    expect(body.data.calories).toBeNull();
  });

  it("returns 200 with blocked/no_weight when weight is unavailable", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue({ status: "blocked", reason: "no_weight" });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("blocked");
    expect(body.data.reason).toBe("no_weight");
  });

  it("returns 200 with blocked/sex_unset when sex is not configured", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue({ status: "blocked", reason: "sex_unset" });

    const response = await GET(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("blocked");
    expect(body.data.reason).toBe("sex_unset");
  });

  // ─── Fitbit errors (thrown) ───────────────────────────────────────────────
  it("returns 424 when getOrComputeDailyGoals throws FITBIT_CREDENTIALS_MISSING", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockRejectedValue(new Error("FITBIT_CREDENTIALS_MISSING"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(424);
    expect(data.error.code).toBe("FITBIT_CREDENTIALS_MISSING");
  });

  it("returns 401 when getOrComputeDailyGoals throws FITBIT_TOKEN_INVALID", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockRejectedValue(new Error("FITBIT_TOKEN_INVALID"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.code).toBe("FITBIT_TOKEN_INVALID");
  });

  it("returns 429 when getOrComputeDailyGoals throws FITBIT_RATE_LIMIT", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockRejectedValue(new Error("FITBIT_RATE_LIMIT"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error.code).toBe("FITBIT_RATE_LIMIT");
  });

  it("returns 504 when getOrComputeDailyGoals throws FITBIT_TIMEOUT", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockRejectedValue(new Error("FITBIT_TIMEOUT"));

    const response = await GET(createRequest());

    expect(response.status).toBe(504);
  });

  it("returns 502 when getOrComputeDailyGoals throws FITBIT_REFRESH_TRANSIENT", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockRejectedValue(new Error("FITBIT_REFRESH_TRANSIENT"));

    const response = await GET(createRequest());

    expect(response.status).toBe(502);
  });

  it("returns 500 when getOrComputeDailyGoals throws FITBIT_TOKEN_SAVE_FAILED", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockRejectedValue(new Error("FITBIT_TOKEN_SAVE_FAILED"));

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
  });

  it("returns 502 when getOrComputeDailyGoals throws FITBIT_API_ERROR", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockRejectedValue(new Error("FITBIT_API_ERROR"));

    const response = await GET(createRequest());

    expect(response.status).toBe(502);
  });

  it("returns 500 on generic/unknown error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockRejectedValue(new Error("Something unexpected"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  // ─── HTTP headers ─────────────────────────────────────────────────────────
  it("sets Cache-Control header to private, no-cache", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue(OK_RESULT);

    const response = await GET(createRequest());

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns ETag header on success response", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue(OK_RESULT);

    const response = await GET(createRequest());

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue(OK_RESULT);

    const response1 = await GET(createRequest());
    const etag = response1.headers.get("ETag")!;

    mockGetSession.mockResolvedValue(validSession);
    mockGetOrComputeDailyGoals.mockResolvedValue(OK_RESULT);

    const response2 = await GET(new Request("http://localhost:3000/api/nutrition-goals", {
      headers: { "if-none-match": etag },
    }));

    expect(response2.status).toBe(304);
    expect(response2.headers.get("ETag")).toBe(etag);
    expect(response2.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});
