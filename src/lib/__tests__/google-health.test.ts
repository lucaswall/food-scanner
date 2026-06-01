import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Logger } from "@/lib/logger";

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");

// ─── Logger mock ─────────────────────────────────────────────────────────────

const warnMock = vi.fn();
const debugMock = vi.fn();
const infoMock = vi.fn();
const errorMock = vi.fn();

vi.mock("@/lib/logger", () => ({
  logger: {
    info: infoMock,
    warn: warnMock,
    error: errorMock,
    debug: debugMock,
    child: vi.fn(),
  },
  startTimer: () => () => 42,
}));

// ─── Sentry mock ─────────────────────────────────────────────────────────────

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
}));

// ─── health-tokens mock ───────────────────────────────────────────────────────

const getHealthTokensMock = vi.fn();
const upsertHealthTokensMock = vi.fn();

vi.mock("@/lib/health-tokens", () => ({
  getHealthTokens: (...args: unknown[]) => getHealthTokensMock(...args),
  upsertHealthTokens: (...args: unknown[]) => upsertHealthTokensMock(...args),
}));

// ─── google-health-rate-limit mock ───────────────────────────────────────────

const assertRateLimitAllowedMock = vi.fn();
const recordRateLimitHeadersMock = vi.fn();
const getRateLimitSnapshotMock = vi.fn().mockReturnValue(null);

