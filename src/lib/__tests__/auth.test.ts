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
});
