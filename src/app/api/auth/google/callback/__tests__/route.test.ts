import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
vi.stubEnv("ALLOWED_EMAILS", "test@example.com");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

// Mock the auth module
vi.mock("@/lib/auth", () => ({
  buildGoogleAuthUrl: vi.fn(),
  exchangeGoogleCode: vi.fn(),
  getGoogleProfile: vi.fn(),
}));

// Mock session module — getRawSession returns mutable iron-session object
const mockRawSession = {
  save: vi.fn(),
  destroy: vi.fn(),
} as Record<string, unknown>;

vi.mock("@/lib/session", () => ({
  getRawSession: vi.fn().mockResolvedValue(mockRawSession),
  sessionOptions: {
    password: "a-test-secret-that-is-at-least-32-characters-long",
    cookieName: "food-scanner-session",
    cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", maxAge: 2592000, path: "/" },
  },
}));

// Mock session-db
const mockCreateSession = vi.fn();
vi.mock("@/lib/session-db", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
}));

// Mock fitbit-tokens
const mockGetFitbitTokens = vi.fn();
vi.mock("@/lib/fitbit-tokens", () => ({
  getFitbitTokens: (...args: unknown[]) => mockGetFitbitTokens(...args),
}));

// Mock fitbit-credentials
const mockHasFitbitCredentials = vi.fn();
vi.mock("@/lib/fitbit-credentials", () => ({
  hasFitbitCredentials: (...args: unknown[]) => mockHasFitbitCredentials(...args),
}));

// Mock rate limiter
const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

// Mock users module
const mockGetOrCreateUser = vi.fn();
vi.mock("@/lib/users", () => ({
  getOrCreateUser: (...args: unknown[]) => mockGetOrCreateUser(...args),
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

const { exchangeGoogleCode, getGoogleProfile } = await import("@/lib/auth");
const { GET } = await import("@/app/api/auth/google/callback/route");
const { logger } = await import("@/lib/logger");

const mockExchangeGoogleCode = vi.mocked(exchangeGoogleCode);
const mockGetGoogleProfile = vi.mocked(getGoogleProfile);

const fakeUser = { id: "user-uuid-123", email: "test@example.com", name: "Test User" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://localhost:3000");
  Object.keys(mockRawSession).forEach((key) => {
    if (key !== "save" && key !== "destroy") delete mockRawSession[key];
  });
  mockRawSession.save = vi.fn();
  mockRawSession.destroy = vi.fn();
  mockRawSession.oauthState = "test-state"; // State stored in iron-session
  mockCreateSession.mockResolvedValue("new-session-uuid");
  mockGetFitbitTokens.mockResolvedValue(null);
  mockHasFitbitCredentials.mockResolvedValue(false);
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  mockGetOrCreateUser.mockResolvedValue(fakeUser);
});

function makeCallbackRequest(code: string | null, state: string | null) {
  const url = new URL("http://localhost:3000/api/auth/google/callback");
  if (code) url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return new Request(url);
}

describe("GET /api/auth/google/callback", () => {
  it("creates user record and DB session with userId, stores sessionId in cookie, and redirects", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(302);
    expect(mockGetOrCreateUser).toHaveBeenCalledWith("test@example.com", "Test User");
    expect(mockCreateSession).toHaveBeenCalledWith("user-uuid-123");
    expect(mockRawSession.sessionId).toBe("new-session-uuid");
    expect(mockRawSession.save).toHaveBeenCalled();
  });

  it("allows second email in allowlist", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "first@example.com, test@example.com");
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(302);
    expect(mockGetOrCreateUser).toHaveBeenCalledWith("test@example.com", "Test User");
  });

  it("reads OAuth state from iron-session, not plain cookie", async () => {
    mockRawSession.oauthState = "session-state";
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });

    // State in URL matches session state
    const response = await GET(makeCallbackRequest("valid-code", "session-state"));
    expect(response.status).toBe(302);
  });

  it("rejects when URL state does not match session state", async () => {
    mockRawSession.oauthState = "correct-state";

    const response = await GET(makeCallbackRequest("code", "wrong-state"));
    expect(response.status).toBe(400);
  });

  it("clears oauthState from session after successful auth", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });

    await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(mockRawSession.oauthState).toBeUndefined();
    expect(mockRawSession.save).toHaveBeenCalled();
  });

  it("returns 403 for disallowed email", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "hacker@evil.com",
      name: "Hacker",
    });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_INVALID_EMAIL");
  });

  it("uses APP_URL for redirect URI and post-login redirect, not request.url", async () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });

    const url = new URL("http://internal:8080/api/auth/google/callback");
    url.searchParams.set("code", "valid-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url);

    const response = await GET(request);

    expect(mockExchangeGoogleCode).toHaveBeenCalledWith(
      "valid-code",
      "https://food.lucaswall.me/api/auth/google/callback",
    );

    const location = response.headers.get("location")!;
    expect(location).toContain("https://food.lucaswall.me/");
    expect(location).not.toContain("internal:8080");
  });

  it("returns error when code exchange fails", async () => {
    mockExchangeGoogleCode.mockRejectedValue(new Error("Invalid code"));

    const response = await GET(makeCallbackRequest("invalid-code", "test-state"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it("logs error when code exchange fails", async () => {
    mockExchangeGoogleCode.mockRejectedValue(new Error("Token exchange failed"));

    await GET(makeCallbackRequest("bad-code", "test-state"));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "google_token_exchange_error",
        error: "Token exchange failed",
      }),
      expect.any(String),
    );
  });

  it("logs error when profile fetch fails", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "token" });
    mockGetGoogleProfile.mockRejectedValue(new Error("Profile fetch failed"));

    await GET(makeCallbackRequest("code", "test-state"));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "google_profile_fetch_error",
        error: "Profile fetch failed",
      }),
      expect.any(String),
    );
  });

  it("redirects to /app when Fitbit tokens exist in DB", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });
    mockGetFitbitTokens.mockResolvedValue({ accessToken: "existing" });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/app",
    );
  });

  it("redirects to /app/setup-fitbit when no credentials and no tokens", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });
    mockGetFitbitTokens.mockResolvedValue(null);
    mockHasFitbitCredentials.mockResolvedValue(false);

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/app/setup-fitbit",
    );
  });

  it("redirects to /api/auth/fitbit when credentials exist but no tokens", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });
    mockGetFitbitTokens.mockResolvedValue(null);
    mockHasFitbitCredentials.mockResolvedValue(true);

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/api/auth/fitbit",
    );
  });

  // Logging tests
  it("logs warn on invalid OAuth state", async () => {
    await GET(makeCallbackRequest("code", "bad-state"));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "google_callback_invalid_state" }),
      expect.any(String),
    );
  });

  it("logs warn on unauthorized email with masked email", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "bad@evil.com", name: "Bad" });
    await GET(makeCallbackRequest("code", "test-state"));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "google_unauthorized_email",
        email: "b***@evil.com",
      }),
      expect.any(String),
    );
  });

  it("throws when ALLOWED_EMAILS env var is unset", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "");
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test" });

    await expect(GET(makeCallbackRequest("code", "test-state"))).rejects.toThrow(
      "Required environment variable ALLOWED_EMAILS is not set",
    );

    // Restore env for subsequent tests
    vi.stubEnv("ALLOWED_EMAILS", "test@example.com");
  });

  it("logs info on successful login with masked email", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "test@example.com",
      name: "Test User",
    });
    await GET(makeCallbackRequest("code", "test-state"));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "google_login_success",
        email: "t***@example.com",
      }),
      expect.any(String),
    );
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await GET(makeCallbackRequest("code", "test-state"));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});
