import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
  startTimer: () => () => 42,
}));

vi.mock("@sentry/nextjs", () => ({
  addBreadcrumb: vi.fn(),
}));

const mockRecordRateLimitHeaders = vi.fn();
const mockGetRateLimitSnapshot = vi.fn().mockReturnValue(null);
const mockAssertRateLimitAllowed = vi.fn();
vi.mock("@/lib/fitbit-rate-limit", () => ({
  recordRateLimitHeaders: (...args: unknown[]) => mockRecordRateLimitHeaders(...args),
  getRateLimitSnapshot: (...args: unknown[]) => mockGetRateLimitSnapshot(...args),
  assertRateLimitAllowed: (...args: unknown[]) => mockAssertRateLimitAllowed(...args),
}));

const mockGetFitbitTokens = vi.fn();
const mockUpsertFitbitTokens = vi.fn();
vi.mock("@/lib/fitbit-tokens", () => ({
  getFitbitTokens: (...args: unknown[]) => mockGetFitbitTokens(...args),
  upsertFitbitTokens: (...args: unknown[]) => mockUpsertFitbitTokens(...args),
}));

const mockGetFitbitCredentials = vi.fn();
vi.mock("@/lib/fitbit-credentials", () => ({
  getFitbitCredentials: (...args: unknown[]) => mockGetFitbitCredentials(...args),
}));

const {
  buildFitbitAuthUrl,
  exchangeFitbitCode,
  refreshFitbitToken,
  ensureFreshToken,
  createFood,
  logFood,
  findOrCreateFood,
  deleteFoodLog,
  getFoodGoals,
  getActivitySummary,
  getFitbitProfile,
  getFitbitLatestWeightKg,
  getFitbitWeightGoal,
} = await import("@/lib/fitbit");
const { logger } = await import("@/lib/logger");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildFitbitAuthUrl", () => {
  it("returns a URL pointing to Fitbit OAuth", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "test-fitbit-client-id",
      ),
    );
    expect(url.origin).toBe("https://www.fitbit.com");
    expect(url.pathname).toBe("/oauth2/authorize");
  });

  it("uses provided client_id parameter", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "custom-client-id-123",
      ),
    );
    expect(url.searchParams.get("client_id")).toBe("custom-client-id-123");
  });

  it("includes redirect_uri", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "test-client-id",
      ),
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/fitbit/callback",
    );
  });

  it("requests nutrition and activity scopes", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "test-client-id",
      ),
    );
    const scope = url.searchParams.get("scope");
    expect(scope).toContain("nutrition");
    expect(scope).toContain("activity");
  });

  it("includes activity in scope parameter", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "test-client-id",
      ),
    );
    expect(url.searchParams.get("scope")).toContain("activity");
  });

  it("includes profile and weight in scope parameter", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "test-client-id",
      ),
    );
    const scope = url.searchParams.get("scope");
    expect(scope).toContain("profile");
    expect(scope).toContain("weight");
  });

  it("does not include prompt=consent by default", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "test-client-id",
      ),
    );
    expect(url.searchParams.get("prompt")).toBeNull();
  });

  it("adds prompt=consent when forceConsent is true", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "test-client-id",
        { forceConsent: true },
      ),
    );
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("does not add prompt=consent when forceConsent is false", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "test-client-id",
        { forceConsent: false },
      ),
    );
    expect(url.searchParams.get("prompt")).toBeNull();
  });

  it("uses response_type=code", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "test-client-id",
      ),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("includes state parameter", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "my-state",
        "http://localhost:3000/api/auth/fitbit/callback",
        "test-client-id",
      ),
    );
    expect(url.searchParams.get("state")).toBe("my-state");
  });
});

