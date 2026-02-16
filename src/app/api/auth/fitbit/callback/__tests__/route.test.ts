import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

// Mock fitbit module
vi.mock("@/lib/fitbit", () => ({
  buildFitbitAuthUrl: vi.fn(),
  exchangeFitbitCode: vi.fn(),
  refreshFitbitToken: vi.fn(),
  ensureFreshToken: vi.fn(),
}));

const mockGetFitbitCredentials = vi.fn();
vi.mock("@/lib/fitbit-credentials", () => ({
  getFitbitCredentials: (...args: unknown[]) => mockGetFitbitCredentials(...args),
}));

// Mock session module — getRawSession returns mutable iron-session object
const mockRawSession = {
  sessionId: "test-session",
  oauthState: "test-state",
  save: vi.fn(),
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
const mockGetSessionById = vi.fn();
vi.mock("@/lib/session-db", () => ({
  getSessionById: (...args: unknown[]) => mockGetSessionById(...args),
}));

// Mock fitbit-tokens
const mockUpsertFitbitTokens = vi.fn();
vi.mock("@/lib/fitbit-tokens", () => ({
  upsertFitbitTokens: (...args: unknown[]) => mockUpsertFitbitTokens(...args),
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

const { exchangeFitbitCode } = await import("@/lib/fitbit");
const { getRawSession } = await import("@/lib/session");
const { GET } = await import("@/app/api/auth/fitbit/callback/route");
const { logger } = await import("@/lib/logger");

const mockExchangeFitbitCode = vi.mocked(exchangeFitbitCode);
const mockGetRawSession = vi.mocked(getRawSession);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://localhost:3000");
  Object.keys(mockRawSession).forEach((key) => {
    if (key !== "save" && key !== "sessionId" && key !== "oauthState") delete mockRawSession[key];
  });
  mockRawSession.sessionId = "test-session";
  mockRawSession.oauthState = "test-state";
  mockRawSession.save = vi.fn();
  mockGetRawSession.mockResolvedValue(mockRawSession as never);
  mockGetSessionById.mockResolvedValue({
    id: "test-session",
    userId: "user-uuid-123",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 86400000),
  });
  mockUpsertFitbitTokens.mockResolvedValue(undefined);
  mockGetFitbitCredentials.mockResolvedValue({
    clientId: "test-fitbit-client-id",
    clientSecret: "test-fitbit-client-secret",
  });
});

function makeCallbackRequest(code: string | null, state: string | null) {
  const url = new URL("http://localhost:3000/api/auth/fitbit/callback");
  if (code) url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return new Request(url);
}

describe("GET /api/auth/fitbit/callback", () => {
  it("stores tokens in DB and redirects to /app on valid code", async () => {
    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "fitbit-access-token",
      refresh_token: "fitbit-refresh-token",
      user_id: "fitbit-user-123",
      expires_in: 28800,
    });

    const response = await GET(makeCallbackRequest("valid-fitbit-code", "test-state"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/app");
    expect(mockUpsertFitbitTokens).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.objectContaining({
        fitbitUserId: "fitbit-user-123",
        accessToken: "fitbit-access-token",
        refreshToken: "fitbit-refresh-token",
      }),
    );
  });

  it("reads OAuth state from iron-session, not plain cookie", async () => {
    mockRawSession.oauthState = "session-state";
    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "token",
      refresh_token: "refresh",
      user_id: "user1",
      expires_in: 28800,
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
    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "token",
      refresh_token: "refresh",
      user_id: "user1",
      expires_in: 28800,
    });

    await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(mockRawSession.oauthState).toBeUndefined();
    expect(mockRawSession.save).toHaveBeenCalled();
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
    const request = new Request(url);

    const response = await GET(request);

    expect(mockExchangeFitbitCode).toHaveBeenCalledWith(
      "valid-fitbit-code",
      "https://food.lucaswall.me/api/auth/fitbit/callback",
      expect.objectContaining({
        clientId: "test-fitbit-client-id",
        clientSecret: "test-fitbit-client-secret",
      }),
      expect.any(Object),
    );

    const location = response.headers.get("location")!;
    expect(location).toBe("https://food.lucaswall.me/app");
    expect(location).not.toContain("internal:8080");
  });

  it("returns error when code exchange fails", async () => {
    mockExchangeFitbitCode.mockRejectedValue(new Error("Invalid code"));

    const response = await GET(makeCallbackRequest("invalid-code", "test-state"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it("logs error when code exchange fails", async () => {
    mockExchangeFitbitCode.mockRejectedValue(new Error("Token exchange failed"));

    await GET(makeCallbackRequest("bad-code", "test-state"));

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "fitbit_token_exchange_error",
        error: "Token exchange failed",
      }),
      expect.any(String),
    );
  });

  it("returns 401 when no authenticated session exists", async () => {
    mockRawSession.sessionId = undefined;
    mockGetRawSession.mockResolvedValue(mockRawSession as never);

    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "token",
      refresh_token: "refresh",
      user_id: "user1",
      expires_in: 28800,
    });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 401 when DB session is expired", async () => {
    mockGetSessionById.mockResolvedValue(null);

    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "token",
      refresh_token: "refresh",
      user_id: "user1",
      expires_in: 28800,
    });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  // Logging tests
  it("logs warn on invalid OAuth state", async () => {
    await GET(makeCallbackRequest("code", "bad-state"));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fitbit_callback_invalid_state" }),
      expect.any(String),
    );
  });

  it("logs info on successful Fitbit connection", async () => {
    mockExchangeFitbitCode.mockResolvedValue({
      access_token: "token",
      refresh_token: "refresh",
      user_id: "user1",
      expires_in: 28800,
    });
    await GET(makeCallbackRequest("code", "test-state"));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fitbit_connect_success" }),
      expect.any(String),
    );
  });

  it("returns error when no credentials exist for user", async () => {
    mockGetFitbitCredentials.mockResolvedValue(null);

    const response = await GET(makeCallbackRequest("code", "test-state"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_CREDENTIALS_MISSING");
  });

  it("consumes OAuth state before token exchange", async () => {
    let stateAtExchangeTime: string | undefined;
    let saveCallCount = 0;

    // Capture state value and save call count when exchangeFitbitCode is called
    mockExchangeFitbitCode.mockImplementation(async () => {
      stateAtExchangeTime = mockRawSession.oauthState as string | undefined;
      saveCallCount = (mockRawSession.save as ReturnType<typeof vi.fn>).mock.calls.length;
      return {
        access_token: "fitbit-access-token",
        refresh_token: "fitbit-refresh-token",
        user_id: "fitbit-user-123",
        expires_in: 28800,
      };
    });

    const response = await GET(makeCallbackRequest("valid-code", "test-state"));
    expect(response.status).toBe(302);

    // State should already be undefined when token exchange happens
    expect(stateAtExchangeTime).toBeUndefined();

    // Save should have been called at least once before token exchange
    expect(saveCallCount).toBeGreaterThanOrEqual(1);
  });
});
