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

// Mock iron-session's getIronSession
vi.mock("iron-session", () => ({
  getIronSession: vi.fn().mockResolvedValue({
    save: vi.fn(),
    destroy: vi.fn(),
  }),
}));

const { exchangeGoogleCode, getGoogleProfile } = await import("@/lib/auth");
const { getIronSession } = await import("iron-session");
const { GET } = await import("@/app/api/auth/google/callback/route");

const mockExchangeGoogleCode = vi.mocked(exchangeGoogleCode);
const mockGetGoogleProfile = vi.mocked(getGoogleProfile);
const mockGetIronSession = vi.mocked(getIronSession);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetIronSession.mockResolvedValue({
    save: vi.fn(),
    destroy: vi.fn(),
  } as never);
});

describe("GET /api/auth/google/callback", () => {
  it("creates session and redirects on valid code + allowed email", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "wall.lucas@gmail.com",
      name: "Lucas Wall",
    });

    const session = { save: vi.fn() } as Record<string, unknown>;
    mockGetIronSession.mockResolvedValue(session as never);

    const url = new URL("http://localhost:3000/api/auth/google/callback");
    url.searchParams.set("code", "valid-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url, {
      headers: {
        cookie: "google-oauth-state=test-state",
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(302);
    expect(session.save).toHaveBeenCalled();
    expect(session.email).toBe("wall.lucas@gmail.com");
  });

  it("returns 403 for disallowed email", async () => {
    mockExchangeGoogleCode.mockResolvedValue({ access_token: "google-token" });
    mockGetGoogleProfile.mockResolvedValue({
      email: "hacker@evil.com",
      name: "Hacker",
    });

    const url = new URL("http://localhost:3000/api/auth/google/callback");
    url.searchParams.set("code", "valid-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url, {
      headers: {
        cookie: "google-oauth-state=test-state",
      },
    });

    const response = await GET(request);
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

    const session = { save: vi.fn() } as Record<string, unknown>;
    mockGetIronSession.mockResolvedValue(session as never);

    const url = new URL("http://internal:8080/api/auth/google/callback");
    url.searchParams.set("code", "valid-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url, {
      headers: { cookie: "google-oauth-state=test-state" },
    });

    const response = await GET(request);

    // Verify redirect URI passed to exchangeGoogleCode uses APP_URL
    expect(mockExchangeGoogleCode).toHaveBeenCalledWith(
      "valid-code",
      "https://food.lucaswall.me/api/auth/google/callback",
    );

    // Verify post-login redirect uses APP_URL
    const location = response.headers.get("location")!;
    expect(location).toContain("https://food.lucaswall.me/");
    expect(location).not.toContain("internal:8080");
  });

  it("returns error when code exchange fails", async () => {
    mockExchangeGoogleCode.mockRejectedValue(new Error("Invalid code"));

    const url = new URL("http://localhost:3000/api/auth/google/callback");
    url.searchParams.set("code", "invalid-code");
    url.searchParams.set("state", "test-state");
    const request = new Request(url, {
      headers: {
        cookie: "google-oauth-state=test-state",
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });
});
