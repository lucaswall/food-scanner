import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("FITBIT_CLIENT_ID", "test-fitbit-client-id");
vi.stubEnv("FITBIT_CLIENT_SECRET", "test-fitbit-client-secret");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

// Mock session module
const mockGetSession = vi.fn();
const mockValidateSession = vi.fn();
const mockRawSession = {
  sessionId: "test-session",
  save: vi.fn(),
} as Record<string, unknown>;

vi.mock("@/lib/session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
  getRawSession: vi.fn().mockResolvedValue(mockRawSession),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const { POST, GET } = await import("@/app/api/auth/fitbit/route");
const { logger } = await import("@/lib/logger");

const validSession: FullSession = {
  sessionId: "test-session",
  email: "test@example.com",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: false,
  destroy: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://localhost:3000");
  mockGetSession.mockResolvedValue(validSession);
  mockValidateSession.mockReturnValue(null); // null = valid session
  Object.keys(mockRawSession).forEach((key) => {
    if (key !== "save" && key !== "sessionId") delete mockRawSession[key];
  });
  mockRawSession.sessionId = "test-session";
  mockRawSession.save = vi.fn();
});

describe("POST /api/auth/fitbit", () => {
  it("returns a redirect to Fitbit OAuth URL with valid session", async () => {
    const response = await POST();

    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    expect(location).toContain("fitbit.com");
    expect(location).toContain("client_id=test-fitbit-client-id");
  });

  it("returns 401 without valid session", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateSession.mockReturnValue(
      Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      ),
    );

    const response = await POST();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("uses APP_URL for redirect URI", async () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    const response = await POST();
    const location = response.headers.get("location")!;
    expect(location).toContain(
      encodeURIComponent("https://food.lucaswall.me/api/auth/fitbit/callback"),
    );
  });

  it("stores OAuth state in iron-session, not a plain cookie", async () => {
    const response = await POST();

    // State should be stored in session
    expect(mockRawSession.oauthState).toBeTruthy();
    expect(mockRawSession.save).toHaveBeenCalled();

    // Should NOT set a plain fitbit-oauth-state cookie
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBeNull();
  });

  it("logs info on OAuth initiation", async () => {
    await POST();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fitbit_oauth_start" }),
      expect.any(String),
    );
  });
});

describe("GET /api/auth/fitbit", () => {
  it("returns a redirect to Fitbit OAuth URL with valid session", async () => {
    const response = await GET();

    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    expect(location).toContain("fitbit.com");
  });

  it("returns 401 without valid session", async () => {
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

  it("stores OAuth state in iron-session", async () => {
    await GET();
    expect(mockRawSession.oauthState).toBeTruthy();
    expect(mockRawSession.save).toHaveBeenCalled();
  });
});
