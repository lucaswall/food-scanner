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

const mockGetCachedFitbitProfile = vi.fn();
const mockGetCachedFitbitWeightKg = vi.fn();
const mockGetCachedFitbitWeightGoal = vi.fn();
const mockInvalidateFitbitProfileCache = vi.fn();
vi.mock("@/lib/fitbit-cache", () => ({
  getCachedFitbitProfile: (...args: unknown[]) => mockGetCachedFitbitProfile(...args),
  getCachedFitbitWeightKg: (...args: unknown[]) => mockGetCachedFitbitWeightKg(...args),
  getCachedFitbitWeightGoal: (...args: unknown[]) => mockGetCachedFitbitWeightGoal(...args),
  invalidateFitbitProfileCache: (...args: unknown[]) => mockInvalidateFitbitProfileCache(...args),
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

const { GET } = await import("@/app/api/fitbit/profile/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

function createRequest(url = "http://localhost:3000/api/fitbit/profile"): Request {
  return new Request(url);
}

describe("GET /api/fitbit/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTodayDate.mockReturnValue("2026-01-15");
    mockGetCachedFitbitProfile.mockResolvedValue({ ageYears: 34, sex: "MALE", heightCm: 180 });
    mockGetCachedFitbitWeightKg.mockResolvedValue({ weightKg: 90.5, loggedDate: "2026-01-14" });
    mockGetCachedFitbitWeightGoal.mockResolvedValue({ goalType: "LOSE" });
  });

  it("returns composed profile data on valid request", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toMatchObject({
      ageYears: 34,
      sex: "MALE",
      heightCm: 180,
      weightKg: 90.5,
      weightLoggedDate: "2026-01-14",
      goalType: "LOSE",
      lastSyncedAt: expect.any(Number),
    });
  });

  it("calls getCachedFitbitWeightKg with today's date", async () => {
    mockGetSession.mockResolvedValue(validSession);

    await GET(createRequest());

    expect(mockGetCachedFitbitWeightKg).toHaveBeenCalledWith("user-123", "2026-01-15", expect.anything());
  });

  it("handles null weight gracefully", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetCachedFitbitWeightKg.mockResolvedValue(null);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.weightKg).toBeNull();
    expect(data.data.weightLoggedDate).toBeNull();
  });

  it("handles null weight goal gracefully", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetCachedFitbitWeightGoal.mockResolvedValue(null);

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.goalType).toBeNull();
  });

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

  it("sets Cache-Control: private, no-cache", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const response = await GET(createRequest());

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("calls invalidateFitbitProfileCache when ?refresh=1", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const response = await GET(createRequest("http://localhost:3000/api/fitbit/profile?refresh=1"));
    const data = await response.json();

    expect(mockInvalidateFitbitProfileCache).toHaveBeenCalledWith("user-123");
    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it("does not call invalidateFitbitProfileCache without ?refresh=1", async () => {
    mockGetSession.mockResolvedValue(validSession);

    await GET(createRequest());

    expect(mockInvalidateFitbitProfileCache).not.toHaveBeenCalled();
  });

  it("returns 424 on FITBIT_CREDENTIALS_MISSING error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetCachedFitbitProfile.mockRejectedValue(new Error("FITBIT_CREDENTIALS_MISSING"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(424);
    expect(data.error.code).toBe("FITBIT_CREDENTIALS_MISSING");
  });

  it("returns 401 on FITBIT_TOKEN_INVALID error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetCachedFitbitProfile.mockRejectedValue(new Error("FITBIT_TOKEN_INVALID"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.code).toBe("FITBIT_TOKEN_INVALID");
  });

  it("returns 403 on FITBIT_SCOPE_MISSING error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetCachedFitbitProfile.mockRejectedValue(new Error("FITBIT_SCOPE_MISSING"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error.code).toBe("FITBIT_SCOPE_MISSING");
  });

  it("returns 429 on FITBIT_RATE_LIMIT error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetCachedFitbitProfile.mockRejectedValue(new Error("FITBIT_RATE_LIMIT"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error.code).toBe("FITBIT_RATE_LIMIT");
  });

  it("returns 504 on FITBIT_TIMEOUT error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetCachedFitbitProfile.mockRejectedValue(new Error("FITBIT_TIMEOUT"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(504);
    expect(data.error.code).toBe("FITBIT_TIMEOUT");
  });

  it("returns 502 on FITBIT_REFRESH_TRANSIENT error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetCachedFitbitProfile.mockRejectedValue(new Error("FITBIT_REFRESH_TRANSIENT"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error.code).toBe("FITBIT_REFRESH_TRANSIENT");
  });

  it("returns 502 on FITBIT_API_ERROR error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetCachedFitbitProfile.mockRejectedValue(new Error("FITBIT_API_ERROR"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error.code).toBe("FITBIT_API_ERROR");
  });

  it("returns 500 on unknown error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetCachedFitbitProfile.mockRejectedValue(new Error("Some unexpected error"));

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});
