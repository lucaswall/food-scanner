import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
vi.stubEnv("ALLOWED_EMAILS", "test@example.com");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

// Mock session module — getRawSession returns mutable iron-session object
const mockRawSession = {
  save: vi.fn(),
} as Record<string, unknown>;

vi.mock("@/lib/session", () => ({
  getRawSession: vi.fn().mockResolvedValue(mockRawSession),
}));

// Mock rate limiter
const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
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

const { POST } = await import("@/app/api/auth/google/route");
const { logger } = await import("@/lib/logger");

function makeRequest() {
  return new Request("http://localhost:3000/api/auth/google", {
    method: "POST",
    headers: { "x-forwarded-for": "1.2.3.4" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://localhost:3000");
  Object.keys(mockRawSession).forEach((key) => {
    if (key !== "save") delete mockRawSession[key];
  });
  mockRawSession.save = vi.fn();
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
});

describe("POST /api/auth/google", () => {
  it("returns a redirect to Google OAuth URL", async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    expect(location).toContain("accounts.google.com");
    expect(location).toContain("client_id=test-google-client-id");
  });

  it("includes a state parameter in the redirect URL", async () => {
    const response = await POST(makeRequest());
    const location = response.headers.get("location")!;
    const url = new URL(location);
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("uses APP_URL for redirect URI", async () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    const response = await POST(makeRequest());
    const location = response.headers.get("location")!;
    expect(location).toContain(
      encodeURIComponent("https://food.lucaswall.me/api/auth/google/callback"),
    );
  });

  it("stores OAuth state in iron-session, not a plain cookie", async () => {
    const response = await POST(makeRequest());

    // State should be stored in session
    expect(mockRawSession.oauthState).toBeTruthy();
    expect(mockRawSession.save).toHaveBeenCalled();

    // Should NOT set a plain google-oauth-state cookie
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toBeNull();
  });

  it("logs info on OAuth initiation", async () => {
    await POST(makeRequest());
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "google_oauth_start" }),
      expect.any(String),
    );
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const response = await POST(makeRequest());
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("encodes returnTo in OAuth state when provided", async () => {
    const req = new Request("http://localhost:3000/api/auth/google?returnTo=/app/log-shared/abc", {
      method: "POST",
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    await POST(req);

    const storedState = mockRawSession.oauthState as string;
    expect(() => JSON.parse(storedState)).not.toThrow();
    const stateData = JSON.parse(storedState);
    expect(stateData.returnTo).toBe("/app/log-shared/abc");
  });

  it("does not include returnTo in state when not provided", async () => {
    const response = await POST(makeRequest());

    const storedState = mockRawSession.oauthState as string;
    // State may or may not be JSON - if JSON, returnTo should not be set
    let stateData: unknown;
    try {
      stateData = JSON.parse(storedState);
    } catch {
      // Plain string is fine too
      stateData = null;
    }
    if (stateData && typeof stateData === "object") {
      expect((stateData as Record<string, unknown>).returnTo).toBeFalsy();
    }
    expect(response.status).toBe(302);
  });
});