describe("ensureFreshToken", () => {
  it("returns existing token if not expiring within 1 hour", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    mockGetFitbitTokens.mockResolvedValue({
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      fitbitUserId: "user-123",
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    const token = await ensureFreshToken("user-uuid-123");
    expect(token).toBe("valid-token");
  });

  it("throws FITBIT_CREDENTIALS_MISSING if no fitbit credentials exist", async () => {
    mockGetFitbitCredentials.mockResolvedValue(null);

    await expect(ensureFreshToken("user-uuid-123")).rejects.toThrow(
      "FITBIT_CREDENTIALS_MISSING",
    );
  });

  it("throws FITBIT_TOKEN_INVALID if no fitbit tokens exist", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    mockGetFitbitTokens.mockResolvedValue(null);

    await expect(ensureFreshToken("user-uuid-123")).rejects.toThrow(
      "FITBIT_TOKEN_INVALID",
    );
  });

  it("upserts tokens in DB after refreshing", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: "new-token",
        refresh_token: "new-refresh",
        user_id: "user-123",
        expires_in: 28800,
      })),
    );

    mockGetFitbitTokens.mockResolvedValue({
      accessToken: "old-token",
      refreshToken: "old-refresh",
      fitbitUserId: "user-123",
      expiresAt: new Date(Date.now() - 1000), // already expired
    });
    mockUpsertFitbitTokens.mockResolvedValue(undefined);

    const token = await ensureFreshToken("user-uuid-123");
    expect(token).toBe("new-token");
    expect(mockUpsertFitbitTokens).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.objectContaining({
        accessToken: "new-token",
        refreshToken: "new-refresh",
        fitbitUserId: "user-123",
      }),
      expect.anything(),
    );

    vi.restoreAllMocks();
  });

  it("preserves the existing scope when refreshing tokens", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: "new-token",
        refresh_token: "new-refresh",
        user_id: "user-123",
        expires_in: 28800,
      })),
    );

    mockGetFitbitTokens.mockResolvedValue({
      accessToken: "old-token",
      refreshToken: "old-refresh",
      fitbitUserId: "user-123",
      expiresAt: new Date(Date.now() - 1000),
      scope: "nutrition activity profile weight",
    });
    mockUpsertFitbitTokens.mockResolvedValue(undefined);

    await ensureFreshToken("user-uuid-123");
    expect(mockUpsertFitbitTokens).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.objectContaining({
        scope: "nutrition activity profile weight",
      }),
      expect.anything(),
    );

    vi.restoreAllMocks();
  });

  it("does not upsert tokens when token is still fresh", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    mockGetFitbitTokens.mockResolvedValue({
      accessToken: "valid-token",
      refreshToken: "refresh-token",
      fitbitUserId: "user-123",
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    await ensureFreshToken("user-uuid-123");
    expect(mockUpsertFitbitTokens).not.toHaveBeenCalled();
  });

  it("two concurrent calls with expiring token only refresh once", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        access_token: "new-token",
        refresh_token: "new-refresh",
        user_id: "user-123",
        expires_in: 28800,
      })),
    );

    mockGetFitbitTokens.mockResolvedValue({
      accessToken: "old-token",
      refreshToken: "old-refresh",
      fitbitUserId: "user-123",
      expiresAt: new Date(Date.now() - 1000), // expired
    });
    mockUpsertFitbitTokens.mockResolvedValue(undefined);

    const [token1, token2] = await Promise.all([
      ensureFreshToken("user-uuid-123"),
      ensureFreshToken("user-uuid-123"),
    ]);

    expect(token1).toBe("new-token");
    expect(token2).toBe("new-token");
    // refreshFitbitToken should only be called once (1 fetch call for refresh)
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it("two different users refreshing concurrently get their own tokens", async () => {
    let fetchCallCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      fetchCallCount++;
      const userId = fetchCallCount === 1 ? "fitbit-user-A" : "fitbit-user-B";
      const token = fetchCallCount === 1 ? "token-for-user-A" : "token-for-user-B";
      return Promise.resolve(new Response(JSON.stringify({
        access_token: token,
        refresh_token: `refresh-${userId}`,
        user_id: userId,
        expires_in: 28800,
      })));
    });

    mockGetFitbitCredentials.mockImplementation((userId: string) => {
      if (userId === "user-A") {
        return Promise.resolve({
          clientId: "client-id-A",
          clientSecret: "secret-A",
        });
      }
      return Promise.resolve({
        clientId: "client-id-B",
        clientSecret: "secret-B",
      });
    });

    mockGetFitbitTokens.mockImplementation((userId: string) => {
      if (userId === "user-A") {
        return Promise.resolve({
          accessToken: "old-token-A",
          refreshToken: "old-refresh-A",
          fitbitUserId: "fitbit-user-A",
          expiresAt: new Date(Date.now() - 1000), // expired
        });
      }
      return Promise.resolve({
        accessToken: "old-token-B",
        refreshToken: "old-refresh-B",
        fitbitUserId: "fitbit-user-B",
        expiresAt: new Date(Date.now() - 1000), // expired
      });
    });
    mockUpsertFitbitTokens.mockResolvedValue(undefined);

    const [tokenA, tokenB] = await Promise.all([
      ensureFreshToken("user-A"),
      ensureFreshToken("user-B"),
    ]);

    // Each user must get their own token — NOT the other user's
    expect(tokenA).toBe("token-for-user-A");
    expect(tokenB).toBe("token-for-user-B");
    // Two separate refresh calls must happen (one per user)
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });

  it("second concurrent call receives same refreshed access token", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    let resolveRefresh: (value: Response) => void;
    const refreshPromise = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(() => refreshPromise);

    mockGetFitbitTokens.mockResolvedValue({
      accessToken: "old-token",
      refreshToken: "old-refresh",
      fitbitUserId: "user-123",
      expiresAt: new Date(Date.now() - 1000), // expired
    });
    mockUpsertFitbitTokens.mockResolvedValue(undefined);

    const promise1 = ensureFreshToken("user-uuid-123");
    const promise2 = ensureFreshToken("user-uuid-123");

    // Resolve the refresh after both calls are in-flight
    resolveRefresh!(new Response(JSON.stringify({
      access_token: "shared-new-token",
      refresh_token: "new-refresh",
      user_id: "user-123",
      expires_in: 28800,
    })));

    const [token1, token2] = await Promise.all([promise1, promise2]);
    expect(token1).toBe("shared-new-token");
    expect(token2).toBe("shared-new-token");

    vi.restoreAllMocks();
  });

  it("retries upsertFitbitTokens once on failure (FOO-430)", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: "new-token",
        refresh_token: "new-refresh",
        user_id: "user-123",
        expires_in: 28800,
      })),
    );

    mockGetFitbitTokens.mockResolvedValue({
      accessToken: "old-token",
      refreshToken: "old-refresh",
      fitbitUserId: "user-123",
      expiresAt: new Date(Date.now() - 1000), // expired
    });

    // Fail on first call, succeed on retry
    mockUpsertFitbitTokens
      .mockRejectedValueOnce(new Error("Database connection error"))
      .mockResolvedValueOnce(undefined);

    const token = await ensureFreshToken("user-uuid-123");
    expect(token).toBe("new-token");
    expect(mockUpsertFitbitTokens).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_SAVE_FAILED when upsert retry also fails (FOO-430)", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        access_token: "new-token",
        refresh_token: "new-refresh",
        user_id: "user-123",
        expires_in: 28800,
      })),
    );

    mockGetFitbitTokens.mockResolvedValue({
      accessToken: "old-token",
      refreshToken: "old-refresh",
      fitbitUserId: "user-123",
      expiresAt: new Date(Date.now() - 1000), // expired
    });

    // Fail on both attempts
    mockUpsertFitbitTokens
      .mockRejectedValueOnce(new Error("Database connection error"))
      .mockRejectedValueOnce(new Error("Database connection error"));

    await expect(ensureFreshToken("user-uuid-123")).rejects.toThrow("FITBIT_TOKEN_SAVE_FAILED");

    vi.restoreAllMocks();
  });
});

describe("exchangeFitbitCode", () => {
  const testCredentials = { clientId: "test-client-id", clientSecret: "test-client-secret" };

  it("aborts after timeout", { timeout: 20000 }, async () => {
    vi.useFakeTimers();

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_, opts: RequestInit | undefined) => {
        return new Promise((_, reject) => {
          if (opts?.signal) {
            opts.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      }
    );

    const promise = exchangeFitbitCode("code", "http://localhost:3000/callback", testCredentials);

    const rejection = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10000);
    await rejection;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("logs error on token exchange HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(
      exchangeFitbitCode("bad-code", "http://localhost:3000/callback", testCredentials),
    ).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "fitbit_token_exchange_failed",
        status: 401,
      }),
      expect.any(String),
    );

    vi.restoreAllMocks();
  });

  it("throws when response is missing access_token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ refresh_token: "rt", user_id: "uid", expires_in: 3600 }), { status: 200 }),
    );

    await expect(
      exchangeFitbitCode("code", "http://localhost:3000/callback", testCredentials),
    ).rejects.toThrow("Invalid Fitbit token response: missing access_token");

    vi.restoreAllMocks();
  });

  it("throws when response is missing expires_in", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", user_id: "uid" }), { status: 200 }),
    );

    await expect(
      exchangeFitbitCode("code", "http://localhost:3000/callback", testCredentials),
    ).rejects.toThrow("Invalid Fitbit token response: missing expires_in");

    vi.restoreAllMocks();
  });

  it("throws when response is missing user_id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 }),
    );

    await expect(
      exchangeFitbitCode("code", "http://localhost:3000/callback", testCredentials),
    ).rejects.toThrow("Invalid Fitbit token response: missing user_id");

    vi.restoreAllMocks();
  });

  it("returns scope from response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        access_token: "at",
        refresh_token: "rt",
        user_id: "uid",
        expires_in: 3600,
        scope: "nutrition activity profile weight",
      }), { status: 200 }),
    );

    const result = await exchangeFitbitCode("code", "http://localhost:3000/callback", testCredentials);
    expect(result.scope).toBe("nutrition activity profile weight");

    vi.restoreAllMocks();
  });

  it("throws when response is missing scope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        access_token: "at",
        refresh_token: "rt",
        user_id: "uid",
        expires_in: 3600,
      }), { status: 200 }),
    );

    await expect(
      exchangeFitbitCode("code", "http://localhost:3000/callback", testCredentials),
    ).rejects.toThrow("Invalid Fitbit token response: missing scope");

    vi.restoreAllMocks();
  });
});

