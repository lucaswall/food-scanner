import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("FITBIT_CLIENT_ID", "test-fitbit-client-id");
vi.stubEnv("FITBIT_CLIENT_SECRET", "test-fitbit-client-secret");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const {
  buildFitbitAuthUrl,
  exchangeFitbitCode,
  refreshFitbitToken,
  ensureFreshToken,
  createFood,
  logFood,
  findOrCreateFood,
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
      ),
    );
    expect(url.origin).toBe("https://www.fitbit.com");
    expect(url.pathname).toBe("/oauth2/authorize");
  });

  it("includes correct client_id", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
      ),
    );
    expect(url.searchParams.get("client_id")).toBe("test-fitbit-client-id");
  });

  it("includes redirect_uri", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
      ),
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/fitbit/callback",
    );
  });

  it("requests nutrition scope", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
      ),
    );
    expect(url.searchParams.get("scope")).toContain("nutrition");
  });

  it("uses response_type=code", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "test-state",
        "http://localhost:3000/api/auth/fitbit/callback",
      ),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("includes state parameter", () => {
    const url = new URL(
      buildFitbitAuthUrl(
        "my-state",
        "http://localhost:3000/api/auth/fitbit/callback",
      ),
    );
    expect(url.searchParams.get("state")).toBe("my-state");
  });
});

describe("ensureFreshToken", () => {
  it("returns existing token if not expiring within 1 hour", async () => {
    const session = {
      fitbit: {
        accessToken: "valid-token",
        refreshToken: "refresh-token",
        userId: "user-123",
        expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours from now
      },
    };

    const token = await ensureFreshToken(session as never);
    expect(token).toBe("valid-token");
  });

  it("throws FITBIT_TOKEN_INVALID if no fitbit tokens exist", async () => {
    const session = {};

    await expect(ensureFreshToken(session as never)).rejects.toThrow(
      "FITBIT_TOKEN_INVALID",
    );
  });
});

describe("exchangeFitbitCode", () => {
  it("logs error on token exchange HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(
      exchangeFitbitCode("bad-code", "http://localhost:3000/callback"),
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
});

describe("refreshFitbitToken", () => {
  it("logs error on token refresh HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(refreshFitbitToken("bad-refresh")).rejects.toThrow();

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

    await expect(refreshFitbitToken("token")).rejects.toThrow();

    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fitbit_token_refresh_start" }),
      expect.any(String),
    );

    vi.restoreAllMocks();
  });
});


describe("createFood", () => {
  const mockFoodAnalysis = {
    food_name: "Homemade Oatmeal",
    portion_size_g: 250,
    calories: 150,
    protein_g: 5,
    carbs_g: 27,
    fat_g: 3,
    fiber_g: 4,
    sodium_mg: 10,
    confidence: "high" as const,
    notes: "Test food",
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

  it("throws FITBIT_TOKEN_INVALID on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(createFood("bad-token", mockFoodAnalysis)).rejects.toThrow(
      "FITBIT_TOKEN_INVALID",
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
});

describe("logFood", () => {
  it("logs food entry with correct amount matching portion size", async () => {
    const mockResponse = {
      foodLog: { logId: 12345, loggedFood: { foodId: 789 } },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    const portionSizeG = 250;
    const result = await logFood("test-token", 789, 1, portionSizeG, "2024-01-15");

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

    // Verify the amount parameter matches the portion size
    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("amount=250");

    expect(result.foodLog.logId).toBe(12345);

    vi.restoreAllMocks();
  });

  it("includes optional time parameter when provided", async () => {
    const mockResponse = {
      foodLog: { logId: 12345, loggedFood: { foodId: 789 } },
    };

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 201 }),
    );

    await logFood("test-token", 789, 1, 100, "2024-01-15", "12:30");

    const fetchCall = vi.mocked(fetch).mock.calls[0];
    const body = fetchCall[1]?.body as string;
    expect(body).toContain("time=12%3A30");

    vi.restoreAllMocks();
  });

  it("throws FITBIT_TOKEN_INVALID on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );

    await expect(logFood("bad-token", 789, 1, 100, "2024-01-15")).rejects.toThrow(
      "FITBIT_TOKEN_INVALID",
    );

    vi.restoreAllMocks();
  });
});

describe("findOrCreateFood", () => {
  const mockFoodAnalysis = {
    food_name: "Homemade Oatmeal",
    portion_size_g: 250,
    calories: 150,
    protein_g: 5,
    carbs_g: 27,
    fat_g: 3,
    fiber_g: 4,
    sodium_mg: 10,
    confidence: "high" as const,
    notes: "Test food",
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
