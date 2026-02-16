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

const { GET } = await import("@/app/api/v1/nutrition-summary/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/v1/nutrition-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns nutrition summary for valid API key and date", async () => {
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
          ],
          subtotal: {
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
        },
      ],
      totals: {
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
    };

    mockGetDailyNutritionSummary.mockResolvedValue(mockSummary);

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockSummary);
    expect(mockValidateApiRequest).toHaveBeenCalledWith(request);
    expect(mockGetDailyNutritionSummary).toHaveBeenCalledWith("user-123", "2026-02-11");
  });

  it("returns 401 for missing API key", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Not authenticated" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest("http://localhost:3000/api/v1/nutrition-summary?date=2026-02-11");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 401 for invalid API key", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-summary?date=2026-02-11",
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
      "http://localhost:3000/api/v1/nutrition-summary",
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
      "http://localhost:3000/api/v1/nutrition-summary?date=invalid-date",
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
      "http://localhost:3000/api/v1/nutrition-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-summary?date=2026-02-11",
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
      "http://localhost:3000/api/v1/nutrition-summary?date=2026-02-11",
      { Authorization: "Bearer test-api-key-456" }
    );
    await GET(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "v1:nutrition-summary:test-api-key-456",
      60,
      60000
    );
  });
});