describe("refreshFitbitToken", () => {
  const testCredentials = { clientId: "test-client-id", clientSecret: "test-client-secret" };

  it("aborts after timeout", { timeout: 20000 }, async () => {
    vi.useFakeTimers();

    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_, opts: RequestInit | undefined) => {
        return new Promise((_, reject) => {
          if (opts?.signal) {
            opts.signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      }
    );

    const promise = refreshFitbitToken("refresh-token", testCredentials);

    const rejection = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10000);
    await rejection;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("logs error on token refresh HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(refreshFitbitToken("bad-refresh", testCredentials)).rejects.toThrow();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "fitbit_token_refresh_failed",
        status: 401,
      }),
      expect.any(String),
    );

    vi.restoreAllMocks();
  });

  it("logs debug when token refresh is triggered", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(refreshFitbitToken("token", testCredentials)).rejects.toThrow();

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fitbit_token_refresh_start" }),
      expect.any(String),
    );

    vi.restoreAllMocks();
  });

  it("throws when response is missing required fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at" }), { status: 200 }),
    );

    await expect(refreshFitbitToken("token", testCredentials)).rejects.toThrow(
      "Invalid Fitbit token response: missing refresh_token",
    );

    vi.restoreAllMocks();
  });

  it("throws when response is missing user_id", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ access_token: "at", refresh_token: "rt", expires_in: 3600 }), { status: 200 }),
    );

    await expect(refreshFitbitToken("token", testCredentials)).rejects.toThrow(
      "Invalid Fitbit token response: missing user_id",
    );

    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_INVALID for 401 response (FOO-428)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(refreshFitbitToken("bad-refresh", testCredentials)).rejects.toThrow("FITBIT_TOKEN_INVALID");

    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_INVALID for 400 response (FOO-428)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 400 }),
    );

    await expect(refreshFitbitToken("bad-refresh", testCredentials)).rejects.toThrow("FITBIT_TOKEN_INVALID");

    vi.restoreAllMocks();
  });

  it("throws FITBIT_REFRESH_TRANSIENT for 500 response (FOO-428)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );

    await expect(refreshFitbitToken("refresh-token", testCredentials)).rejects.toThrow("FITBIT_REFRESH_TRANSIENT");

    vi.restoreAllMocks();
  });

  it("throws FITBIT_REFRESH_TRANSIENT for 429 rate limit response (FOO-428)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 429 }),
    );

    await expect(refreshFitbitToken("refresh-token", testCredentials)).rejects.toThrow("FITBIT_REFRESH_TRANSIENT");

    vi.restoreAllMocks();
  });

  it("does not include scope in return value", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        access_token: "at",
        refresh_token: "rt",
        user_id: "uid",
        expires_in: 3600,
        scope: "nutrition activity profile weight",
      }), { status: 200 }),
    );

    const result = await refreshFitbitToken("refresh-token", testCredentials);
    expect("scope" in result).toBe(false);

    vi.restoreAllMocks();
  });
});


