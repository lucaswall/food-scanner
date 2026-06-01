import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
vi.stubEnv("ALLOWED_EMAILS", "test@example.com");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const { buildGoogleAuthUrl, exchangeGoogleCode, getGoogleProfile, buildGoogleHealthAuthUrl, getGoogleHealthIdentity, GOOGLE_HEALTH_SCOPES, exchangeGoogleHealthCode } =
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
  it("aborts after timeout", { timeout: 20000 }, async () => {
    vi.useFakeTimers();

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: string | URL | Request, opts?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = opts?.signal;
          if (signal) {
            signal.onabort = () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            };
          }
        });
      }
    );

    const promise = exchangeGoogleCode("code", "http://localhost:3000/callback");
    const expectation = expect(promise).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(10000);
    await expectation;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

  it("throws when response is missing access_token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token_type: "Bearer" }), { status: 200 }),
    );

    await expect(
      exchangeGoogleCode("code", "http://localhost:3000/callback"),
    ).rejects.toThrow("Invalid Google token response: missing access_token");

    vi.restoreAllMocks();
  });

  it("throws when json parsing hangs", { timeout: 20000 }, async () => {
    vi.useFakeTimers();

    // Return a response whose .json() never resolves
    const neverResolve = new Promise<string>(() => {});
    const mockResponse = new Response(null, { status: 200 });
    vi.spyOn(mockResponse, "json").mockReturnValue(neverResolve);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const promise = exchangeGoogleCode("code", "http://localhost:3000/callback");
    const expectation = expect(promise).rejects.toThrow("Response body read timed out");

    await vi.advanceTimersByTimeAsync(10000);
    await expectation;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("POSTs grant_type, client_id, client_secret, and redirect_uri", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "token" }), { status: 200 }),
    );

    await exchangeGoogleCode("my-auth-code", "https://app.example.com/cb");

    const body = String((fetchSpy.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("client_id=");
    expect(body).toContain("client_secret=");
    expect(body).toContain("redirect_uri=https%3A%2F%2Fapp.example.com%2Fcb");

    vi.restoreAllMocks();
  });

  it("returns refresh_token, expires_in, and scope when the token endpoint provides them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "google-access-token",
          refresh_token: "google-refresh-token",
          expires_in: 3599,
          scope: "openid email https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
        }),
        { status: 200 },
      ),
    );

    const result = await exchangeGoogleCode("auth-code", "http://localhost:3000/callback");

    expect(result.access_token).toBe("google-access-token");
    expect(result.refresh_token).toBe("google-refresh-token");
    expect(result.expires_in).toBe(3599);
    expect(result.scope).toBe(
      "openid email https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
    );

    vi.restoreAllMocks();
  });

  it("leaves refresh_token/expires_in/scope undefined when omitted by the endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "only-access" }), { status: 200 }),
    );

    const result = await exchangeGoogleCode("auth-code", "http://localhost:3000/callback");

    expect(result.access_token).toBe("only-access");
    expect(result.refresh_token).toBeUndefined();
    expect(result.expires_in).toBeUndefined();
    expect(result.scope).toBeUndefined();

    vi.restoreAllMocks();
  });
});

describe("getGoogleProfile", () => {
  it("aborts after timeout", { timeout: 20000 }, async () => {
    vi.useFakeTimers();

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: string | URL | Request, opts?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = opts?.signal;
          if (signal) {
            signal.onabort = () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            };
          }
        });
      }
    );

    const promise = getGoogleProfile("test-token");
    const expectation = expect(promise).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(10000);
    await expectation;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

  it("throws when response is missing email", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ name: "Test User" }), { status: 200 }),
    );

    await expect(getGoogleProfile("test-token")).rejects.toThrow(
      "Invalid Google profile response: missing email",
    );

    vi.restoreAllMocks();
  });

  it("throws when response is missing name", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ email: "test@example.com" }), { status: 200 }),
    );

    await expect(getGoogleProfile("test-token")).rejects.toThrow(
      "Invalid Google profile response: missing name",
    );

    vi.restoreAllMocks();
  });

  it("truncates error body to 500 chars in log", async () => {
    const longBody = "x".repeat(1000);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(longBody, { status: 500 }),
    );

    await expect(getGoogleProfile("test-token")).rejects.toThrow();

    const errorCall = vi.mocked(logger.error).mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).action === "google_profile_fetch_failed",
    );
    expect(errorCall).toBeDefined();
    const errorBody = (errorCall![0] as Record<string, unknown>).errorBody as string;
    expect(errorBody.length).toBeLessThanOrEqual(500);

    vi.restoreAllMocks();
  });

  it("throws when json parsing hangs", { timeout: 20000 }, async () => {
    vi.useFakeTimers();

    // Return a response whose .json() never resolves
    const neverResolve = new Promise<string>(() => {});
    const mockResponse = new Response(null, { status: 200 });
    vi.spyOn(mockResponse, "json").mockReturnValue(neverResolve);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockResponse);

    const promise = getGoogleProfile("test-token");
    const expectation = expect(promise).rejects.toThrow("Response body read timed out");

    await vi.advanceTimersByTimeAsync(10000);
    await expectation;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("strips HTML tags from error body in log", async () => {
    const htmlBody = '<html><body><h1>Error</h1><p>Something went wrong</p></body></html>';
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(htmlBody, { status: 500 }),
    );

    await expect(getGoogleProfile("test-token")).rejects.toThrow();

    const errorCall = vi.mocked(logger.error).mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).action === "google_profile_fetch_failed",
    );
    expect(errorCall).toBeDefined();
    const errorBody = (errorCall![0] as Record<string, unknown>).errorBody as string;
    expect(errorBody).not.toContain("<html>");
    expect(errorBody).not.toContain("<body>");
    expect(errorBody).not.toContain("<h1>");
    expect(errorBody).toContain("Error");
    expect(errorBody).toContain("Something went wrong");

    vi.restoreAllMocks();
  });

  it("returns emailVerified: true when email_verified is boolean true", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ email: "test@example.com", name: "Test User", email_verified: true }), { status: 200 }),
    );

    const result = await getGoogleProfile("test-token");
    expect(result.emailVerified).toBe(true);

    vi.restoreAllMocks();
  });

  it("returns emailVerified: true when email_verified is string 'true'", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ email: "test@example.com", name: "Test User", email_verified: "true" }), { status: 200 }),
    );

    const result = await getGoogleProfile("test-token");
    expect(result.emailVerified).toBe(true);

    vi.restoreAllMocks();
  });

  it("returns emailVerified: false when email_verified is boolean false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ email: "test@example.com", name: "Test User", email_verified: false }), { status: 200 }),
    );

    const result = await getGoogleProfile("test-token");
    expect(result.emailVerified).toBe(false);

    vi.restoreAllMocks();
  });

  it("returns emailVerified: false when email_verified is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ email: "test@example.com", name: "Test User" }), { status: 200 }),
    );

    const result = await getGoogleProfile("test-token");
    expect(result.emailVerified).toBe(false);

    vi.restoreAllMocks();
  });
});

