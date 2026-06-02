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
const recordResourceExhaustedCooldownMock = vi.fn();

vi.mock("@/lib/google-health-rate-limit", () => ({
  assertRateLimitAllowed: (...args: unknown[]) => assertRateLimitAllowedMock(...args),
  recordRateLimitHeaders: (...args: unknown[]) => recordRateLimitHeadersMock(...args),
  getRateLimitSnapshot: (...args: unknown[]) => getRateLimitSnapshotMock(...args),
  recordResourceExhaustedCooldown: (...args: unknown[]) => recordResourceExhaustedCooldownMock(...args),
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

// Sample FoodAnalysis for createNutritionLog tests
const sampleFood = {
  food_name: "Test Chicken",
  amount: 200,
  unit_id: "g" as import("@/types").ServingUnit,
  calories: 320.7,
  protein_g: 30,
  carbs_g: 0,
  fat_g: 10,
  fiber_g: 0,
  sodium_mg: 150,
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high" as const,
  notes: "",
  description: "",
  keywords: [],
};

const sampleTiming = {
  date: "2026-02-08",
  time: "20:00:00",
  zoneOffset: "-03:00",
  mealTypeId: 5,
};

describe("google-health", () => {
  let fetchWithRetry: typeof import("@/lib/google-health").fetchWithRetry;
  let refreshGoogleHealthToken: typeof import("@/lib/google-health").refreshGoogleHealthToken;
  let ensureFreshToken: typeof import("@/lib/google-health").ensureFreshToken;
  let createNutritionLog: typeof import("@/lib/google-health").createNutritionLog;
  let deleteNutritionLogs: typeof import("@/lib/google-health").deleteNutritionLogs;
  let getHealthProfile: typeof import("@/lib/google-health").getHealthProfile;
  let getHealthLatestWeightKg: typeof import("@/lib/google-health").getHealthLatestWeightKg;
  let getHealthActivitySummary: typeof import("@/lib/google-health").getHealthActivitySummary;
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
    createNutritionLog = mod.createNutritionLog;
    deleteNutritionLogs = mod.deleteNutritionLogs;
    getHealthProfile = mod.getHealthProfile;
    getHealthLatestWeightKg = mod.getHealthLatestWeightKg;
    getHealthActivitySummary = mod.getHealthActivitySummary;
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

    it("throws HEALTH_RATE_LIMIT on 403 RESOURCE_EXHAUSTED and records cooldown via recordResourceExhaustedCooldown", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(
        fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog, "user-a"),
      ).rejects.toThrow("HEALTH_RATE_LIMIT");

      expect(recordResourceExhaustedCooldownMock).toHaveBeenCalledWith("user-a", fakeLog);
    });

    it("throws HEALTH_SCOPE_MISSING on 403 with non-RESOURCE_EXHAUSTED body (scope error — not quota)", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ error: { status: "PERMISSION_DENIED", code: 403 } }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(
        fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog, "user-a"),
      ).rejects.toThrow("HEALTH_SCOPE_MISSING");

      // The scope-403 path must log Google's body so the reason is visible (not a bare code).
      const scopeLog = warnMock.mock.calls.find(
        (c) => (c[0] as { action?: string })?.action === "health_403_scope",
      );
      expect(scopeLog).toBeDefined();
      expect((scopeLog![0] as { errorBody: unknown }).errorBody).toEqual({ error: { status: "PERMISSION_DENIED", code: 403 } });

      expect(recordResourceExhaustedCooldownMock).not.toHaveBeenCalled();
    });

    it("throws HEALTH_SCOPE_MISSING on empty-body 403 (scope error — cannot be RESOURCE_EXHAUSTED)", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 403 }));

      await expect(
        fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog, "user-a"),
      ).rejects.toThrow("HEALTH_SCOPE_MISSING");

      expect(recordResourceExhaustedCooldownMock).not.toHaveBeenCalled();
    });

    it("does not call recordResourceExhaustedCooldown when userId is undefined on 403 RESOURCE_EXHAUSTED", async () => {
      fetchMock.mockResolvedValue(
        new Response(
          JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(
        fetchWithRetry("https://example.com", {}, 0, Date.now(), fakeLog),
      ).rejects.toThrow("HEALTH_RATE_LIMIT");

      expect(recordResourceExhaustedCooldownMock).not.toHaveBeenCalled();
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

  // ─── createNutritionLog ─────────────────────────────────────────────────────

  describe("createNutritionLog", () => {
    it("makes exactly ONE POST to the nutrition-log/dataPoints collection (server assigns the id)", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "operations/abc" }));

      await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("POST");
      // POST to the bare collection — no client-supplied id in the path.
      expect(url).toMatch(/\/dataTypes\/nutrition-log\/dataPoints$/);
    });

    it("POSTs a v4 DataPoint with the { nutritionLog } envelope and NO client name", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "operations/abc" }));

      await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { name?: string; nutritionLog: Record<string, unknown> };
      // create is POST-to-collection: the server assigns the name, client must not send one.
      expect(body.name).toBeUndefined();
      expect(body.nutritionLog).toBeDefined();
    });

    it("nutritionLog carries foodDisplayName, energy (kcal), totals, and serving (v4 schema)", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));

      await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const { nutritionLog } = JSON.parse(init.body as string);
      expect(nutritionLog.foodDisplayName).toBe("Test Chicken");
      expect(nutritionLog.energy).toEqual({ kcal: 321 }); // Math.round(320.7)
      expect(nutritionLog.totalCarbohydrate).toEqual({ grams: 0 });
      expect(nutritionLog.totalFat).toEqual({ grams: 10 });
      expect(nutritionLog.serving).toEqual({ amount: 200, foodMeasurementUnit: "g" });
    });

    it("nutritionLog.nutrients carries protein/fiber/sodium as NutrientQuantity (sodium mg → grams)", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));

      await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const { nutritionLog } = JSON.parse(init.body as string);
      const nutrients = nutritionLog.nutrients as Array<{ nutrient: string; quantity: Record<string, number> }>;
      const byNutrient = Object.fromEntries(nutrients.map((n) => [n.nutrient, n.quantity]));
      expect(byNutrient.PROTEIN).toEqual({ grams: 30 });
      expect(byNutrient.DIETARY_FIBER).toEqual({ grams: 0 });
      expect(byNutrient.SODIUM).toEqual({ grams: 0.15 }); // 150 mg → 0.15 g
      // carbs/fat are top-level totals, not nutrients[]
      expect(nutrients.some((n) => n.nutrient === "TOTAL_FAT" || n.nutrient === "TOTAL_CARBOHYDRATE")).toBe(false);
    });

    it("omits optional nutrients (saturated/trans/sugar) when null", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));

      await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const { nutritionLog } = JSON.parse(init.body as string);
      const names = (nutritionLog.nutrients as Array<{ nutrient: string }>).map((n) => n.nutrient);
      expect(names).not.toContain("SATURATED_FAT");
      expect(names).not.toContain("TRANS_FAT");
      expect(names).not.toContain("SUGAR");
      expect(nutritionLog).not.toHaveProperty("energyFromFat");
    });

    it("includes optional nutrients (SATURATED_FAT/TRANS_FAT/SUGAR) + energyFromFat when present", async () => {
      const richFood = {
        ...sampleFood,
        saturated_fat_g: 3.5,
        trans_fat_g: 0.5,
        sugars_g: 2,
        calories_from_fat: 90.4,
      };
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));

      await createNutritionLog("token", richFood, sampleTiming, fakeLog, "user-1");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const { nutritionLog } = JSON.parse(init.body as string);
      const nutrients = nutritionLog.nutrients as Array<{ nutrient: string; quantity: Record<string, number> }>;
      const byNutrient = Object.fromEntries(nutrients.map((n) => [n.nutrient, n.quantity]));
      expect(byNutrient.SATURATED_FAT).toEqual({ grams: 3.5 });
      expect(byNutrient.TRANS_FAT).toEqual({ grams: 0.5 });
      expect(byNutrient.SUGAR).toEqual({ grams: 2 });
      expect(nutritionLog.energyFromFat).toEqual({ kcal: 90 }); // Math.round(90.4)
    });

    it("rounds fractional calories with Math.round (energy.kcal)", async () => {
      const food = { ...sampleFood, calories: 250.6 };
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));

      await createNutritionLog("token", food, sampleTiming, fakeLog, "user-1");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const { nutritionLog } = JSON.parse(init.body as string);
      expect(nutritionLog.energy).toEqual({ kcal: 251 });
    });

    it("returns the SERVER-assigned dataPoint id parsed from a done-inline DataPoint response", async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          name: "users/me/dataTypes/nutrition-log/dataPoints/server-assigned-77",
          nutritionLog: {},
        }),
      );

      const result = await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");

      expect(result.healthLogId).toBe("server-assigned-77");
    });

    it("extracts the dataPoint id from a long-running Operation's response", async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          name: "operations/op-123",
          response: { name: "users/me/dataTypes/nutrition-log/dataPoints/op-result-9" },
        }),
      );

      const result = await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");

      expect(result.healthLogId).toBe("op-result-9");
    });

    it("returns null healthLogId when the response carries no dataPoint name (async Operation, no fallback)", async () => {
      // The server assigns the id, so there is no client id to fall back to — the only
      // honest result is null (write succeeded; the dataPoint name isn't known yet).
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "operations/op-only", done: false }));

      const result = await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");

      expect(result.healthLogId).toBeNull();
    });

    it("throws HEALTH_BAD_REQUEST on 4xx response (400) — raw body never in thrown error", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ message: "raw upstream 400 detail" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );

      let thrown: Error | null = null;
      try {
        await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");
      } catch (e) {
        thrown = e as Error;
      }
      expect(thrown).not.toBeNull();
      expect(thrown!.message).toBe("HEALTH_BAD_REQUEST");
      // Raw upstream body must never appear in the thrown Error.message
      expect(thrown!.message).not.toContain("raw upstream 400 detail");
    });

    it("logs the upstream error body AND the request body on a failed write (for field-level debugging)", async () => {
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "Invalid value at 'nutrition_log.meal_type'" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );

      await expect(
        createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1"),
      ).rejects.toThrow("HEALTH_BAD_REQUEST");

      const logged = errorMock.mock.calls.find(
        (c) => (c[0] as { action?: string })?.action === "health_create_nutrition_log_failed",
      );
      expect(logged).toBeDefined();
      const ctx = logged![0] as { status: number; errorBody: unknown; requestBody: { nutritionLog: unknown } };
      expect(ctx.status).toBe(400);
      expect(ctx.errorBody).toEqual({ error: { message: "Invalid value at 'nutrition_log.meal_type'" } });
      // The request body we sent must be logged so a rejected field can be diagnosed.
      expect(ctx.requestBody.nutritionLog).toBeDefined();
    });

    it("throws HEALTH_API_ERROR on 5xx response (after retries) — raw body never in thrown error", async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ message: "raw 500 server detail" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const promise = createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");
      const rejection = expect(promise).rejects.toThrow("HEALTH_API_ERROR");
      // MAX_RETRIES=3, exp backoff: 1s+2s+4s = 7s total
      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;
    });

    it("returns { healthLogId: null } and does not call fetch when HEALTH_DRY_RUN=true", async () => {
      vi.stubEnv("HEALTH_DRY_RUN", "true");

      const result = await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");

      expect(fetchMock).not.toHaveBeenCalled();
      // null (not the "dry-run" sentinel) so the partial unique index never collides
      expect(result).toEqual({ healthLogId: null });
      vi.stubEnv("HEALTH_DRY_RUN", ""); // reset for next tests
    });

    it("sends Authorization: Bearer header", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));

      await createNutritionLog("my-access-token", sampleFood, sampleTiming, fakeLog, "user-1");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer my-access-token");
    });

    // FOO-1113: the Health entry must carry the user's selected meal time + context.
    it("nutritionLog carries the interval (start==end, with UTC offset) + mapped mealType", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));

      await createNutritionLog("token", sampleFood, sampleTiming, fakeLog, "user-1");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const { nutritionLog } = JSON.parse(init.body as string);
      expect(nutritionLog.interval).toEqual({
        startTime: "2026-02-08T20:00:00-03:00",
        startUtcOffset: "-10800s",
        endTime: "2026-02-08T20:00:00-03:00",
        endUtcOffset: "-10800s",
      });
      expect(nutritionLog.mealType).toBe("DINNER"); // mealTypeId 5
    });

    it("builds the interval without an offset when zoneOffset is absent and normalizes HH:mm", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));

      await createNutritionLog(
        "token",
        sampleFood,
        { date: "2026-02-08", time: "08:30", mealTypeId: 1 },
        fakeLog,
        "user-1",
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const { nutritionLog } = JSON.parse(init.body as string);
      expect(nutritionLog.interval).toEqual({
        startTime: "2026-02-08T08:30:00Z",
        startUtcOffset: "0s",
        endTime: "2026-02-08T08:30:00Z",
        endUtcOffset: "0s",
      });
      expect(nutritionLog.mealType).toBe("BREAKFAST"); // mealTypeId 1
    });

    it("maps snack meal types to their exact v4 enum values (morning→BEFORE_LUNCH, afternoon→BEFORE_DINNER)", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));

      await createNutritionLog("token", sampleFood, { date: "2026-02-08", time: "10:30", mealTypeId: 2 }, fakeLog, "user-1");
      let body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.nutritionLog.mealType).toBe("BEFORE_LUNCH"); // 2 = Morning Snack

      fetchMock.mockClear();
      await createNutritionLog("token", sampleFood, { date: "2026-02-08", time: "16:30", mealTypeId: 4 }, fakeLog, "user-1");
      body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.nutritionLog.mealType).toBe("BEFORE_DINNER"); // 4 = Afternoon Snack
    });

    it("omits interval and mealType when timing has no time or meal", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));

      await createNutritionLog(
        "token",
        sampleFood,
        { date: "2026-02-08", time: null },
        fakeLog,
        "user-1",
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const { nutritionLog } = JSON.parse(init.body as string);
      expect(nutritionLog).not.toHaveProperty("interval");
      expect(nutritionLog).not.toHaveProperty("mealType");
    });
  });

  // ─── deleteNutritionLogs ─────────────────────────────────────────────────────

  describe("deleteNutritionLogs", () => {
    it("makes a single batchDelete POST with full dataPoint resource names", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

      await deleteNutritionLogs("token", ["id-1", "id-2"], fakeLog, "user-1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("dataTypes/nutrition-log/dataPoints:batchDelete");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.names).toEqual([
        "users/me/dataTypes/nutrition-log/dataPoints/id-1",
        "users/me/dataTypes/nutrition-log/dataPoints/id-2",
      ]);
    });

    it("resolves without throwing on 404 by default / cleanup mode (already-deleted idempotency)", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

      await expect(
        deleteNutritionLogs("token", ["id-gone"], fakeLog, "user-1"),
      ).resolves.toBeUndefined();

      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
      await expect(
        deleteNutritionLogs("token", ["id-gone"], fakeLog, "user-1", "cleanup"),
      ).resolves.toBeUndefined();
    });

    it("throws HEALTH_LOG_NOT_FOUND on 404 for a user-initiated delete (drift must surface, not be swallowed)", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

      await expect(
        deleteNutritionLogs("token", ["id-gone"], fakeLog, "user-1", "user"),
      ).rejects.toThrow("HEALTH_LOG_NOT_FOUND");
    });

    it("throws HEALTH_BAD_REQUEST on 4xx non-404 response", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 400 }));

      await expect(
        deleteNutritionLogs("token", ["id-1"], fakeLog, "user-1"),
      ).rejects.toThrow("HEALTH_BAD_REQUEST");
    });

    it("does not call fetch when HEALTH_DRY_RUN=true", async () => {
      vi.stubEnv("HEALTH_DRY_RUN", "true");

      await deleteNutritionLogs("token", ["id-1"], fakeLog, "user-1");

      expect(fetchMock).not.toHaveBeenCalled();
      vi.stubEnv("HEALTH_DRY_RUN", ""); // reset for next tests
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

  // ─── getHealthProfile ────────────────────────────────────────────────────────

  describe("getHealthProfile", () => {
    // v4: the Profile resource exposes only `age`; height is the separate `height`
    // data type (a SECOND fetch); sex is not exposed → NA. (FOO-1115)
    const heightResp = () => makeJsonResponse({ dataPoints: [{ height: { heightMillimeters: "1800" } }] });

    it("uses the v4 /users/me/profile resource with Bearer auth", async () => {
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse({ age: 36 }))
        .mockResolvedValueOnce(heightResp());

      await getHealthProfile("my-access-token", fakeLog, "user-1");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/v4/users/me/profile");
      const headers = init.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer my-access-token");
    });

    it("reads ageYears from the profile's age field", async () => {
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse({ age: 36 }))
        .mockResolvedValueOnce(heightResp());
      const result = await getHealthProfile("token", fakeLog, "user-1");
      expect(result.ageYears).toBe(36);
    });

    it("defaults sex to NA (the v4 profile does not expose sex)", async () => {
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse({ age: 30 }))
        .mockResolvedValueOnce(heightResp());
      const result = await getHealthProfile("token", fakeLog, "user-1");
      expect(result.sex).toBe("NA");
    });

    it("reads height (cm) from the height data type (meters → cm)", async () => {
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse({ age: 30 }))
        .mockResolvedValueOnce(makeJsonResponse({ dataPoints: [{ height: { heightMillimeters: "1800" } }] }));
      const result = await getHealthProfile("token", fakeLog, "user-1");
      expect(result.heightCm).toBeCloseTo(180, 1);
      const [heightUrl] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(heightUrl).toContain("dataTypes/height/dataPoints");
    });

    it("throws HEALTH_API_ERROR when the profile has no age — and logs the raw shape", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ unexpectedField: "x" }));
      await expect(
        getHealthProfile("token", fakeLog, "user-1"),
      ).rejects.toThrow("HEALTH_API_ERROR");

      // An unexpected live shape must be diagnosable, not a blind error.
      const log = errorMock.mock.calls.find(
        (c) => (c[0] as { action?: string })?.action === "health_get_profile_unparseable",
      );
      expect(log).toBeDefined();
      expect((log![0] as { rawProfile: unknown }).rawProfile).toEqual({ unexpectedField: "x" });
    });

    it("returns heightCm: null when height is unavailable (404 on the height data type, no throw)", async () => {
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse({ age: 30 }))
        .mockResolvedValueOnce(new Response(null, { status: 404 }));
      const result = await getHealthProfile("token", fakeLog, "user-1");
      expect(result).toEqual({ ageYears: 30, sex: "NA", heightCm: null });
    });

    it("returns heightCm: null when the height data type has no dataPoints (no throw)", async () => {
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse({ age: 42 }))
        .mockResolvedValueOnce(makeJsonResponse({ dataPoints: [] }));
      const result = await getHealthProfile("token", fakeLog, "user-1");
      expect(result.heightCm).toBeNull();
      expect(result.ageYears).toBe(42);
    });

    it("throws HEALTH_TOKEN_INVALID on 401", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
      await expect(
        getHealthProfile("token", fakeLog, "user-1"),
      ).rejects.toThrow("HEALTH_TOKEN_INVALID");
    });

    it("throws HEALTH_BAD_REQUEST on 4xx non-ok (400)", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
      await expect(
        getHealthProfile("token", fakeLog, "user-1"),
      ).rejects.toThrow("HEALTH_BAD_REQUEST");
    });
  });

  // ─── getHealthLatestWeightKg ──────────────────────────────────────────────────

  describe("getHealthLatestWeightKg", () => {
    it("makes ONE GET to the v4 weight dataPoints collection", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ dataPoints: [] }));

      await getHealthLatestWeightKg("token", "2026-05-31", fakeLog, "user-1");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("dataTypes/weight/dataPoints");
    });

    it("returns the most-recent sample on/before targetDate (weight.kilograms)", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        dataPoints: [
          { weight: { weightGrams: 80000, sampleTime: { physicalTime: "2026-05-25T07:00:00Z" } } }, // older
          { weight: { weightGrams: 79500, sampleTime: { physicalTime: "2026-05-30T07:00:00Z" } } }, // more recent
        ],
      }));

      const result = await getHealthLatestWeightKg("token", "2026-05-31", fakeLog, "user-1");
      expect(result).toEqual({ weightKg: 79.5, loggedDate: "2026-05-30" });
    });

    it("returns null on empty dataPoints", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ dataPoints: [] }));
      const result = await getHealthLatestWeightKg("token", "2026-05-31", fakeLog, "user-1");
      expect(result).toBeNull();
    });

    it("excludes weight samples after targetDate (physicalTime object form)", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        dataPoints: [
          { weight: { weightGrams: 80000, sampleTime: { physicalTime: "2026-06-01T07:00:00Z" } } }, // after target — excluded
        ],
      }));

      const result = await getHealthLatestWeightKg("token", "2026-05-31", fakeLog, "user-1");
      expect(result).toBeNull();
    });

    it("tolerates a bare RFC3339 string sampleTime (extractSampleDate fallback)", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        dataPoints: [
          { weight: { weightGrams: 79500, sampleTime: "2026-05-30T07:00:00Z" } },
        ],
      }));

      const result = await getHealthLatestWeightKg("token", "2026-05-31", fakeLog, "user-1");
      expect(result).toEqual({ weightKg: 79.5, loggedDate: "2026-05-30" });
    });

    it("excludes weight samples before the 14-day window", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        dataPoints: [
          { weight: { weightGrams: 80000, sampleTime: { physicalTime: "2026-05-10T07:00:00Z" } } }, // > 13 days before target
        ],
      }));

      const result = await getHealthLatestWeightKg("token", "2026-05-31", fakeLog, "user-1");
      expect(result).toBeNull();
    });

    it("logs the 14-day window (not '7 days')", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ dataPoints: [] }));

      await getHealthLatestWeightKg("token", "2026-05-31", fakeLog, "user-1");

      // Should NOT log '7 days' — it logs 14-day window
      const warnCalls = warnMock.mock.calls.concat(debugMock.mock.calls).concat(infoMock.mock.calls);
      const logMessages = warnCalls.map((call) => JSON.stringify(call));
      const hasSevenDays = logMessages.some((m) => m.includes("7 days"));
      expect(hasSevenDays).toBe(false);
    });

    it("throws HEALTH_TOKEN_INVALID on 401", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
      await expect(
        getHealthLatestWeightKg("token", "2026-05-31", fakeLog, "user-1"),
      ).rejects.toThrow("HEALTH_TOKEN_INVALID");
    });
  });

  // ─── getHealthActivitySummary ─────────────────────────────────────────────────

  describe("getHealthActivitySummary", () => {
    it("POSTs a dailyRollUp with range.start/range.end (closed-open, end = next civil day) + windowSizeDays", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ rollupDataPoints: [{ totalCalories: { kcalSum: 2345 } }] }));

      await getHealthActivitySummary("token", "2026-05-31", fakeLog, "user-1");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("dataTypes/total-calories/dataPoints:dailyRollUp");
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        range: {
          start: { date: { year: 2026, month: 5, day: 31 } },
          // exclusive end → the next civil day (crosses the month boundary correctly)
          end: { date: { year: 2026, month: 6, day: 1 } },
        },
        windowSizeDays: 1,
      });
    });

    it("sums kcalSum from the v4 rollupDataPoints[] into { caloriesOut }", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        rollupDataPoints: [{ totalCalories: { kcalSum: 2345.4 } }],
      }));

      const result = await getHealthActivitySummary("token", "2026-05-31", fakeLog, "user-1");
      expect(result.caloriesOut).toBe(2345); // Math.round
    });

    it("reads ONLY totalCalories.kcalSum, not other kcalSum fields on the same point", async () => {
      // A DailyRollupDataPoint can carry several kcalSum leaves; calories-out is strictly
      // totalCalories.kcalSum — never activeEnergyBurned or nutritionLog.energy.
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          rollupDataPoints: [
            {
              activeEnergyBurned: { kcalSum: 99 },
              nutritionLog: { energy: { kcalSum: 1800 } },
              totalCalories: { kcalSum: 2500 },
            },
          ],
        }),
      );

      const result = await getHealthActivitySummary("token", "2026-05-31", fakeLog, "user-1");
      expect(result.caloriesOut).toBe(2500);
    });

    it("sums kcalSum across multiple rollup points", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({
        rollupDataPoints: [
          { totalCalories: { kcalSum: 1200 } },
          { totalCalories: { kcalSum: 1000 } },
        ],
      }));

      const result = await getHealthActivitySummary("token", "2026-05-31", fakeLog, "user-1");
      expect(result.caloriesOut).toBe(2200);
    });

    it("returns { caloriesOut: null } on empty roll-up (no throw) — and logs the raw response", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ rollupDataPoints: [{}] }));

      const result = await getHealthActivitySummary("token", "2026-05-31", fakeLog, "user-1");
      expect(result.caloriesOut).toBeNull();

      // Empty must be distinguishable from a shape mismatch — raw response is logged.
      const log = debugMock.mock.calls.find(
        (c) => (c[0] as { action?: string })?.action === "health_get_activity_summary_empty",
      );
      expect(log).toBeDefined();
      expect((log![0] as { rawResponse: unknown }).rawResponse).toEqual({ rollupDataPoints: [{}] });
    });

    it("returns { caloriesOut: null } on absent roll-up", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({}));

      const result = await getHealthActivitySummary("token", "2026-05-31", fakeLog, "user-1");
      expect(result.caloriesOut).toBeNull();
    });

    it("throws HEALTH_TOKEN_INVALID on 401", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
      await expect(
        getHealthActivitySummary("token", "2026-05-31", fakeLog, "user-1"),
      ).rejects.toThrow("HEALTH_TOKEN_INVALID");
    });

    it("throws HEALTH_BAD_REQUEST on 4xx non-ok (400)", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
      await expect(
        getHealthActivitySummary("token", "2026-05-31", fakeLog, "user-1"),
      ).rejects.toThrow("HEALTH_BAD_REQUEST");
    });

    it("includes utcOffset in CivilDateTime range when zoneOffset is provided", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ rollupDataPoints: [] }));

      await getHealthActivitySummary("token", "2026-02-08", fakeLog, "user-1", "optional", "-03:00");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      // Civil day 2026-02-08 in -03:00 timezone: utcOffset = "-10800s" (−3h in seconds)
      expect(body.range.start).toEqual({ date: { year: 2026, month: 2, day: 8 }, utcOffset: "-10800s" });
      expect(body.range.end).toEqual({ date: { year: 2026, month: 2, day: 9 }, utcOffset: "-10800s" });
    });

    it("omits utcOffset when no zoneOffset is provided (backward-compatible)", async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ rollupDataPoints: [] }));

      await getHealthActivitySummary("token", "2026-05-31", fakeLog, "user-1");

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string);
      expect(body.range.start).not.toHaveProperty("utcOffset");
      expect(body.range.end).not.toHaveProperty("utcOffset");
    });
  });

  // ─── timezone alignment (round-trip date-boundary test) ───────────────────

  describe("timezone alignment: meal-write instant and rollup query agree on civil day", () => {
    it("23:30 meal at -03:00 — write instant on 2026-02-08 and rollup range covers the same civil day", async () => {
      // Step 1: Create a nutrition log at 23:30 local time in -03:00 timezone
      // UTC instant: 2026-02-09T02:30:00Z (next-day UTC), but LOCAL date = 2026-02-08
      fetchMock.mockResolvedValue(makeJsonResponse({ name: "op/1" }));
      const lateBoundaryTiming = {
        date: "2026-02-08",
        time: "23:30:00",
        zoneOffset: "-03:00",
        mealTypeId: 5,
      };
      await createNutritionLog("token", sampleFood, lateBoundaryTiming, fakeLog, "user-1");

      const [, writeInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const writeBody = JSON.parse(writeInit.body as string);
      // Write instant must use the LOCAL date (2026-02-08) with the zone offset
      expect(writeBody.nutritionLog.interval.startTime).toBe("2026-02-08T23:30:00-03:00");

      // Step 2: Query activity rollup for the same local date with zone offset
      fetchMock.mockResolvedValue(makeJsonResponse({ rollupDataPoints: [] }));
      await getHealthActivitySummary("token", "2026-02-08", fakeLog, "user-1", "optional", "-03:00");

      const [, rollupInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      const rollupBody = JSON.parse(rollupInit.body as string);
      // Rollup range for civil day 2026-02-08 in -03:00:
      //   UTC coverage = [2026-02-08T03:00Z, 2026-02-09T03:00Z)
      //   The meal UTC instant 2026-02-09T02:30Z falls WITHIN this range ✓
      expect(rollupBody.range.start).toEqual({ date: { year: 2026, month: 2, day: 8 }, utcOffset: "-10800s" });
      expect(rollupBody.range.end).toEqual({ date: { year: 2026, month: 2, day: 9 }, utcOffset: "-10800s" });
    });
  });
});