describe("createFood", () => {
  const mockFoodAnalysis = {
    food_name: "Homemade Oatmeal",
    amount: 250,
    unit_id: 147,
    calories: 150,
    protein_g: 5,
    carbs_g: 27,
    fat_g: 3,
    fiber_g: 4,
    sodium_mg: 10,
    saturated_fat_g: null,
    trans_fat_g: null,
    sugars_g: null,
    calories_from_fat: null,
    confidence: "high" as const,
    notes: "Test food",
    description: "",
    keywords: ["oatmeal"],
  };

  it("creates a custom food with correct parameters", async () => {
    const mockResponse = {
      food: { foodId: 789, name: "Homemade Oatmeal" },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    const result = await createFood("test-token", mockFoodAnalysis);

    expect(fetch).toHaveBeenCalledWith(
      "https://api.fitbit.com/1/user/-/foods.json",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    );
    expect(result.food.foodId).toBe(789);

    vi.restoreAllMocks();
  });

  it("uses food.unit_id for defaultFoodMeasurementUnitId", async () => {
    const cupFood = { ...mockFoodAnalysis, unit_id: 91, amount: 2 };
    const mockResponse = { food: { foodId: 789, name: "Tea" } };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await createFood("test-token", cupFood);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("defaultFoodMeasurementUnitId=91");
    expect(body).toContain("defaultServingSize=2");

    vi.restoreAllMocks();
  });

  it("sends dietaryFiber parameter name to Fitbit API", async () => {
    const food = { ...mockFoodAnalysis, fiber_g: 7 };
    const mockResponse = { food: { foodId: 789, name: "Test" } };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await createFood("test-token", food);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("dietaryFiber=7");
    expect(body).not.toContain("fiber=");

    vi.restoreAllMocks();
  });

  it("sends formType and description parameters to Fitbit API", async () => {
    const mockResponse = { food: { foodId: 789, name: "Homemade Oatmeal" } };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await createFood("test-token", mockFoodAnalysis);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("formType=DRY");
    expect(body).toContain("description=Homemade+Oatmeal");

    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_INVALID on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(createFood("bad-token", mockFoodAnalysis)).rejects.toThrow(
      "FITBIT_TOKEN_INVALID",
    );

    vi.restoreAllMocks();
  });

  it("throws when response is missing food.foodId", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ food: { name: "Oatmeal" } }), { status: 201 }),
    );

    await expect(createFood("test-token", mockFoodAnalysis)).rejects.toThrow(
      "Invalid Fitbit create food response: missing food.foodId",
    );

    vi.restoreAllMocks();
  });

  it("retries on 429", async () => {
    vi.useFakeTimers();
    const mockResponse = { food: { foodId: 789 } };
    let callCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount < 2) {
        return Promise.resolve(new Response(null, { status: 429 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockResponse), { status: 201 }),
      );
    });

    const promise = createFood("test-token", mockFoodAnalysis);

    // Fast-forward through retry delay: 1s
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.food.foodId).toBe(789);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("includes Tier 1 nutrients when all are non-null numbers", async () => {
    const foodWithTier1 = {
      ...mockFoodAnalysis,
      saturated_fat_g: 2.5,
      trans_fat_g: 0.1,
      sugars_g: 5.0,
      calories_from_fat: 27,
    };
    const mockResponse = { food: { foodId: 789, name: "Test" } };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await createFood("test-token", foodWithTier1);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("saturatedFat=2.5");
    expect(body).toContain("transFat=0.1");
    expect(body).toContain("sugars=5");
    expect(body).toContain("caloriesFromFat=27");

    vi.restoreAllMocks();
  });

  it("omits Tier 1 nutrients when all are null", async () => {
    const mockResponse = { food: { foodId: 789, name: "Test" } };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await createFood("test-token", mockFoodAnalysis);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).not.toContain("saturatedFat");
    expect(body).not.toContain("transFat");
    expect(body).not.toContain("sugars");
    expect(body).not.toContain("caloriesFromFat");

    vi.restoreAllMocks();
  });

  it("omits Tier 1 nutrients when null", async () => {
    const foodWithoutTier1 = {
      ...mockFoodAnalysis,
      saturated_fat_g: null,
      trans_fat_g: null,
      sugars_g: null,
      calories_from_fat: null,
    };
    const mockResponse = { food: { foodId: 789, name: "Test" } };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await createFood("test-token", foodWithoutTier1);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).not.toContain("saturatedFat");
    expect(body).not.toContain("transFat");
    expect(body).not.toContain("sugars");
    expect(body).not.toContain("caloriesFromFat");

    vi.restoreAllMocks();
  });

  it("includes only non-null Tier 1 nutrients in mixed scenario", async () => {
    const mixedFood = {
      ...mockFoodAnalysis,
      saturated_fat_g: 1.5,
      trans_fat_g: null,
      sugars_g: 3.0,
      calories_from_fat: null,
    };
    const mockResponse = { food: { foodId: 789, name: "Test" } };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await createFood("test-token", mixedFood);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("saturatedFat=1.5");
    expect(body).not.toContain("transFat");
    expect(body).toContain("sugars=3");
    expect(body).not.toContain("caloriesFromFat");

    vi.restoreAllMocks();
  });

  it("rounds integer-only Fitbit API fields (calories, sodium, caloriesFromFat)", async () => {
    const foodWithDecimals = {
      ...mockFoodAnalysis,
      calories: 245.7,
      sodium_mg: 312.4,
      calories_from_fat: 22.5,
    };
    const mockResponse = { food: { foodId: 789, name: "Test" } };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await createFood("test-token", foodWithDecimals);

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("calories=246");
    expect(body).toContain("sodium=312");
    expect(body).toContain("caloriesFromFat=23");
    expect(body).not.toContain("245.7");
    expect(body).not.toContain("312.4");
    expect(body).not.toContain("22.5");

    vi.restoreAllMocks();
  });
});

describe("logFood", () => {
  it("logs food entry with correct amount and unitId", async () => {
    const mockResponse = {
      foodLog: { logId: 12345, loggedFood: { foodId: 789 } },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    const result = await logFood("test-token", 789, 1, 250, 147, "2024-01-15");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.fitbit.com/1/user/-/foods/log.json",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      }),
    );

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("amount=250");
    expect(body).toContain("unitId=147");

    expect(result.foodLog.logId).toBe(12345);

    vi.restoreAllMocks();
  });

  it("uses provided unitId instead of hardcoded gram", async () => {
    const mockResponse = {
      foodLog: { logId: 12345, loggedFood: { foodId: 789 } },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await logFood("test-token", 789, 1, 2, 91, "2024-01-15");

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("unitId=91");
    expect(body).toContain("amount=2");

    vi.restoreAllMocks();
  });

  it("includes optional time parameter when provided", async () => {
    const mockResponse = {
      foodLog: { logId: 12345, loggedFood: { foodId: 789 } },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await logFood("test-token", 789, 1, 100, 147, "2024-01-15", "12:30");

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("time=12%3A30");

    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_INVALID on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(logFood("bad-token", 789, 1, 100, 147, "2024-01-15")).rejects.toThrow(
      "FITBIT_TOKEN_INVALID",
    );

    vi.restoreAllMocks();
  });

  it("throws when response is missing foodLog.logId", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ foodLog: {} }), { status: 201 }),
    );

    await expect(logFood("test-token", 789, 1, 250, 147, "2024-01-15")).rejects.toThrow(
      "Invalid Fitbit log food response: missing foodLog.logId",
    );

    vi.restoreAllMocks();
  });
});

describe("fetchWithRetry 5xx handling", () => {
  const mockFoodAnalysis = {
    food_name: "Test Food",
    amount: 100,
    unit_id: 147,
    calories: 200,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 5,
    fiber_g: 3,
    sodium_mg: 100,
    saturated_fat_g: null,
    trans_fat_g: null,
    sugars_g: null,
    calories_from_fat: null,
    confidence: "high" as const,
    notes: "Test",
    description: "",
    keywords: ["test"],
  };

  it("retries on 500 response with backoff", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const mockResponse = { food: { foodId: 789, name: "Test Food" } };

    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount < 2) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockResponse), { status: 201 }),
      );
    });

    const promise = createFood("test-token", mockFoodAnalysis);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.food.foodId).toBe(789);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries on 502 response", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const mockResponse = { food: { foodId: 789, name: "Test Food" } };

    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount < 2) {
        return Promise.resolve(new Response(null, { status: 502 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockResponse), { status: 201 }),
      );
    });

    const promise = createFood("test-token", mockFoodAnalysis);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.food.foodId).toBe(789);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does NOT retry on 400 client error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "bad request" }] }), { status: 400 }),
    );

    await expect(createFood("test-token", mockFoodAnalysis)).rejects.toThrow(
      "FITBIT_API_ERROR",
    );

    // Should only call fetch once (no retry for 4xx)
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it("throws after exhausting retries on persistent 5xx", async () => {
    vi.useFakeTimers();

    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      return Promise.resolve(new Response(null, { status: 500 }));
    });

    const promise = createFood("test-token", mockFoodAnalysis);

    // Set up rejection expectation BEFORE advancing timers to avoid unhandled rejections
    const rejection = expect(promise).rejects.toThrow("FITBIT_API_ERROR");
    // Advance through all retry delays: 1s, 2s, 4s, 8s
    await vi.advanceTimersByTimeAsync(20000);
    await rejection;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("fetchWithRetry 403 handling", () => {
  const mockFoodAnalysis = {
    food_name: "Test Food",
    amount: 100,
    unit_id: 147,
    calories: 200,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 5,
    fiber_g: 3,
    sodium_mg: 100,
    saturated_fat_g: null,
    trans_fat_g: null,
    sugars_g: null,
    calories_from_fat: null,
    confidence: "high" as const,
    notes: "Test",
    description: "",
    keywords: ["test"],
  };

  it("throws FITBIT_SCOPE_MISSING on 403 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await expect(createFood("test-token", mockFoodAnalysis)).rejects.toThrow(
      "FITBIT_SCOPE_MISSING",
    );

    vi.restoreAllMocks();
  });
});