describe("buildGoogleHealthAuthUrl", () => {
  it("returns URL pointing to Google OAuth accounts endpoint", () => {
    const url = new URL(buildGoogleHealthAuthUrl("test-state", "http://localhost:3000/api/auth/google/callback"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
  });

  it("includes GOOGLE_CLIENT_ID", () => {
    const url = new URL(buildGoogleHealthAuthUrl("test-state", "http://localhost:3000/api/auth/google/callback"));
    expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
  });

  it("sets access_type=offline and prompt=consent", () => {
    const url = new URL(buildGoogleHealthAuthUrl("test-state", "http://localhost:3000/api/auth/google/callback"));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("scope contains all 4 googlehealth.* full URLs", () => {
    const url = new URL(buildGoogleHealthAuthUrl("test-state", "http://localhost:3000/api/auth/google/callback"));
    const scope = url.searchParams.get("scope")!;
    expect(scope).toContain("https://www.googleapis.com/auth/googlehealth.nutrition.writeonly");
    expect(scope).toContain("https://www.googleapis.com/auth/googlehealth.profile.readonly");
    expect(scope).toContain("https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly");
    expect(scope).toContain("https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly");
  });

  it("GOOGLE_HEALTH_SCOPES has length 4", () => {
    expect(GOOGLE_HEALTH_SCOPES).toHaveLength(4);
  });

  it("includes state parameter", () => {
    const url = new URL(buildGoogleHealthAuthUrl("my-health-state", "http://localhost:3000/api/auth/google/callback"));
    expect(url.searchParams.get("state")).toBe("my-health-state");
  });
});

describe("getGoogleHealthIdentity", () => {
  it("calls health.googleapis.com identity endpoint with Bearer token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ userId: "health-user-id-123" }), { status: 200 }),
    );

    await getGoogleHealthIdentity("my-access-token");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://health.googleapis.com/v4/users/me/identity",
      expect.objectContaining({
        headers: { Authorization: "Bearer my-access-token" },
      }),
    );

    vi.restoreAllMocks();
  });

  it("returns the health user id string", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ userId: "health-user-id-123" }), { status: 200 }),
    );

    const result = await getGoogleHealthIdentity("access-token");
    expect(result).toBe("health-user-id-123");

    vi.restoreAllMocks();
  });

  it("throws and logs google_health_identity_fetch_failed on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await expect(getGoogleHealthIdentity("bad-token")).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "google_health_identity_fetch_failed", status: 403 }),
      expect.any(String),
    );

    vi.restoreAllMocks();
  });

  it("aborts after timeout", { timeout: 20000 }, async () => {
    vi.useFakeTimers();

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: string | URL | Request, opts?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = opts?.signal;
          if (signal) {
            signal.onabort = () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            };
          }
        });
      }
    );

    const promise = getGoogleHealthIdentity("test-token");
    const expectation = expect(promise).rejects.toThrow();

    await vi.advanceTimersByTimeAsync(10000);
    await expectation;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("exchangeGoogleHealthCode", () => {
  it("POSTs to oauth2.googleapis.com/token", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt" }), { status: 200 }),
    );

    await exchangeGoogleHealthCode("auth-code", "http://localhost:3000/callback");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ method: "POST" }),
    );

    vi.restoreAllMocks();
  });

  it("returns access_token, refresh_token, expires_in, and scope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "profile" }),
        { status: 200 },
      ),
    );

    const result = await exchangeGoogleHealthCode("auth-code", "http://localhost:3000/callback");

    expect(result.access_token).toBe("at");
    expect(result.refresh_token).toBe("rt");
    expect(result.expires_in).toBe(3600);
    expect(result.scope).toBe("profile");

    vi.restoreAllMocks();
  });

  it("throws typed 'missing refresh_token' error when refresh_token is omitted", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at" }), { status: 200 }),
    );

    await expect(
      exchangeGoogleHealthCode("auth-code", "http://localhost:3000/callback"),
    ).rejects.toThrow("missing refresh_token");

    vi.restoreAllMocks();
  });
});
