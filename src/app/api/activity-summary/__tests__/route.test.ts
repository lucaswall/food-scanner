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
const mockGetActivitySummary = vi.fn();
vi.mock("@/lib/fitbit", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  getActivitySummary: (...args: unknown[]) => mockGetActivitySummary(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { GET } = await import("@/app/api/activity-summary/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

describe("GET /api/activity-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns activity summary from Fitbit on valid request", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetActivitySummary.mockResolvedValue({
      caloriesOut: 2500,
      steps: 10000,
      distance: 8.5,
      activeMinutes: 45,
    });

    const request = new Request("http://localhost:3000/api/activity-summary?date=2026-02-10");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      data: {
        caloriesOut: 2500,
        steps: 10000,
        distance: 8.5,
        activeMinutes: 45,
      },
      timestamp: expect.any(Number),
    });
    expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-123");
    expect(mockGetActivitySummary).toHaveBeenCalledWith("mock-access-token", "2026-02-10");
  });

  it("returns 401 when session is missing", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/activity-summary?date=2026-02-10");
    const response = await GET(request);
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

    const request = new Request("http://localhost:3000/api/activity-summary?date=2026-02-10");
    const response = await GET(request);
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

    const request = new Request("http://localhost:3000/api/activity-summary?date=2026-02-10");
    const response = await GET(request);
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

  it("returns 404 when ensureFreshToken throws FITBIT_CREDENTIALS_MISSING", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_CREDENTIALS_MISSING"));

    const request = new Request("http://localhost:3000/api/activity-summary?date=2026-02-10");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(404);
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

    const request = new Request("http://localhost:3000/api/activity-summary?date=2026-02-10");
    const response = await GET(request);
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

  it("returns 502 when getActivitySummary throws FITBIT_API_ERROR", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetActivitySummary.mockRejectedValue(new Error("FITBIT_API_ERROR"));

    const request = new Request("http://localhost:3000/api/activity-summary?date=2026-02-10");
    const response = await GET(request);
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

  it("returns 500 on generic/unknown error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("Something unexpected"));

    const request = new Request("http://localhost:3000/api/activity-summary?date=2026-02-10");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch activity summary",
      },
      timestamp: expect.any(Number),
    });
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("mock-access-token");
    mockGetActivitySummary.mockResolvedValue({
      caloriesOut: 2500,
      steps: 10000,
      distance: 8.5,
      activeMinutes: 45,
    });

    const request = new Request("http://localhost:3000/api/activity-summary?date=2026-02-10");
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 400 when date query parameter is missing", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = new Request("http://localhost:3000/api/activity-summary");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "date query parameter is required (YYYY-MM-DD)",
      },
      timestamp: expect.any(Number),
    });
  });

  it("returns 400 when date format is invalid", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = new Request("http://localhost:3000/api/activity-summary?date=invalid-date");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid date format. Use YYYY-MM-DD",
      },
      timestamp: expect.any(Number),
    });
  });
});