describe("fetchWithRetry deadline", () => {
  const mockFoodAnalysis = {
    food_name: "Test Food",
    amount: 100,
    unit_id: 147,
    calories: 200,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 5,
    fiber_g: 3,
    sodium_mg: 100,
    saturated_fat_g: null,
    trans_fat_g: null,
    sugars_g: null,
    calories_from_fat: null,
    confidence: "high" as const,
    notes: "Test",
    description: "",
    keywords: ["test"],
  };

  it("throws FITBIT_TIMEOUT when total elapsed time exceeds deadline", async () => {
    vi.useFakeTimers();

    // Each fetch resolves with 500 after 9s (just under the 10s AbortController timeout).
    // Timeline with retries:
    //   Call 0: startTime=0, fetch takes 9s → 500 at t=9s, delay 1s → t=10s
    //   Call 1: elapsed=10s < 30s ok, fetch takes 9s → 500 at t=19s, delay 2s → t=21s
    //   Call 2: elapsed=21s < 30s ok, fetch takes 9s → 500 at t=30s, delay 4s → t=34s
    //   Call 3: elapsed=34s > 30s → throws FITBIT_TIMEOUT
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(new Response(null, { status: 500 })), 9000);
      });
    });

    const promise = createFood("test-token", mockFoodAnalysis);

    // Set up rejection BEFORE advancing timers to avoid unhandled rejection
    const rejection = expect(promise).rejects.toThrow("FITBIT_TIMEOUT");

    // Advance through all the fetches + delays: 9s + 1s + 9s + 2s + 9s + 4s = 34s
    await vi.advanceTimersByTimeAsync(40000);

    await rejection;

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("getFitbitLatestWeightKg shares a single 30s deadline across all 7 walk-back days", async () => {
    vi.useFakeTimers();

    // Each fetch resolves with 404 after 9s (no weight on this day → continues walk-back).
    // With a SHARED deadline: 9s × 4 = 36s → the 4th call's deadline check exceeds 30s
    //                          → throws FITBIT_TIMEOUT.
    // With per-iteration deadline (the bug): 9s × 7 = 63s, all 7 iterations succeed.
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(new Response(JSON.stringify({ weight: [] }), { status: 200 })), 9000);
      });
    });

    const promise = getFitbitLatestWeightKg("test-token", "2024-01-15");

    const rejection = expect(promise).rejects.toThrow("FITBIT_TIMEOUT");
    await vi.advanceTimersByTimeAsync(70000);
    await rejection;

    // With shared deadline, we expect ≤ 4 calls (after which deadline is exceeded).
    expect(callCount).toBeLessThanOrEqual(4);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("parseErrorBody", () => {
  it("parses JSON error body", async () => {
    const { parseErrorBody } = await import("@/lib/fitbit");
    const response = new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
    const body = await parseErrorBody(response);
    expect(body).toEqual({ error: "bad request" });
  });

  it("returns text when body is not JSON", async () => {
    const { parseErrorBody } = await import("@/lib/fitbit");
    const response = new Response("Not Found", { status: 404 });
    const body = await parseErrorBody(response);
    expect(body).toBe("Not Found");
  });

  it("returns fallback when body read fails", async () => {
    const { parseErrorBody } = await import("@/lib/fitbit");
    const response = new Response(null, { status: 500 });
    // Override text() to throw
    vi.spyOn(response, "text").mockRejectedValue(new Error("read failed"));
    const body = await parseErrorBody(response);
    expect(body).toBe("unable to read body");
  });
});

describe("jsonWithTimeout", () => {
  it("returns parsed JSON within timeout", async () => {
    const { jsonWithTimeout } = await import("@/lib/fitbit");
    const response = new Response(JSON.stringify({ foo: "bar" }), { status: 200 });
    const result = await jsonWithTimeout<{ foo: string }>(response);
    expect(result).toEqual({ foo: "bar" });
  });

  it("rejects when response.json() exceeds timeout", async () => {
    vi.useFakeTimers();
    const { jsonWithTimeout } = await import("@/lib/fitbit");

    const response = new Response(null, { status: 200 });
    vi.spyOn(response, "json").mockImplementation(() => new Promise(() => {})); // never resolves

    const promise = jsonWithTimeout(response, 5000);

    const rejection = expect(promise).rejects.toThrow("Response body read timed out");
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;

    vi.useRealTimers();
  });
});

describe("deleteFoodLog", () => {
  it("calls DELETE on correct Fitbit food log URL with Bearer token", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await deleteFoodLog("test-token", 12345);

    expect(fetch).toHaveBeenCalledWith(
      "https://api.fitbit.com/1/user/-/foods/log/12345.json",
      expect.objectContaining({
        method: "DELETE",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );

    vi.restoreAllMocks();
  });

  it("returns void on 204 success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const result = await deleteFoodLog("test-token", 12345);
    expect(result).toBeUndefined();

    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_INVALID on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(deleteFoodLog("bad-token", 12345)).rejects.toThrow(
      "FITBIT_TOKEN_INVALID",
    );

    vi.restoreAllMocks();
  });

  it("retries on 429", async () => {
    vi.useFakeTimers();
    let callCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount < 2) {
        return Promise.resolve(new Response(null, { status: 429 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    const promise = deleteFoodLog("test-token", 12345);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(callCount).toBe(2);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries on 5xx", async () => {
    vi.useFakeTimers();
    let callCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount < 2) {
        return Promise.resolve(new Response(null, { status: 500 }));
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    });

    const promise = deleteFoodLog("test-token", 12345);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(callCount).toBe(2);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("throws FITBIT_API_ERROR on other error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "bad request" }] }), { status: 400 }),
    );

    await expect(deleteFoodLog("test-token", 12345)).rejects.toThrow(
      "FITBIT_API_ERROR",
    );

    vi.restoreAllMocks();
  });

  it("logs debug when starting delete", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await deleteFoodLog("test-token", 99999);

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "fitbit_delete_food_log",
        fitbitLogId: 99999,
      }),
      expect.any(String),
    );

    vi.restoreAllMocks();
  });

  it("treats 404 as success (already deleted on Fitbit)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "not found" }] }), { status: 404 }),
    );

    const result = await deleteFoodLog("test-token", 12345);
    expect(result).toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "fitbit_delete_food_log_not_found",
        fitbitLogId: 12345,
      }),
      expect.any(String),
    );

    vi.restoreAllMocks();
  });

  it("logs error on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "bad request" }] }), { status: 400 }),
    );

    await expect(deleteFoodLog("test-token", 12345)).rejects.toThrow(
      "FITBIT_API_ERROR",
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "fitbit_delete_food_log_failed",
        status: 400,
      }),
      expect.any(String),
    );

    vi.restoreAllMocks();
  });
});

