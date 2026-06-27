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
  exchangeGoogleHealthCode: vi.fn(),
  getGoogleHealthIdentity: vi.fn(),
  GOOGLE_HEALTH_SCOPES: [
    "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
    "https://www.googleapis.com/auth/googlehealth.profile.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  ],
}));

const ALL_HEALTH_SCOPES =
  "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly " +
  "https://www.googleapis.com/auth/googlehealth.profile.readonly " +
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly " +
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";

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
const mockGetSessionById = vi.fn();
vi.mock("@/lib/session-db", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  getSessionById: (...args: unknown[]) => mockGetSessionById(...args),
}));

// Mock health-tokens
const mockGetHealthTokens = vi.fn();
const mockUpsertHealthTokens = vi.fn();
vi.mock("@/lib/health-tokens", () => ({
  getHealthTokens: (...args: unknown[]) => mockGetHealthTokens(...args),
  upsertHealthTokens: (...args: unknown[]) => mockUpsertHealthTokens(...args),
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

const { exchangeGoogleCode, getGoogleProfile, exchangeGoogleHealthCode, getGoogleHealthIdentity } = await import("@/lib/auth");
const { GET } = await import("@/app/api/auth/google/callback/route");
const { logger } = await import("@/lib/logger");

const mockExchangeGoogleCode = vi.mocked(exchangeGoogleCode);
const mockGetGoogleProfile = vi.mocked(getGoogleProfile);
const mockExchangeGoogleHealthCode = vi.mocked(exchangeGoogleHealthCode);
const mockGetGoogleHealthIdentity = vi.mocked(getGoogleHealthIdentity);

const fakeUser = { id: "user-uuid-123", email: "test@example.com", name: "Test User" };
const fakeDbSession = {
  id: "new-session-uuid",
  userId: "user-uuid-123",
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 86400000),
};

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
  mockGetHealthTokens.mockResolvedValue(null);
  mockUpsertHealthTokens.mockResolvedValue(undefined);
  mockGetSessionById.mockResolvedValue(null);
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
  mockGetOrCreateUser.mockResolvedValue(fakeUser);
  // Default: emailVerified: true so login flow tests pass without explicit setup
  mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });
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
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(302);
    expect(mockGetOrCreateUser).toHaveBeenCalledWith("test@example.com", "Test User", expect.anything());
    expect(mockCreateSession).toHaveBeenCalledWith("user-uuid-123", expect.anything());
    expect(mockRawSession.sessionId).toBe("new-session-uuid");
    expect(mockRawSession.save).toHaveBeenCalled();
  });

  it("allows second email in allowlist", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "first@example.com, test@example.com");
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(302);
    expect(mockGetOrCreateUser).toHaveBeenCalledWith("test@example.com", "Test User", expect.anything());
  });

  it("reads OAuth state from iron-session, not plain cookie", async () => {
    mockRawSession.oauthState = "session-state";
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });

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
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });

    await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(mockRawSession.oauthState).toBeUndefined();
    expect(mockRawSession.save).toHaveBeenCalled();
  });

  it("returns 403 for disallowed email", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "hacker@evil.com", name: "Hacker", emailVerified: true });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_INVALID_EMAIL");
  });

  it("uses APP_URL for redirect URI and post-login redirect, not request.url", async () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });

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

  it("redirects to /app when health tokens exist in DB", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });
    mockGetHealthTokens.mockResolvedValue({ accessToken: "existing" });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/app");
  });

  it("redirects to /app/connect-health when no health tokens", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });
    mockGetHealthTokens.mockResolvedValue(null);

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.headers.get("location")).toBe("http://localhost:3000/app/connect-health");
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
    mockGetGoogleProfile.mockResolvedValue({ email: "bad@evil.com", name: "Bad", emailVerified: true });
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
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test", emailVerified: true });

    await expect(GET(makeCallbackRequest("code", "test-state"))).rejects.toThrow(
      "Required environment variable ALLOWED_EMAILS is not set",
    );

    // Restore env for subsequent tests
    vi.stubEnv("ALLOWED_EMAILS", "test@example.com");
  });

  it("logs info on successful login with masked email", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });
    await GET(makeCallbackRequest("code", "test-state"));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "google_login_success",
        email: "t***@example.com",
      }),
      expect.any(String),
    );
  });

  it("redirects to returnTo when JSON state contains returnTo and user has health tokens", async () => {
    const jsonState = JSON.stringify({ nonce: "abc-nonce", returnTo: "/app/log-shared/tok123" });
    mockRawSession.oauthState = jsonState;
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });
    mockGetHealthTokens.mockResolvedValue({ accessToken: "existing" });

    const response = await GET(makeCallbackRequest("valid-code", jsonState));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/app/log-shared/tok123");
  });

  it("redirects to /app/connect-health when JSON state has returnTo but user has no health tokens", async () => {
    const jsonState = JSON.stringify({ nonce: "abc-nonce", returnTo: "/app/log-shared/tok123" });
    mockRawSession.oauthState = jsonState;
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });
    mockGetHealthTokens.mockResolvedValue(null);

    const response = await GET(makeCallbackRequest("valid-code", jsonState));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/app/connect-health");
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await GET(makeCallbackRequest("code", "test-state"));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("consumes OAuth state before token exchange", async () => {
    let stateAtExchangeTime: string | undefined;
    let saveCallCount = 0;

    // Capture state value and save call count when exchangeGoogleCode is called
    mockExchangeGoogleCode.mockImplementation(async () => {
      stateAtExchangeTime = mockRawSession.oauthState as string | undefined;
      saveCallCount = (mockRawSession.save as ReturnType<typeof vi.fn>).mock.calls.length;
      return { access_token: "google-token" };
    });

    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: true });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(302);

    // State should already be undefined when token exchange happens
    expect(stateAtExchangeTime).toBeUndefined();

    // Save should have been called at least once before token exchange
    expect(saveCallCount).toBeGreaterThanOrEqual(1);
  });

  // email_verified gate tests
  it("returns 403 with AUTH_INVALID_EMAIL when emailVerified is false", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: false });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_INVALID_EMAIL");
  });

  it("does not call getOrCreateUser or createSession when emailVerified is false", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: false });

    await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(mockGetOrCreateUser).not.toHaveBeenCalled();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("warns with google_callback_email_not_verified when emailVerified is false", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "test@example.com", name: "Test User", emailVerified: false });

    await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "google_callback_email_not_verified" }),
      expect.any(String),
    );
  });

  // health-connect flow tests
  it("health-connect: happy path - upserts health tokens and redirects to /app", async () => {
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect" });
    mockRawSession.oauthState = healthState;
    mockRawSession.sessionId = "existing-session-id";
    mockGetSessionById.mockResolvedValue(fakeDbSession);
    mockExchangeGoogleHealthCode.mockResolvedValue({
      access_token: "health-at",
      refresh_token: "health-rt",
      expires_in: 3600,
      scope: ALL_HEALTH_SCOPES,
    });
    mockGetGoogleHealthIdentity.mockResolvedValue("health-uid-123");

    const response = await GET(makeCallbackRequest("health-code", healthState));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/app");
    expect(mockUpsertHealthTokens).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.objectContaining({
        healthUserId: "health-uid-123",
        refreshToken: "health-rt",
        scope: ALL_HEALTH_SCOPES,
      }),
      expect.anything(),
    );
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("health-connect: routes to re-consent when nutrition.writeonly was NOT granted (P1-3)", async () => {
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect" });
    mockRawSession.oauthState = healthState;
    mockRawSession.sessionId = "existing-session-id";
    mockGetSessionById.mockResolvedValue(fakeDbSession);
    // User deselected the write scope via granular consent — only readonly granted.
    mockExchangeGoogleHealthCode.mockResolvedValue({
      access_token: "health-at",
      refresh_token: "health-rt",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/googlehealth.profile.readonly",
    });
    mockGetGoogleHealthIdentity.mockResolvedValue("health-uid-123");

    const response = await GET(makeCallbackRequest("health-code", healthState));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/app/connect-health?error=missing_scope");
  });

  it("health-connect: does not call createSession", async () => {
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect" });
    mockRawSession.oauthState = healthState;
    mockRawSession.sessionId = "existing-session-id";
    mockGetSessionById.mockResolvedValue(fakeDbSession);
    mockExchangeGoogleHealthCode.mockResolvedValue({
      access_token: "health-at",
      refresh_token: "health-rt",
    });
    mockGetGoogleHealthIdentity.mockResolvedValue("health-uid-123");

    await GET(makeCallbackRequest("health-code", healthState));
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("health-connect: returns 401 when no sessionId in cookie", async () => {
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect" });
    mockRawSession.oauthState = healthState;
    // sessionId NOT set in raw session
    mockGetSessionById.mockResolvedValue(null);

    const response = await GET(makeCallbackRequest("health-code", healthState));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("health-connect: returns 401 when DB session not found", async () => {
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect" });
    mockRawSession.oauthState = healthState;
    mockRawSession.sessionId = "stale-session-id";
    mockGetSessionById.mockResolvedValue(null); // DB session expired/not found

    const response = await GET(makeCallbackRequest("health-code", healthState));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("health-connect: returns 400 when refresh_token is missing from token response", async () => {
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect" });
    mockRawSession.oauthState = healthState;
    mockRawSession.sessionId = "existing-session-id";
    mockGetSessionById.mockResolvedValue(fakeDbSession);
    mockExchangeGoogleHealthCode.mockRejectedValue(new Error("Invalid Google Health token response: missing refresh_token"));

    const response = await GET(makeCallbackRequest("health-code", healthState));
    expect(response.status).toBe(400);
  });

  it("health-connect: returns 500 HEALTH_TOKEN_SAVE_FAILED when upsert throws", async () => {
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect" });
    mockRawSession.oauthState = healthState;
    mockRawSession.sessionId = "existing-session-id";
    mockGetSessionById.mockResolvedValue(fakeDbSession);
    mockExchangeGoogleHealthCode.mockResolvedValue({
      access_token: "health-at",
      refresh_token: "health-rt",
      expires_in: 3600,
    });
    mockGetGoogleHealthIdentity.mockResolvedValue("health-uid-123");
    mockUpsertHealthTokens.mockRejectedValue(new Error("db connection lost"));

    const response = await GET(makeCallbackRequest("health-code", healthState));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_TOKEN_SAVE_FAILED");
  });

  // open-redirect guard tests
  it("health-connect: rejects absolute-URL returnTo and falls back to /app", async () => {
    // An attacker could embed returnTo: "https://evil.com" hoping for an open redirect.
    // The guard (startsWith("/") && !startsWith("//")) must reject it and fall back to /app.
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect", returnTo: "https://evil.com/steal" });
    mockRawSession.oauthState = healthState;
    mockRawSession.sessionId = "existing-session-id";
    mockGetSessionById.mockResolvedValue(fakeDbSession);
    mockExchangeGoogleHealthCode.mockResolvedValue({
      access_token: "health-at",
      refresh_token: "health-rt",
      expires_in: 3600,
    });
    mockGetGoogleHealthIdentity.mockResolvedValue("health-uid-123");

    const response = await GET(makeCallbackRequest("health-code", healthState));
    expect(response.status).toBe(302);
    // Must redirect to /app, NOT to the external URL
    expect(response.headers.get("location")).toBe("http://localhost:3000/app");
    expect(response.headers.get("location")).not.toContain("evil.com");
  });

  it("health-connect: returns 400 when state userId does not match cookie session userId", async () => {
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect", userId: "initiating-user" });
    mockRawSession.oauthState = healthState;
    mockRawSession.sessionId = "existing-session-id";
    // Cookie session belongs to a different user than the one who initiated the health-connect
    mockGetSessionById.mockResolvedValue({ ...fakeDbSession, userId: "different-user" });

    const response = await GET(makeCallbackRequest("health-code", healthState));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("health-connect: binds tokens to the correct (initiating) user when state userId matches cookie session", async () => {
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect", userId: "user-uuid-123" });
    mockRawSession.oauthState = healthState;
    mockRawSession.sessionId = "existing-session-id";
    mockGetSessionById.mockResolvedValue(fakeDbSession); // userId = "user-uuid-123"
    mockExchangeGoogleHealthCode.mockResolvedValue({
      access_token: "health-at",
      refresh_token: "health-rt",
      expires_in: 3600,
    });
    mockGetGoogleHealthIdentity.mockResolvedValue("health-uid-123");

    const response = await GET(makeCallbackRequest("health-code", healthState));
    expect(response.status).toBe(302);
    expect(mockUpsertHealthTokens).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.anything(),
      expect.anything(),
    );
  });

  it("health-connect: rejects protocol-relative returnTo (//evil.com) and falls back to /app", async () => {
    // Protocol-relative URLs start with "/" but also with "//" — both checks are needed.
    const healthState = JSON.stringify({ nonce: "abc", flow: "health-connect", returnTo: "//evil.com/steal" });
    mockRawSession.oauthState = healthState;
    mockRawSession.sessionId = "existing-session-id";
    mockGetSessionById.mockResolvedValue(fakeDbSession);
    mockExchangeGoogleHealthCode.mockResolvedValue({
      access_token: "health-at",
      refresh_token: "health-rt",
      expires_in: 3600,
    });
    mockGetGoogleHealthIdentity.mockResolvedValue("health-uid-123");

    const response = await GET(makeCallbackRequest("health-code", healthState));
    expect(response.status).toBe(302);
    // Must redirect to /app, NOT to the protocol-relative external URL
    expect(response.headers.get("location")).toBe("http://localhost:3000/app");
    expect(response.headers.get("location")).not.toContain("evil.com");
  });
});
