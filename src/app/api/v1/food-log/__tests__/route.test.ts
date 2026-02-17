import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NutritionSummary } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockValidateApiRequest = vi.fn();
vi.mock("@/lib/api-auth", () => ({
  validateApiRequest: (...args: unknown[]) => mockValidateApiRequest(...args),
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const mockGetDailyNutritionSummary = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getDailyNutritionSummary: (...args: unknown[]) => mockGetDailyNutritionSummary(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { GET } = await import("@/app/api/v1/food-log/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/v1/food-log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns food log entries for valid API key and date", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const mockSummary: NutritionSummary = {
      date: "2026-02-11",
      meals: [
        {
          mealTypeId: 1,
          entries: [
            {
              id: 1,
              customFoodId: 1,
              foodName: "Oatmeal",
              time: "08:00:00",
              calories: 150,
              proteinG: 5,
              carbsG: 27,
              fatG: 3,
              fiberG: 4,
              sodiumMg: 0,
              saturatedFatG: 0.5,
              transFatG: 0,
              sugarsG: 1,
              caloriesFromFat: 27,
            },
            {
              id: 2,
              customFoodId: 2,
              foodName: "Banana",
              time: "08:15:00",
              calories: 105,
              proteinG: 1,
              carbsG: 27,
              fatG: 0,
              fiberG: 3,
              sodiumMg: 1,
              saturatedFatG: 0,
              transFatG: 0,
              sugarsG: 14,
              caloriesFromFat: 0,
            },
          ],
          subtotal: {
            calories: 255,
            proteinG: 6,
            carbsG: 54,
            fatG: 3,
            fiberG: 7,
            sodiumMg: 1,
            saturatedFatG: 0.5,
            transFatG: 0,
            sugarsG: 15,
            caloriesFromFat: 27,
          },
        },
        {
          mealTypeId: 3,
          entries: [
            {
              id: 3,
              customFoodId: 3,
              foodName: "Chicken Salad",
              time: "12:30:00",
              calories: 350,
              proteinG: 30,
              carbsG: 15,
              fatG: 18,
              fiberG: 5,
              sodiumMg: 450,
              saturatedFatG: 3,
              transFatG: 0,
              sugarsG: 4,
              caloriesFromFat: 162,
            },
          ],
          subtotal: {
            calories: 350,
            proteinG: 30,
            carbsG: 15,
            fatG: 18,
            fiberG: 5,
            sodiumMg: 450,
            saturatedFatG: 3,
            transFatG: 0,
            sugarsG: 4,
            caloriesFromFat: 162,
          },
        },
      ],
      totals: {
        calories: 605,
        proteinG: 36,
        carbsG: 69,
        fatG: 21,
        fiberG: 12,
        sodiumMg: 451,
        saturatedFatG: 3.5,
        transFatG: 0,
        sugarsG: 19,
        caloriesFromFat: 189,
      },
    };

    mockGetDailyNutritionSummary.mockResolvedValue(mockSummary);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-log?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.date).toBe("2026-02-11");
    expect(data.data.meals).toHaveLength(2);
    expect(data.data.meals[0].entries).toHaveLength(2);
    expect(data.data.meals[1].entries).toHaveLength(1);
    expect(mockValidateApiRequest).toHaveBeenCalledWith(request);
    expect(mockGetDailyNutritionSummary).toHaveBeenCalledWith("user-123", "2026-02-11", expect.anything());
  });

  it("returns empty meals array for date with no entries", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const mockSummary: NutritionSummary = {
      date: "2026-02-11",
      meals: [],
      totals: {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sodiumMg: 0,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
    };

    mockGetDailyNutritionSummary.mockResolvedValue(mockSummary);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-log?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.meals).toEqual([]);
  });

  it("returns 401 for invalid API key", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-log?date=2026-02-11",
      { Authorization: "Bearer invalid-key" }
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 for missing date parameter", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/food-log",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Missing date parameter");
  });

  it("returns 400 for invalid date format", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/food-log?date=2026-13-45",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Invalid date format. Use YYYY-MM-DD");
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const mockSummary: NutritionSummary = {
      date: "2026-02-11",
      meals: [],
      totals: {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sodiumMg: 0,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
    };

    mockGetDailyNutritionSummary.mockResolvedValue(mockSummary);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-log?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const request = createRequest(
      "http://localhost:3000/api/v1/food-log?date=2026-02-11",
      { Authorization: "Bearer test-api-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.error.message).toMatch(/too many requests/i);
  });

  it("uses API key as rate limit key with 60 req/min for DB-only route", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const mockSummary: NutritionSummary = {
      date: "2026-02-11",
      meals: [],
      totals: {
        calories: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        fiberG: 0,
        sodiumMg: 0,
        saturatedFatG: 0,
        transFatG: 0,
        sugarsG: 0,
        caloriesFromFat: 0,
      },
    };

    mockGetDailyNutritionSummary.mockResolvedValue(mockSummary);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-log?date=2026-02-11",
      { Authorization: "Bearer test-api-key-123" }
    );
    await GET(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "v1:food-log:test-api-key-123",
      60,
      60000
    );
  });
});