describe("getFoodGoals", () => {
  it("returns { calories: null } when Fitbit response has no goals.calories", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ goals: {} }), { status: 200 }),
    );

    const result = await getFoodGoals("test-token");

    expect(result).toEqual({ calories: null });

    vi.restoreAllMocks();
  });

  it("returns { calories: null } when goals.calories is not a number", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ goals: { calories: "not-a-number" } }), { status: 200 }),
    );

    const result = await getFoodGoals("test-token");

    expect(result).toEqual({ calories: null });

    vi.restoreAllMocks();
  });

  it("returns calorie goal when present", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ goals: { calories: 2500 } }), { status: 200 }),
    );

    const result = await getFoodGoals("test-token");

    expect(result).toEqual({ calories: 2500 });

    vi.restoreAllMocks();
  });
});

describe("getActivitySummary", () => {
  it("fetches activity summary for a given date", async () => {
    const mockResponse = {
      summary: {
        caloriesOut: 2345,
      },
      goals: {
        caloriesOut: 3500,
      },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await getActivitySummary("test-token", "2024-01-15");

    expect(fetch).toHaveBeenCalledWith(
      "https://api.fitbit.com/1/user/-/activities/date/2024-01-15.json",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
    expect(result).toEqual({
      caloriesOut: 2345,
    });

    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_INVALID on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(getActivitySummary("bad-token", "2024-01-15")).rejects.toThrow(
      "FITBIT_TOKEN_INVALID",
    );

    vi.restoreAllMocks();
  });

  it("throws FITBIT_API_ERROR when API returns non-ok status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [{ message: "bad request" }] }), { status: 400 }),
    );

    await expect(getActivitySummary("test-token", "2024-01-15")).rejects.toThrow(
      "FITBIT_API_ERROR",
    );

    vi.restoreAllMocks();
  });

  it("returns caloriesOut: null when response is missing summary.caloriesOut (drives partial macro state)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ summary: {} }), { status: 200 }),
    );

    const result = await getActivitySummary("test-token", "2024-01-15");
    expect(result).toEqual({ caloriesOut: null });

    vi.restoreAllMocks();
  });


  it("throws FITBIT_SCOPE_MISSING on 403 response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );

    await expect(getActivitySummary("test-token", "2024-01-15")).rejects.toThrow(
      "FITBIT_SCOPE_MISSING",
    );

    vi.restoreAllMocks();
  });

  it("retries on 429 rate limit", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const mockResponse = { summary: { caloriesOut: 2345 }, goals: { caloriesOut: 3500 } };

    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount < 2) {
        return Promise.resolve(new Response(null, { status: 429 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      );
    });

    const promise = getActivitySummary("test-token", "2024-01-15");
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.caloriesOut).toBe(2345);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("getFitbitProfile", () => {
  it("parses profile live shape correctly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ user: { age: 34, gender: "MALE", height: 180.0 } }),
        { status: 200 },
      ),
    );

    const result = await getFitbitProfile("test-token");

    expect(result).toEqual({ ageYears: 34, sex: "MALE", heightCm: 180.0 });
    vi.restoreAllMocks();
  });

  it("does not send Accept-Language: en_US (would force imperial response)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ user: { age: 30, gender: "MALE", height: 170.0 } }),
        { status: 200 },
      ),
    );

    await getFitbitProfile("test-token");

    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["Accept-Language"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("gender NA propagates as sex NA", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ user: { age: 25, gender: "NA", height: 165.0 } }),
        { status: 200 },
      ),
    );

    const result = await getFitbitProfile("test-token");

    expect(result.sex).toBe("NA");
    vi.restoreAllMocks();
  });

  it("throws validation error when user.age is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ user: { gender: "MALE", height: 175.0 } }),
        { status: 200 },
      ),
    );

    await expect(getFitbitProfile("test-token")).rejects.toThrow(
      "Invalid Fitbit profile response: missing user.age",
    );
    vi.restoreAllMocks();
  });

  it("throws validation error when user.gender is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ user: { age: 30, height: 175.0 } }),
        { status: 200 },
      ),
    );

    await expect(getFitbitProfile("test-token")).rejects.toThrow(
      "Invalid Fitbit profile response: missing user.gender",
    );
    vi.restoreAllMocks();
  });

  it("throws validation error when user.height is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ user: { age: 30, gender: "FEMALE" } }),
        { status: 200 },
      ),
    );

    await expect(getFitbitProfile("test-token")).rejects.toThrow(
      "Invalid Fitbit profile response: missing user.height",
    );
    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_INVALID on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(getFitbitProfile("bad-token")).rejects.toThrow("FITBIT_TOKEN_INVALID");
    vi.restoreAllMocks();
  });

  it("throws FITBIT_API_ERROR on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), { status: 400 }),
    );

    await expect(getFitbitProfile("test-token")).rejects.toThrow("FITBIT_API_ERROR");
    vi.restoreAllMocks();
  });
});

