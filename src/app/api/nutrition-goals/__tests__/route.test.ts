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

const mockEnsureFreshToken = vi.fn();
const mockGetFoodGoals = vi.fn();
vi.mock("@/lib/fitbit", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  getFoodGoals: (...args: unknown[]) => mockGetFoodGoals(...args),
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const mockUpsertCalorieGoal = vi.fn();
vi.mock("@/lib/nutrition-goals", () => ({
  upsertCalorieGoal: (...args: unknown[]) => mockUpsertCalorieGoal(...args),
}));

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

describe("GET /api/nutrition-goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTodayDate.mockReturnValue("2026-02-10");
    mockUpsertCalorieGoal.mockResolvedValue(undefined);
  });

  it("returns nutrition goals from Fitbit on valid request", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetFoodGoals.mockResolvedValue({ calories: 2000 });

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: { calories: 2000 },
      timestamp: expect.any(Number),
    });
    expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-123", expect.any(Object));
    expect(mockGetFoodGoals).toHaveBeenCalledWith("mock-access-token", expect.any(Object));
  });

  it("returns 401 when session is missing", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      success: false,
      error: {
        code: "AUTH_MISSING_SESSION",
        message: "No active session",
      },
      timestamp: expect.any(Number),
    });
  });

  it("returns 400 when Fitbit is not connected", async () => {
    mockGetSession.mockResolvedValue({ ...validSession, fitbitConnected: false });

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      success: false,
      error: {
        code: "FITBIT_NOT_CONNECTED",
        message: "Fitbit account not connected",
      },
      timestamp: expect.any(Number),
    });
  });

  it("returns 400 when Fitbit credentials are missing (session flag)", async () => {
    mockGetSession.mockResolvedValue({ ...validSession, hasFitbitCredentials: false });

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      success: false,
      error: {
        code: "FITBIT_CREDENTIALS_MISSING",
        message: "Fitbit credentials not configured",
      },
      timestamp: expect.any(Number),
    });
  });

  it("returns 424 when ensureFreshToken throws FITBIT_CREDENTIALS_MISSING", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_CREDENTIALS_MISSING"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(424);
    expect(data).toEqual({
      success: false,
      error: {
        code: "FITBIT_CREDENTIALS_MISSING",
        message: "Fitbit credentials not found",
      },
      timestamp: expect.any(Number),
    });
  });

  it("returns 401 when ensureFreshToken throws FITBIT_TOKEN_INVALID", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_TOKEN_INVALID"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({
      success: false,
      error: {
        code: "FITBIT_TOKEN_INVALID",
        message: "Fitbit token is invalid or expired",
      },
      timestamp: expect.any(Number),
    });
  });

  it("returns 502 when getFoodGoals throws FITBIT_API_ERROR", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetFoodGoals.mockRejectedValue(new Error("FITBIT_API_ERROR"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data).toEqual({
      success: false,
      error: {
        code: "FITBIT_API_ERROR",
        message: "Fitbit API error",
      },
      timestamp: expect.any(Number),
    });
  });

  it("returns 403 when ensureFreshToken throws FITBIT_SCOPE_MISSING (FOO-420)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_SCOPE_MISSING"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error.code).toBe("FITBIT_SCOPE_MISSING");
  });

  it("returns 429 when ensureFreshToken throws FITBIT_RATE_LIMIT (FOO-420)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_RATE_LIMIT"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error.code).toBe("FITBIT_RATE_LIMIT");
  });

  it("returns 504 when ensureFreshToken throws FITBIT_TIMEOUT (FOO-420)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_TIMEOUT"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data.error.code).toBe("FITBIT_TIMEOUT");
  });

  it("returns 502 when ensureFreshToken throws FITBIT_REFRESH_TRANSIENT (FOO-420)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_REFRESH_TRANSIENT"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error.code).toBe("FITBIT_REFRESH_TRANSIENT");
  });

  it("returns 500 when ensureFreshToken throws FITBIT_TOKEN_SAVE_FAILED (FOO-420)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_TOKEN_SAVE_FAILED"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe("FITBIT_TOKEN_SAVE_FAILED");
  });

  it("returns 500 on generic/unknown error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("Something unexpected"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch nutrition goals",
      },
      timestamp: expect.any(Number),
    });
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetFoodGoals.mockResolvedValue({ calories: 2000 });

    const response = await GET(createRequest());

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("captures calorie goal when goals.calories is set", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetFoodGoals.mockResolvedValue({ calories: 2000 });
    mockGetTodayDate.mockReturnValue("2026-02-10");
    mockUpsertCalorieGoal.mockResolvedValue(undefined);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    // Give the fire-and-forget a moment to execute
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mockUpsertCalorieGoal).toHaveBeenCalledWith("user-123", "2026-02-10", 2000, expect.any(Object));
  });

  it("does not call upsertCalorieGoal when goals.calories is null", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetFoodGoals.mockResolvedValue({ calories: null });

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(mockUpsertCalorieGoal).not.toHaveBeenCalled();
  });

  it("returns success even if upsertCalorieGoal throws", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetFoodGoals.mockResolvedValue({ calories: 2000 });
    mockGetTodayDate.mockReturnValue("2026-02-10");
    mockUpsertCalorieGoal.mockRejectedValue(new Error("Database error"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({ calories: 2000 });
  });

  it("uses clientDate query param for calorie goal capture instead of server UTC (FOO-403)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetFoodGoals.mockResolvedValue({ calories: 2000 });
    mockGetTodayDate.mockReturnValue("2026-02-10"); // Server UTC date
    mockUpsertCalorieGoal.mockResolvedValue(undefined);

    const response = await GET(createRequest("http://localhost:3000/api/nutrition-goals?clientDate=2026-02-11"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    // Client's local date should be used, not server's
    expect(mockUpsertCalorieGoal).toHaveBeenCalledWith("user-123", "2026-02-11", 2000, expect.any(Object));
  });

  it("falls back to server UTC date when clientDate is not provided (FOO-403)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetFoodGoals.mockResolvedValue({ calories: 2000 });
    mockGetTodayDate.mockReturnValue("2026-02-10");
    mockUpsertCalorieGoal.mockResolvedValue(undefined);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    // Should fall back to server date
    expect(mockUpsertCalorieGoal).toHaveBeenCalledWith("user-123", "2026-02-10", 2000, expect.any(Object));
  });
});
