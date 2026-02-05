import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "wall.lucas@gmail.com");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const { buildGoogleAuthUrl, exchangeGoogleCode, getGoogleProfile } =
  await import("@/lib/auth");
const { logger } = await import("@/lib/logger");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildGoogleAuthUrl", () => {
  it("returns a URL pointing to Google OAuth", () => {
    const url = new URL(
      buildGoogleAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/google/callback",
      ),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
  });

  it("includes correct client_id", () => {
    const url = new URL(
      buildGoogleAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/google/callback",
      ),
    );
    expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
  });

  it("includes redirect_uri", () => {
    const url = new URL(
      buildGoogleAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/google/callback",
      ),
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/google/callback",
    );
  });

  it("requests email and profile scopes", () => {
    const url = new URL(
      buildGoogleAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/google/callback",
      ),
    );
    const scope = url.searchParams.get("scope")!;
    expect(scope).toContain("email");
    expect(scope).toContain("profile");
  });

  it("uses response_type=code", () => {
    const url = new URL(
      buildGoogleAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/google/callback",
      ),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("includes state parameter for CSRF protection", () => {
    const url = new URL(
      buildGoogleAuthUrl(
        "my-csrf-state",
        "http://localhost:3000/api/auth/google/callback",
      ),
    );
    expect(url.searchParams.get("state")).toBe("my-csrf-state");
  });
});

describe("exchangeGoogleCode", () => {
  it("logs error on token exchange HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 400 }),
    );

    await expect(
      exchangeGoogleCode("bad-code", "http://localhost:3000/callback"),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "google_token_exchange_failed",
        status: 400,
      }),
      expect.any(String),
    );

    vi.restoreAllMocks();
  });
});

describe("getGoogleProfile", () => {
  it("calls the v3 userinfo endpoint", async () => {
    const mockProfile = { email: "test@example.com", name: "Test User" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockProfile), { status: 200 }),
    );

    await getGoogleProfile("test-token");

    expect(fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      expect.objectContaining({
        headers: { Authorization: "Bearer test-token" },
      }),
    );

    vi.restoreAllMocks();
  });

  it("logs error on profile fetch HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await expect(getGoogleProfile("bad-token")).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "google_profile_fetch_failed",
        status: 403,
      }),
      expect.any(String),
    );

    vi.restoreAllMocks();
  });
});