describe("getFitbitLatestWeightKg", () => {
  it("parses weight log live shape correctly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ weight: [{ weight: 121.6, date: "2024-01-15", time: "06:00:00", logId: 1234 }] }),
        { status: 200 },
      ),
    );

    const result = await getFitbitLatestWeightKg("test-token", "2024-01-15");

    expect(result).toEqual({ weightKg: 121.6, loggedDate: "2024-01-15" });
    vi.restoreAllMocks();
  });

  it("does not send Accept-Language: en_US (would force imperial response)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ weight: [{ weight: 80.0, date: "2024-01-15" }] }),
        { status: 200 },
      ),
    );

    await getFitbitLatestWeightKg("test-token", "2024-01-15");

    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["Accept-Language"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("falls back to day -1 when day 0 has empty array", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({ weight: [] }), { status: 200 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ weight: [{ weight: 90.5, date: "2024-01-14" }] }), { status: 200 }),
      );
    });

    const result = await getFitbitLatestWeightKg("test-token", "2024-01-15");

    expect(callCount).toBe(2);
    expect(result).toEqual({ weightKg: 90.5, loggedDate: "2024-01-14" });
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("2024-01-15"),
      expect.anything(),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("2024-01-14"),
      expect.anything(),
    );
    vi.restoreAllMocks();
  });

  it("returns null after 7 empty days", async () => {
    // Each call needs a fresh Response (body can only be read once)
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ weight: [] }), { status: 200 })),
    );

    const result = await getFitbitLatestWeightKg("test-token", "2024-01-15");

    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(7);
    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_INVALID on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(getFitbitLatestWeightKg("bad-token", "2024-01-15")).rejects.toThrow("FITBIT_TOKEN_INVALID");
    vi.restoreAllMocks();
  });

  it("falls back to day -1 when day 0 surfaces a non-ok response", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({ errors: [] }), { status: 400 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ weight: [{ weight: 88.5, date: "2024-01-14" }] }), { status: 200 }),
      );
    });

    const result = await getFitbitLatestWeightKg("test-token", "2024-01-15");

    expect(callCount).toBe(2);
    expect(result).toEqual({ weightKg: 88.5, loggedDate: "2024-01-14" });
    vi.restoreAllMocks();
  });

  it("returns null when all 7 days surface non-ok responses", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ errors: [] }), { status: 400 })),
    );

    const result = await getFitbitLatestWeightKg("test-token", "2024-01-15");

    expect(result).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("getFitbitWeightGoal", () => {
  it("returns goalType LOSE for valid LOSE goal", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ goal: { goalType: "LOSE", weight: 85.0 } }),
        { status: 200 },
      ),
    );

    const result = await getFitbitWeightGoal("test-token");

    expect(result).toEqual({ goalType: "LOSE" });
    vi.restoreAllMocks();
  });

  it("returns goalType MAINTAIN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ goal: { goalType: "MAINTAIN", weight: 80.0 } }),
        { status: 200 },
      ),
    );

    const result = await getFitbitWeightGoal("test-token");

    expect(result).toEqual({ goalType: "MAINTAIN" });
    vi.restoreAllMocks();
  });

  it("returns goalType GAIN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ goal: { goalType: "GAIN", weight: 95.0 } }),
        { status: 200 },
      ),
    );

    const result = await getFitbitWeightGoal("test-token");

    expect(result).toEqual({ goalType: "GAIN" });
    vi.restoreAllMocks();
  });

  it("returns null when goal field is empty (no goalType)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ goal: {} }), { status: 200 }),
    );

    const result = await getFitbitWeightGoal("test-token");

    expect(result).toBeNull();
    vi.restoreAllMocks();
  });

  it("returns null when goal field is missing from response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );

    const result = await getFitbitWeightGoal("test-token");

    expect(result).toBeNull();
    vi.restoreAllMocks();
  });

  it("throws validation error for unknown goalType", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ goal: { goalType: "UNKNOWN_TYPE" } }),
        { status: 200 },
      ),
    );

    await expect(getFitbitWeightGoal("test-token")).rejects.toThrow(
      /unknown goalType/,
    );
    vi.restoreAllMocks();
  });

  it("does not send Accept-Language: en_US (keeps body endpoints metric-by-default)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ goal: { goalType: "LOSE" } }), { status: 200 }),
    );

    await getFitbitWeightGoal("test-token");

    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = call[1] as RequestInit;
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["Accept-Language"]).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_INVALID on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(getFitbitWeightGoal("bad-token")).rejects.toThrow("FITBIT_TOKEN_INVALID");
    vi.restoreAllMocks();
  });

  it("throws FITBIT_API_ERROR on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ errors: [] }), { status: 400 }),
    );

    await expect(getFitbitWeightGoal("test-token")).rejects.toThrow("FITBIT_API_ERROR");
    vi.restoreAllMocks();
  });
});

describe("findOrCreateFood", () => {
  const mockFoodAnalysis = {
    food_name: "Homemade Oatmeal",
    amount: 250,
    unit_id: 147,
    calories: 150,
    protein_g: 5,
    carbs_g: 27,
    fat_g: 3,
    fiber_g: 4,
    sodium_mg: 10,
    saturated_fat_g: null,
    trans_fat_g: null,
    sugars_g: null,
    calories_from_fat: null,
    confidence: "high" as const,
    notes: "Test food",
    description: "",
    keywords: ["oatmeal"],
  };

  it("always creates a new food", async () => {
    const createResponse = { food: { foodId: 789, name: "Homemade Oatmeal" } };

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(createResponse), { status: 201 }),
    );

    const result = await findOrCreateFood("test-token", mockFoodAnalysis);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.fitbit.com/1/user/-/foods.json",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.foodId).toBe(789);
    expect(result.reused).toBe(false);

    vi.restoreAllMocks();
  });

  it("propagates errors from createFood", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 401 }),
    );

    await expect(findOrCreateFood("bad-token", mockFoodAnalysis)).rejects.toThrow(
      "FITBIT_TOKEN_INVALID",
    );

    vi.restoreAllMocks();
  });
});

describe("fetchWithRetry Retry-After honoring (FOO-1011)", () => {
  it("sleeps the duration of Retry-After (integer seconds) and retries once on 429", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 429,
            headers: { "Retry-After": "5" }, // 5 seconds, within 30s deadline
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ summary: { caloriesOut: 1234 } }), { status: 200 }),
      );
    });

    const promise = getActivitySummary("test-token", "2024-01-15");
    await vi.advanceTimersByTimeAsync(5000); // exact Retry-After duration
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.caloriesOut).toBe(1234);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("throws FITBIT_RATE_LIMIT immediately when Retry-After exceeds deadline (no retry)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 429,
        headers: { "Retry-After": "3600" }, // 1h, well over 30s deadline
      }),
    );

    await expect(
      getActivitySummary("test-token", "2024-01-15"),
    ).rejects.toThrow("FITBIT_RATE_LIMIT");

    expect(fetch).toHaveBeenCalledTimes(1); // no retry attempted

    vi.restoreAllMocks();
  });

  it("on 429 without Retry-After: retries once with 1s delay then throws if still 429", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 429 }),
    );

    const promise = getActivitySummary("test-token", "2024-01-15");
    const rejection = expect(promise).rejects.toThrow("FITBIT_RATE_LIMIT");
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;

    expect(fetch).toHaveBeenCalledTimes(2); // initial + 1 retry

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("parses Retry-After in HTTP-date format", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 429,
            headers: {
              // 7 seconds in the future
              "Retry-After": new Date(
                Date.parse("2026-05-04T12:00:07Z"),
              ).toUTCString(),
            },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ summary: { caloriesOut: 999 } }), { status: 200 }),
      );
    });

    const promise = getActivitySummary("test-token", "2024-01-15");
    await vi.advanceTimersByTimeAsync(7000);
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.caloriesOut).toBe(999);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("treats Retry-After: 0 as immediate retry", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 429,
            headers: { "Retry-After": "0" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ summary: { caloriesOut: 111 } }), { status: 200 }),
      );
    });

    const result = await getActivitySummary("test-token", "2024-01-15");

    expect(callCount).toBe(2);
    expect(result.caloriesOut).toBe(111);

    vi.restoreAllMocks();
  });

  it("treats Retry-After with a past HTTP-date as immediate retry (clamped to 0ms)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));

    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 429,
            // 1 minute IN THE PAST relative to system time
            headers: { "Retry-After": new Date("2026-05-04T11:59:00Z").toUTCString() },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ summary: { caloriesOut: 222 } }), { status: 200 }),
      );
    });

    const promise = getActivitySummary("test-token", "2024-01-15");
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.caloriesOut).toBe(222);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("falls back to default 1s delay when Retry-After is malformed", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          new Response(null, {
            status: 429,
            headers: { "Retry-After": "not-a-valid-value" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ summary: { caloriesOut: 555 } }), { status: 200 }),
      );
    });

    const promise = getActivitySummary("test-token", "2024-01-15");
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result.caloriesOut).toBe(555);

    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});

