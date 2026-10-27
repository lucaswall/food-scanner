import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (
    session: FullSession | null,
    options?: { requireHealth?: boolean },
  ): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      );
    }
    if (options?.requireHealth && !session.healthConnected) {
      return Response.json(
        { success: false, error: { code: "HEALTH_NOT_CONNECTED", message: "Google Health not connected" }, timestamp: Date.now() },
        { status: 400 },
      );
    }
    return null;
  },
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: mockLogger, createRequestLogger: vi.fn(() => mockLogger) };
});

const mockGetCachedHealthProfile = vi.fn();
const mockGetCachedHealthWeightKg = vi.fn();
const mockExpireHealthProfileCache = vi.fn();
const mockGetHealthProfileSyncedAt = vi.fn();
vi.mock("@/lib/health-cache", () => ({
  getCachedHealthProfile: (...args: unknown[]) => mockGetCachedHealthProfile(...args),
  getCachedHealthWeightKg: (...args: unknown[]) => mockGetCachedHealthWeightKg(...args),
  expireHealthProfileCache: (...args: unknown[]) => mockExpireHealthProfileCache(...args),
  getHealthProfileSyncedAt: (...args: unknown[]) => mockGetHealthProfileSyncedAt(...args),
}));

const mockGetUserGoalSettings = vi.fn();
vi.mock("@/lib/users", () => ({
  getUserGoalSettings: (...args: unknown[]) => mockGetUserGoalSettings(...args),
}));

const mockInvalidateUserDailyGoalsForDate = vi.fn();
vi.mock("@/lib/daily-goals", () => ({
  invalidateUserDailyGoalsForDate: (...args: unknown[]) => mockInvalidateUserDailyGoalsForDate(...args),
}));

const { GET } = await import("@/app/api/health-profile/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  healthConnected: true,
  destroy: vi.fn(),
};

function createRequest(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(validSession);
  mockGetCachedHealthProfile.mockResolvedValue({ ageYears: 34, sex: "MALE", heightCm: 180 });
  mockGetCachedHealthWeightKg.mockResolvedValue({ weightKg: 80.5, loggedDate: "2026-05-30" });
  mockGetUserGoalSettings.mockResolvedValue({
    activityLevel: "moderate",
    goalWeightKg: "75",
    goalRateKgPerWeek: "0.5",
    sex: "MALE",
    weightGoalType: "LOSE",
  });
  mockInvalidateUserDailyGoalsForDate.mockResolvedValue(undefined);
  mockGetHealthProfileSyncedAt.mockReturnValue(null);
});

describe("GET /api/health-profile", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 HEALTH_NOT_CONNECTED when health not connected", async () => {
    mockGetSession.mockResolvedValue({ ...validSession, healthConnected: false });
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_NOT_CONNECTED");
  });

  it("returns profile with { ageYears, sex, heightCm, weightKg, weightLoggedDate, goalType, lastSyncedAt }", async () => {
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.ageYears).toBe(34);
    expect(body.data.sex).toBe("MALE");
    expect(body.data.heightCm).toBe(180);
    expect(body.data.weightKg).toBe(80.5);
    expect(body.data.weightLoggedDate).toBe("2026-05-30");
    expect(body.data.goalType).toBe("LOSE");
    expect(typeof body.data.lastSyncedAt).toBe("number");
  });

  it("returns goalType from users.weightGoalType (not Fitbit)", async () => {
    mockGetUserGoalSettings.mockResolvedValue({ sex: "MALE", weightGoalType: "GAIN" });
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    const body = await response.json();
    expect(body.data.goalType).toBe("GAIN");
  });

  it("returns null goalType when weightGoalType is not set", async () => {
    mockGetUserGoalSettings.mockResolvedValue({ sex: "MALE", weightGoalType: null });
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    const body = await response.json();
    expect(body.data.goalType).toBeNull();
  });

  it("sets Cache-Control: private, no-cache header", async () => {
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("?refresh=1 expires the health cache and, once data is refetched, invalidates the user's daily-goals row", async () => {
    mockGetHealthProfileSyncedAt.mockImplementation(() => Date.now() + 1000);
    const response = await GET(createRequest("http://localhost:3000/api/health-profile?refresh=1&clientDate=2026-05-07"));
    expect(response.status).toBe(200);
    expect(mockExpireHealthProfileCache).toHaveBeenCalledWith("user-uuid-123");
    expect(mockGetCachedHealthWeightKg).toHaveBeenCalledWith("user-uuid-123", "2026-05-07", expect.anything(), "important");
    expect(mockInvalidateUserDailyGoalsForDate).toHaveBeenCalledWith("user-uuid-123", "2026-05-07");
  });

  it("?refresh=1 does NOT invalidate goals when the refetch failed", async () => {
    mockGetCachedHealthProfile.mockRejectedValue(new Error("HEALTH_API_ERROR"));
    const response = await GET(createRequest("http://localhost:3000/api/health-profile?refresh=1"));
    expect(response.status).toBe(502);
    expect(mockInvalidateUserDailyGoalsForDate).not.toHaveBeenCalled();
  });

  it("?refresh=1 does NOT invalidate goals when stale data was served (nothing was refetched)", async () => {
    mockGetHealthProfileSyncedAt.mockReturnValue(Date.now() - 3_600_000);
    const response = await GET(createRequest("http://localhost:3000/api/health-profile?refresh=1"));
    expect(response.status).toBe(200);
    expect(mockInvalidateUserDailyGoalsForDate).not.toHaveBeenCalled();
  });

  it("lastSyncedAt reflects when the data was fetched, not the request time", async () => {
    const fetchedAt = Date.now() - 600_000;
    mockGetHealthProfileSyncedAt.mockReturnValue(fetchedAt);
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    const body = await response.json();
    expect(body.data.lastSyncedAt).toBe(fetchedAt);
  });

  it("returns 400 for an invalid clientDate", async () => {
    const response = await GET(createRequest("http://localhost:3000/api/health-profile?clientDate=nope"));
    expect(response.status).toBe(400);
  });

  it("no refresh param — no invalidation", async () => {
    await GET(createRequest("http://localhost:3000/api/health-profile"));
    expect(mockExpireHealthProfileCache).not.toHaveBeenCalled();
    expect(mockInvalidateUserDailyGoalsForDate).not.toHaveBeenCalled();
  });

  it("returns 401 HEALTH_TOKEN_INVALID on token error", async () => {
    mockGetCachedHealthProfile.mockRejectedValue(new Error("HEALTH_TOKEN_INVALID"));
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_TOKEN_INVALID");
  });

  it("returns 503 HEALTH_RATE_LIMIT_LOW on rate limit", async () => {
    mockGetCachedHealthProfile.mockRejectedValue(new Error("HEALTH_RATE_LIMIT_LOW"));
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_RATE_LIMIT_LOW");
  });

  it("returns 429 HEALTH_RATE_LIMIT when Google Health rate-limits the request", async () => {
    mockGetCachedHealthProfile.mockRejectedValue(new Error("HEALTH_RATE_LIMIT"));
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_RATE_LIMIT");
  });

  it("returns null weightKg when no weight log", async () => {
    mockGetCachedHealthWeightKg.mockResolvedValue(null);
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    const body = await response.json();
    expect(body.data.weightKg).toBeNull();
    expect(body.data.weightLoggedDate).toBeNull();
  });
});
