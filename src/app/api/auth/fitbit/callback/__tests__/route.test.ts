import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("FITBIT_CLIENT_ID", "test-fitbit-client-id");
vi.stubEnv("FITBIT_CLIENT_SECRET", "test-fitbit-client-secret");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

// Mock fitbit module
vi.mock("@/lib/fitbit", () => ({
  buildFitbitAuthUrl: vi.fn(),
  exchangeFitbitCode: vi.fn(),
  refreshFitbitToken: vi.fn(),
  ensureFreshToken: vi.fn(),
}));

// Mock session module
const mockSession = {
  email: "wall.lucas@gmail.com",
  sessionId: "test-session",
  save: vi.fn(),
} as Record<string, unknown>;

vi.mock("@/lib/session", () => ({
  getSession: vi.fn().mockResolvedValue(mockSession),
  sessionOptions: {
    password: "a-test-secret-that-is-at-least-32-characters-long",
    cookieName: "food-scanner-session",
    cookieOptions: { httpOnly: true, secure: true, sameSite: "strict", maxAge: 2592000, path: "/" },
  },
}));

// Mock next/headers cookies()
const mockCookieStore = {
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}));

const { exchangeFitbitCode } = await import("@/lib/fitbit");
const { getSession } = await import("@/lib/session");
const { GET } = await import("@/app/api/auth/fitbit/callback/route");

const mockExchangeFitbitCode = vi.mocked(exchangeFitbitCode);
const mockGetSession = vi.mocked(getSession);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://localhost:3000");
  Object.keys(mockSession).forEach((key) => {
    if (key !== "save" && key !== "email" && key !== "sessionId") delete mockSession[key];
  });
  mockSession.email = "wall.lucas@gmail.com";
  mockSession.sessionId = "test-session";
  mockSession.save = vi.fn();
  mockGetSession.mockResolvedValue(mockSession as never);
});

describe("GET /api/auth/fitbit/callback", () => {
  it("stores tokens in session and redirects to /app on valid code", async () => {
    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "fitbit-access-token",
      refresh_token: "fitbit-refresh-token",
      user_id: "fitbit-user-123",
      expires_in: 28800,
    });

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
    expect(mockGetSession).toHaveBeenCalled();
    expect(mockSession.save).toHaveBeenCalled();
    expect(mockSession.fitbit).toEqual(
      expect.objectContaining({
        accessToken: "fitbit-access-token",
        refreshToken: "fitbit-refresh-token",
        userId: "fitbit-user-123",
      }),
    );
  });

  it("uses APP_URL for redirect URI and post-auth redirect, not request.url", async () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "fitbit-access-token",
      refresh_token: "fitbit-refresh-token",
      user_id: "fitbit-user-123",
      expires_in: 28800,
    });

    const url = new URL("http://internal:8080/api/auth/fitbit/callback");
    url.searchParams.set("code", "valid-fitbit-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url, {
      headers: {
        cookie: "fitbit-oauth-state=test-state; food-scanner-session=encrypted",
      },
    });

    const response = await GET(request);

    // Verify redirect URI passed to exchangeFitbitCode uses APP_URL
    expect(mockExchangeFitbitCode).toHaveBeenCalledWith(
      "valid-fitbit-code",
      "https://food.lucaswall.me/api/auth/fitbit/callback",
    );

    // Verify post-auth redirect uses APP_URL
    const location = response.headers.get("location")!;
    expect(location).toBe("https://food.lucaswall.me/app");
    expect(location).not.toContain("internal:8080");
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

  it("clears the fitbit-oauth-state cookie after successful auth", async () => {
    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "fitbit-access-token",
      refresh_token: "fitbit-refresh-token",
      user_id: "fitbit-user-123",
      expires_in: 28800,
    });

    const url = new URL("http://localhost:3000/api/auth/fitbit/callback");
    url.searchParams.set("code", "valid-fitbit-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url, {
      headers: {
        cookie: "fitbit-oauth-state=test-state; food-scanner-session=encrypted",
      },
    });

    await GET(request);
    expect(mockCookieStore.delete).toHaveBeenCalledWith("fitbit-oauth-state");
  });

  it("uses a single getSession() call instead of double getIronSession", async () => {
    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "fitbit-access-token",
      refresh_token: "fitbit-refresh-token",
      user_id: "fitbit-user-123",
      expires_in: 28800,
    });

    const url = new URL("http://localhost:3000/api/auth/fitbit/callback");
    url.searchParams.set("code", "valid-fitbit-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url, {
      headers: {
        cookie: "fitbit-oauth-state=test-state; food-scanner-session=encrypted",
      },
    });

    await GET(request);
    // getSession should be called exactly once (no double read+write pattern)
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });
});