describe("fetchWithRetry rate-limit header recording (FOO-1013)", () => {
  beforeEach(() => {
    mockRecordRateLimitHeaders.mockClear();
    mockGetRateLimitSnapshot.mockReset().mockReturnValue(null);
  });

  it("calls recordRateLimitHeaders with userId and the response when userId is provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ summary: { caloriesOut: 1234 } }), {
        status: 200,
        headers: {
          "Fitbit-Rate-Limit-Limit": "150",
          "Fitbit-Rate-Limit-Remaining": "120",
          "Fitbit-Rate-Limit-Reset": "1800",
        },
      }),
    );

    await getActivitySummary("test-token", "2024-01-15", undefined, "user-a");

    expect(mockRecordRateLimitHeaders).toHaveBeenCalledTimes(1);
    const args = mockRecordRateLimitHeaders.mock.calls[0]!;
    expect(args[0]).toBe("user-a");
    // args[1] is a Response object
    expect(args[1]).toBeInstanceOf(Response);

    vi.restoreAllMocks();
  });

  it("still calls recordRateLimitHeaders when userId is undefined (the helper itself no-ops)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ summary: { caloriesOut: 1234 } }), { status: 200 }),
    );

    await getActivitySummary("test-token", "2024-01-15");

    expect(mockRecordRateLimitHeaders).toHaveBeenCalledTimes(1);
    expect(mockRecordRateLimitHeaders.mock.calls[0]![0]).toBeUndefined();

    vi.restoreAllMocks();
  });

  it("threads userId through to fetchWithRetry from createFood (write path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ food: { foodId: 1 } }), { status: 201 }),
    );

    const food = {
      food_name: "Test",
      amount: 100,
      unit_id: 147,
      calories: 200,
      protein_g: 10,
      carbs_g: 20,
      fat_g: 5,
      fiber_g: 3,
      sodium_mg: 100,
      saturated_fat_g: null,
      trans_fat_g: null,
      sugars_g: null,
      calories_from_fat: null,
      confidence: "high" as const,
      notes: "Test",
      description: "",
      keywords: ["test"],
    };

    await createFood("test-token", food, undefined, "user-write");

    expect(mockRecordRateLimitHeaders.mock.calls[0]![0]).toBe("user-write");

    vi.restoreAllMocks();
  });
});

describe("fetchWithRetry circuit breaker plumbing (FOO-1014)", () => {
  const mockFood = {
    food_name: "Test",
    amount: 100,
    unit_id: 147,
    calories: 200,
    protein_g: 10,
    carbs_g: 20,
    fat_g: 5,
    fiber_g: 3,
    sodium_mg: 100,
    saturated_fat_g: null,
    trans_fat_g: null,
    sugars_g: null,
    calories_from_fat: null,
    confidence: "high" as const,
    notes: "",
    description: "",
    keywords: ["test"],
  };

  beforeEach(() => {
    mockAssertRateLimitAllowed.mockReset();
  });

  it("calls assertRateLimitAllowed with default 'optional' when read function has no override", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ summary: { caloriesOut: 1234 } }), { status: 200 }),
    );

    await getActivitySummary("test-token", "2024-01-15", undefined, "user-a");

    expect(mockAssertRateLimitAllowed).toHaveBeenCalledTimes(1);
    expect(mockAssertRateLimitAllowed.mock.calls[0]![0]).toBe("user-a");
    expect(mockAssertRateLimitAllowed.mock.calls[0]![1]).toBe("optional");

    vi.restoreAllMocks();
  });

  it("calls assertRateLimitAllowed with caller-overridden 'important' for read functions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ summary: { caloriesOut: 1234 } }), { status: 200 }),
    );

    await getActivitySummary("test-token", "2024-01-15", undefined, "user-a", "important");

    expect(mockAssertRateLimitAllowed.mock.calls[0]![1]).toBe("important");

    vi.restoreAllMocks();
  });

  it("hardcodes 'critical' for createFood (write path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ food: { foodId: 1 } }), { status: 201 }),
    );

    await createFood("test-token", mockFood, undefined, "user-write");

    expect(mockAssertRateLimitAllowed.mock.calls[0]![1]).toBe("critical");

    vi.restoreAllMocks();
  });

  it("hardcodes 'critical' for logFood", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ foodLog: { logId: 1, loggedFood: { foodId: 1 } } }), { status: 201 }),
    );

    await logFood("test-token", 1, 1, 100, 147, "2024-01-15", undefined, undefined, "user-write");

    expect(mockAssertRateLimitAllowed.mock.calls[0]![1]).toBe("critical");

    vi.restoreAllMocks();
  });

  it("hardcodes 'critical' for deleteFoodLog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    await deleteFoodLog("test-token", 12345, undefined, "user-write");

    expect(mockAssertRateLimitAllowed.mock.calls[0]![1]).toBe("critical");

    vi.restoreAllMocks();
  });

  it("propagates FITBIT_RATE_LIMIT_LOW thrown by the breaker", async () => {
    mockAssertRateLimitAllowed.mockImplementation(() => {
      throw new Error("FITBIT_RATE_LIMIT_LOW");
    });

    await expect(
      getActivitySummary("test-token", "2024-01-15", undefined, "user-a"),
    ).rejects.toThrow("FITBIT_RATE_LIMIT_LOW");
  });

  it("does NOT call the breaker when userId is undefined (defensive default)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ user: { age: 30, gender: "MALE", height: 180.0 } }), {
        status: 200,
      }),
    );

    await getFitbitProfile("test-token");

    expect(mockAssertRateLimitAllowed).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
});
