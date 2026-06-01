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
const mockInvalidateHealthProfileCache = vi.fn();
vi.mock("@/lib/health-cache", () => ({
  getCachedHealthProfile: (...args: unknown[]) => mockGetCachedHealthProfile(...args),
  getCachedHealthWeightKg: (...args: unknown[]) => mockGetCachedHealthWeightKg(...args),
  invalidateHealthProfileCache: (...args: unknown[]) => mockInvalidateHealthProfileCache(...args),
}));

const mockGetWeightGoalType = vi.fn();
vi.mock("@/lib/users", () => ({
  getWeightGoalType: (...args: unknown[]) => mockGetWeightGoalType(...args),
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
  mockGetWeightGoalType.mockResolvedValue("LOSE");
  mockInvalidateUserDailyGoalsForDate.mockResolvedValue(undefined);
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
    mockGetWeightGoalType.mockResolvedValue("GAIN");
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    const body = await response.json();
    expect(body.data.goalType).toBe("GAIN");
  });

  it("returns null goalType when weightGoalType is not set", async () => {
    mockGetWeightGoalType.mockResolvedValue(null);
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    const body = await response.json();
    expect(body.data.goalType).toBeNull();
  });

  it("sets Cache-Control: private, no-cache header", async () => {
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("?refresh=1 invalidates health cache and daily goals", async () => {
    const response = await GET(createRequest("http://localhost:3000/api/health-profile?refresh=1"));
    expect(response.status).toBe(200);
    expect(mockInvalidateHealthProfileCache).toHaveBeenCalledWith("user-uuid-123");
    expect(mockInvalidateUserDailyGoalsForDate).toHaveBeenCalledWith("user-uuid-123", expect.any(String));
  });

  it("?refresh=1 not present — no invalidation", async () => {
    await GET(createRequest("http://localhost:3000/api/health-profile"));
    expect(mockInvalidateHealthProfileCache).not.toHaveBeenCalled();
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

  it("returns null weightKg when no weight log", async () => {
    mockGetCachedHealthWeightKg.mockResolvedValue(null);
    const response = await GET(createRequest("http://localhost:3000/api/health-profile"));
    const body = await response.json();
    expect(body.data.weightKg).toBeNull();
    expect(body.data.weightLoggedDate).toBeNull();
  });
});
