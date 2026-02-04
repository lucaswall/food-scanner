import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("FITBIT_CLIENT_ID", "test-fitbit-client-id");
vi.stubEnv("FITBIT_CLIENT_SECRET", "test-fitbit-client-secret");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

// Mock fitbit module
vi.mock("@/lib/fitbit", () => ({
  buildFitbitAuthUrl: vi.fn(),
  exchangeFitbitCode: vi.fn(),
  refreshFitbitToken: vi.fn(),
  ensureFreshToken: vi.fn(),
}));

// Mock iron-session
vi.mock("iron-session", () => ({
  getIronSession: vi.fn().mockResolvedValue({
    email: "wall.lucas@gmail.com",
    sessionId: "test-session",
    save: vi.fn(),
  }),
}));

const { exchangeFitbitCode } = await import("@/lib/fitbit");
const { getIronSession } = await import("iron-session");
const { GET } = await import("@/app/api/auth/fitbit/callback/route");

const mockExchangeFitbitCode = vi.mocked(exchangeFitbitCode);
const mockGetIronSession = vi.mocked(getIronSession);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetIronSession.mockResolvedValue({
    email: "wall.lucas@gmail.com",
    sessionId: "test-session",
    save: vi.fn(),
  } as never);
});

describe("GET /api/auth/fitbit/callback", () => {
  it("stores tokens in session and redirects to /app on valid code", async () => {
    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "fitbit-access-token",
      refresh_token: "fitbit-refresh-token",
      user_id: "fitbit-user-123",
      expires_in: 28800,
    });

    const session = {
      email: "wall.lucas@gmail.com",
      sessionId: "test-session",
      save: vi.fn(),
    } as Record<string, unknown>;
    mockGetIronSession.mockResolvedValue(session as never);

    const url = new URL("http://localhost:3000/api/auth/fitbit/callback");
    url.searchParams.set("code", "valid-fitbit-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url, {
      headers: {
        cookie: "fitbit-oauth-state=test-state; food-scanner-session=encrypted",
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/app");
    expect(session.save).toHaveBeenCalled();
    expect(session.fitbit).toEqual(
      expect.objectContaining({
        accessToken: "fitbit-access-token",
        refreshToken: "fitbit-refresh-token",
        userId: "fitbit-user-123",
      }),
    );
  });

  it("returns error when code exchange fails", async () => {
    mockExchangeFitbitCode.mockRejectedValue(new Error("Invalid code"));

    const url = new URL("http://localhost:3000/api/auth/fitbit/callback");
    url.searchParams.set("code", "invalid-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url, {
      headers: {
        cookie: "fitbit-oauth-state=test-state; food-scanner-session=encrypted",
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });
});
