import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

const mockGetSession = vi.fn();
const mockValidateSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

const mockCheckFitbitHealth = vi.fn();
vi.mock("@/lib/fitbit-health", () => ({
  checkFitbitHealth: (...args: unknown[]) => mockCheckFitbitHealth(...args),
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const { GET } = await import("@/app/api/fitbit/health/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "test-user-uuid",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: false,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(validSession);
  mockValidateSession.mockReturnValue(null); // null = valid
  mockCheckFitbitHealth.mockResolvedValue({ status: "healthy" });
});

describe("GET /api/fitbit/health", () => {
  it("returns 401 when no valid session", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateSession.mockReturnValue(
      Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      ),
    );

    const response = await GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns FitbitHealthStatus shape with status: healthy", async () => {
    mockCheckFitbitHealth.mockResolvedValue({ status: "healthy" });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ status: "healthy" });
  });

  it("returns FitbitHealthStatus shape with status: needs_setup", async () => {
    mockCheckFitbitHealth.mockResolvedValue({ status: "needs_setup" });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ status: "needs_setup" });
  });

  it("returns FitbitHealthStatus shape with status: scope_mismatch", async () => {
    mockCheckFitbitHealth.mockResolvedValue({
      status: "scope_mismatch",
      missingScopes: ["profile", "weight"],
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("scope_mismatch");
    expect(body.data.missingScopes).toEqual(["profile", "weight"]);
  });

  it("sets Cache-Control: private, no-cache", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
  });

  it("calls checkFitbitHealth with session userId", async () => {
    await GET();
    expect(mockCheckFitbitHealth).toHaveBeenCalledWith(
      "test-user-uuid",
      expect.anything(),
    );
  });

  it("returns 500 INTERNAL_ERROR when checkFitbitHealth throws", async () => {
    mockCheckFitbitHealth.mockRejectedValue(new Error("DB connection failed"));

    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