vi.mock("@/lib/google-health-rate-limit", () => ({
  assertRateLimitAllowed: (...args: unknown[]) => assertRateLimitAllowedMock(...args),
  recordRateLimitHeaders: (...args: unknown[]) => recordRateLimitHeadersMock(...args),
  getRateLimitSnapshot: (...args: unknown[]) => getRateLimitSnapshotMock(...args),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fakeLog: Logger = {
  warn: warnMock,
  debug: debugMock,
  info: infoMock,
  error: errorMock,
} as unknown as Logger;

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// A token row that is well within the 1-hour skew window (30 min to expiry = near-expired)
function makeNearExpiredRow(userId = "user-a") {
  return {
    id: 1,
    userId,
    healthUserId: "gh-123",
    accessToken: "current-access",
    refreshToken: "my-refresh-token",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min → within 1h skew
    scope: "fitness.nutrition.write",
    updatedAt: new Date(),
  };
}

// A token row that is fresh (24h to expiry, well outside 1-hour skew)
function makeFreshRow(userId = "user-a") {
  return {
    ...makeNearExpiredRow(userId),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    accessToken: "fresh-access-token",
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("google-health", () => {
  let fetchWithRetry: typeof import("@/lib/google-health").fetchWithRetry;
  let refreshGoogleHealthToken: typeof import("@/lib/google-health").refreshGoogleHealthToken;
  let ensureFreshToken: typeof import("@/lib/google-health").ensureFreshToken;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    // Restore default return value after clearAllMocks
    getRateLimitSnapshotMock.mockReturnValue(null);
    upsertHealthTokensMock.mockResolvedValue(undefined);
    const mod = await import("@/lib/google-health");
    fetchWithRetry = mod.fetchWithRetry;
    refreshGoogleHealthToken = mod.refreshGoogleHealthToken;
    ensureFreshToken = mod.ensureFreshToken;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── fetchWithRetry ─────────────────────────────────────────────────────────

  describe("fetchWithRetry", () => {
    it("throws HEALTH_TOKEN_INVALID on 401", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
      await expect(
        fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog),
      ).rejects.toThrow("HEALTH_TOKEN_INVALID");
    });

    it("throws HEALTH_SCOPE_MISSING on 403", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
      await expect(
        fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog),
      ).rejects.toThrow("HEALTH_SCOPE_MISSING");
    });

    it("retries on 429 and succeeds on subsequent 200", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const promise = fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog);
      await vi.advanceTimersByTimeAsync(2000);
      const result = await promise;

      expect(result.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws HEALTH_RATE_LIMIT after two consecutive 429s", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 429 }));

      const promise = fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog);
      const rejection = expect(promise).rejects.toThrow("HEALTH_RATE_LIMIT");
      await vi.advanceTimersByTimeAsync(2000);
      await rejection;
    });

    it("throws HEALTH_TIMEOUT when the overall deadline is exceeded", async () => {
      // startTime 31 seconds in the past → elapsed > DEADLINE_MS (30s)
      const pastStart = Date.now() - 31_000;
      await expect(
        fetchWithRetry("https://example.com", {}, 0, pastStart, fakeLog),
      ).rejects.toThrow("HEALTH_TIMEOUT");
      // fetch should not have been called — deadline check fires first
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("records rate-limit headers on every response (including 429)", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
      await fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog, "user-a");
      expect(recordRateLimitHeadersMock).toHaveBeenCalledWith(
        "user-a",
        expect.any(Response),
        fakeLog,
      );
    });

    it("only calls assertRateLimitAllowed on the first attempt (retryCount === 0)", async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 429 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 }));

      const promise = fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog, "user-a", "optional");
      await vi.advanceTimersByTimeAsync(2000);
      await promise;

      // assertRateLimitAllowed should only be called once (on first attempt)
      expect(assertRateLimitAllowedMock).toHaveBeenCalledTimes(1);
    });

    it("propagates rate-limit breaker rejection from assertRateLimitAllowed", async () => {
      assertRateLimitAllowedMock.mockImplementationOnce(() => {
        throw new Error("HEALTH_RATE_LIMIT_LOW");
      });

      await expect(
        fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog, "user-a", "optional"),
      ).rejects.toThrow("HEALTH_RATE_LIMIT_LOW");

      // No actual fetch should happen — breaker fires before the request
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ─── refreshGoogleHealthToken ────────────────────────────────────────────────

  describe("refreshGoogleHealthToken", () => {
    it("returns new access_token while NOT returning a new refresh token (Google preserves it)", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        access_token: "new-access-token",
        expires_in: 3600,
      }));

      const result = await refreshGoogleHealthToken("my-refresh-token", fakeLog);

      expect(result.access_token).toBe("new-access-token");
      expect(result.expires_in).toBe(3600);
      // Google does NOT rotate refresh tokens — result must NOT include refresh_token
      expect(Object.keys(result)).not.toContain("refresh_token");

      // Verify the request body included the input refresh token
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = new URLSearchParams(init.body as string);
      expect(body.get("refresh_token")).toBe("my-refresh-token");
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("client_id")).toBe("test-client-id");
      expect(body.get("client_secret")).toBe("test-client-secret");
    });

    it("posts to the Google token endpoint", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        access_token: "token",
        expires_in: 3600,
      }));

      await refreshGoogleHealthToken("refresh", fakeLog);

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://oauth2.googleapis.com/token");
    });

    it("throws HEALTH_TOKEN_INVALID on 400", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
      await expect(
        refreshGoogleHealthToken("old-refresh", fakeLog),
      ).rejects.toThrow("HEALTH_TOKEN_INVALID");
    });

    it("throws HEALTH_TOKEN_INVALID on 401", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
      await expect(
        refreshGoogleHealthToken("old-refresh", fakeLog),
      ).rejects.toThrow("HEALTH_TOKEN_INVALID");
    });

    it("throws HEALTH_REFRESH_TRANSIENT on 5xx", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
      await expect(
        refreshGoogleHealthToken("old-refresh", fakeLog),
      ).rejects.toThrow("HEALTH_REFRESH_TRANSIENT");
    });
  });

  // ─── ensureFreshToken ────────────────────────────────────────────────────────

  describe("ensureFreshToken", () => {
    it("returns current access token when token is still fresh", async () => {
      getHealthTokensMock.mockResolvedValue(makeFreshRow());

      const result = await ensureFreshToken("user-a", fakeLog);
      expect(result).toBe("fresh-access-token");
      // No refresh should have been attempted
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("throws HEALTH_TOKEN_INVALID when no token row exists", async () => {
      getHealthTokensMock.mockResolvedValue(null);
      await expect(ensureFreshToken("user-a", fakeLog)).rejects.toThrow("HEALTH_TOKEN_INVALID");
    });

    it("calls refreshGoogleHealthToken when token is near-expired and stores new tokens", async () => {
      getHealthTokensMock.mockResolvedValue(makeNearExpiredRow());
      fetchMock.mockResolvedValue(makeJsonResponse({
        access_token: "refreshed-token",
        expires_in: 3600,
      }));

      const result = await ensureFreshToken("user-a", fakeLog);

      expect(result).toBe("refreshed-token");
      // Token endpoint called once
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://oauth2.googleapis.com/token");

      // Stored with preserved refresh token (Google does not rotate)
      expect(upsertHealthTokensMock).toHaveBeenCalledWith(
        "user-a",
        expect.objectContaining({
          refreshToken: "my-refresh-token",
          accessToken: "refreshed-token",
        }),
        fakeLog,
      );
    });

    it("preserves the existing refresh token after a successful refresh", async () => {
      getHealthTokensMock.mockResolvedValue(makeNearExpiredRow());
      fetchMock.mockResolvedValue(makeJsonResponse({
        access_token: "new-access",
        expires_in: 3600,
        // Google does not include a refresh_token in the response
      }));

      await ensureFreshToken("user-a", fakeLog);

      const upsertArg = upsertHealthTokensMock.mock.calls[0][1] as Record<string, unknown>;
      expect(upsertArg.refreshToken).toBe("my-refresh-token");
    });

    it("throws HEALTH_TOKEN_SAVE_FAILED when upsert fails twice", async () => {
      getHealthTokensMock.mockResolvedValue(makeNearExpiredRow());
      fetchMock.mockResolvedValue(makeJsonResponse({
        access_token: "new-token",
        expires_in: 3600,
      }));
      upsertHealthTokensMock.mockRejectedValue(new Error("DB connection lost"));

      await expect(ensureFreshToken("user-a", fakeLog)).rejects.toThrow("HEALTH_TOKEN_SAVE_FAILED");
      // Upsert should have been retried once
      expect(upsertHealthTokensMock).toHaveBeenCalledTimes(2);
    });

    // CONCURRENCY TEST: fire ~5 concurrent ensureFreshToken calls on a near-expired row
    // and assert that refreshGoogleHealthToken (fetch to token endpoint) runs EXACTLY ONCE,
    // with all promises resolving to the same fresh token.
    it("deduplicates concurrent refresh calls — token endpoint hit exactly once", async () => {
      const nearExpiredRow = makeNearExpiredRow();

      // All getHealthTokens calls return the same near-expired row
      getHealthTokensMock.mockResolvedValue(nearExpiredRow);

      // Token endpoint returns fresh token
      fetchMock.mockResolvedValue(makeJsonResponse({
        access_token: "fresh-token",
        expires_in: 3600,
      }));

      // Fire 5 concurrent calls WITHOUT awaiting individually — collect promises first
      const promises = [0, 1, 2, 3, 4].map(() => ensureFreshToken("user-a", fakeLog));

      // Now await all — if dedup works, only one refresh should fire
      const results = await Promise.all(promises);

      // Token endpoint (google oauth) called exactly once
      const tokenEndpointCalls = fetchMock.mock.calls.filter(
        ([url]) => url === "https://oauth2.googleapis.com/token",
      );
      expect(tokenEndpointCalls).toHaveLength(1);

      // All 5 promises resolved to the same fresh token
      expect(results).toEqual([
        "fresh-token",
        "fresh-token",
        "fresh-token",
        "fresh-token",
        "fresh-token",
      ]);
    });
  });
});
