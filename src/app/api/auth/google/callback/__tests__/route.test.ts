import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "wall.lucas@gmail.com");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

// Mock the auth module
vi.mock("@/lib/auth", () => ({
  buildGoogleAuthUrl: vi.fn(),
  exchangeGoogleCode: vi.fn(),
  getGoogleProfile: vi.fn(),
}));

// Mock session module
const mockSession = {
  save: vi.fn(),
  destroy: vi.fn(),
} as Record<string, unknown>;

vi.mock("@/lib/session", () => ({
  getSession: vi.fn().mockResolvedValue(mockSession),
  sessionOptions: {
    password: "a-test-secret-that-is-at-least-32-characters-long",
    cookieName: "food-scanner-session",
    cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", maxAge: 2592000, path: "/" },
  },
}));

// Mock next/headers cookies()
const mockCookieStore = {
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
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
const { getSession } = await import("@/lib/session");
const { GET } = await import("@/app/api/auth/google/callback/route");
const { logger } = await import("@/lib/logger");

const mockExchangeGoogleCode = vi.mocked(exchangeGoogleCode);
const mockGetGoogleProfile = vi.mocked(getGoogleProfile);
const mockGetSession = vi.mocked(getSession);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://localhost:3000");
  Object.keys(mockSession).forEach((key) => {
    if (key !== "save" && key !== "destroy") delete mockSession[key];
  });
  mockSession.save = vi.fn();
  mockSession.destroy = vi.fn();
  mockGetSession.mockResolvedValue(mockSession as never);
});

function makeCallbackRequest(
  code: string | null,
  state: string | null,
  cookieState: string | null,
) {
  const url = new URL("http://localhost:3000/api/auth/google/callback");
  if (code) url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return new Request(url, {
    headers: {
      cookie: cookieState ? `google-oauth-state=${cookieState}` : "",
    },
  });
}

describe("GET /api/auth/google/callback", () => {
  it("creates session via getSession() and redirects on valid code + allowed email", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "wall.lucas@gmail.com",
      name: "Lucas Wall",
    });

    const response = await GET(makeCallbackRequest("valid-code", "test-state", "test-state"));
    expect(response.status).toBe(302);
    expect(mockGetSession).toHaveBeenCalled();
    expect(mockSession.save).toHaveBeenCalled();
    expect(mockSession.email).toBe("wall.lucas@gmail.com");
    expect(mockSession.sessionId).toBeDefined();
  });

  it("returns 403 for disallowed email", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "hacker@evil.com",
      name: "Hacker",
    });

    const response = await GET(makeCallbackRequest("valid-code", "test-state", "test-state"));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_INVALID_EMAIL");
  });

  it("uses APP_URL for redirect URI and post-login redirect, not request.url", async () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "wall.lucas@gmail.com",
      name: "Lucas Wall",
    });

    const url = new URL("http://internal:8080/api/auth/google/callback");
    url.searchParams.set("code", "valid-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url, {
      headers: { cookie: "google-oauth-state=test-state" },
    });

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

    const response = await GET(makeCallbackRequest("invalid-code", "test-state", "test-state"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it("clears the google-oauth-state cookie after successful auth", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "wall.lucas@gmail.com",
      name: "Lucas Wall",
    });

    await GET(makeCallbackRequest("valid-code", "test-state", "test-state"));
    expect(mockCookieStore.delete).toHaveBeenCalledWith("google-oauth-state");
  });

  it("redirects to /api/auth/fitbit when no fitbit tokens in session", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "wall.lucas@gmail.com",
      name: "Lucas Wall",
    });

    const response = await GET(makeCallbackRequest("valid-code", "test-state", "test-state"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/api/auth/fitbit",
    );
  });

  it("redirects to /app when fitbit tokens exist in session", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "wall.lucas@gmail.com",
      name: "Lucas Wall",
    });
    mockSession.fitbit = { accessToken: "existing" };

    const response = await GET(makeCallbackRequest("valid-code", "test-state", "test-state"));
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/app",
    );
  });

  // Logging tests
  it("logs warn on invalid OAuth state", async () => {
    await GET(makeCallbackRequest("code", "bad-state", "good-state"));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "google_callback_invalid_state" }),
      expect.any(String),
    );
  });

  it("logs warn on unauthorized email", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "token" });
    mockGetGoogleProfile.mockResolvedValue({ email: "bad@evil.com", name: "Bad" });
    await GET(makeCallbackRequest("code", "test-state", "test-state"));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "google_unauthorized_email",
        email: "bad@evil.com",
      }),
      expect.any(String),
    );
  });

  it("logs info on successful login", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "wall.lucas@gmail.com",
      name: "Lucas Wall",
    });
    await GET(makeCallbackRequest("code", "test-state", "test-state"));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "google_login_success",
        email: "wall.lucas@gmail.com",
      }),
      expect.any(String),
    );
  });
});
