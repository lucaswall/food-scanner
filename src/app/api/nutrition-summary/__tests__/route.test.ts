import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, NutritionSummary } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (
    session: FullSession | null,
    options?: { requireFitbit?: boolean },
  ): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      );
    }
    if (options?.requireFitbit && !session.fitbitConnected) {
      return Response.json(
        { success: false, error: { code: "FITBIT_NOT_CONNECTED", message: "Fitbit account not connected" }, timestamp: Date.now() },
        { status: 400 },
      );
    }
    if (options?.requireFitbit && !session.hasFitbitCredentials) {
      return Response.json(
        { success: false, error: { code: "FITBIT_CREDENTIALS_MISSING", message: "Fitbit credentials not configured" }, timestamp: Date.now() },
        { status: 400 },
      );
    }
    return null;
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetDailyNutritionSummary = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getDailyNutritionSummary: (...args: unknown[]) => mockGetDailyNutritionSummary(...args),
}));

const { GET } = await import("@/app/api/nutrition-summary/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

function createRequest(url: string): Request {
  return new Request(url);
}

describe("GET /api/nutrition-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns aggregated nutrition totals for valid date", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockSummary: NutritionSummary = {
      date: "2024-01-15",
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

    const request = createRequest("http://localhost:3000/api/nutrition-summary?date=2024-01-15");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockSummary);
    expect(mockGetDailyNutritionSummary).toHaveBeenCalledWith("user-uuid-123", "2024-01-15");
  });

  it("returns entries grouped by meal type with per-meal subtotals", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockSummary: NutritionSummary = {
      date: "2024-01-15",
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
        {
          mealTypeId: 2,
          entries: [
            {
              id: 2,
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
        calories: 500,
        proteinG: 35,
        carbsG: 42,
        fatG: 21,
        fiberG: 9,
        sodiumMg: 450,
        saturatedFatG: 3.5,
        transFatG: 0,
        sugarsG: 5,
        caloriesFromFat: 189,
      },
    };

    mockGetDailyNutritionSummary.mockResolvedValue(mockSummary);

    const request = createRequest("http://localhost:3000/api/nutrition-summary?date=2024-01-15");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.meals).toHaveLength(2);
    expect(data.data.meals[0].mealTypeId).toBe(1);
    expect(data.data.meals[0].subtotal.calories).toBe(150);
    expect(data.data.meals[1].mealTypeId).toBe(2);
    expect(data.data.meals[1].subtotal.calories).toBe(350);
    expect(data.data.totals.calories).toBe(500);
  });

  it("returns 400 VALIDATION_ERROR for invalid date format", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createRequest("http://localhost:3000/api/nutrition-summary?date=invalid-date");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Invalid date format. Use YYYY-MM-DD");
  });

  it("returns 400 VALIDATION_ERROR for missing date parameter", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createRequest("http://localhost:3000/api/nutrition-summary");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Missing date parameter");
  });

  it("returns 401 AUTH_MISSING_SESSION when session is missing", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createRequest("http://localhost:3000/api/nutrition-summary?date=2024-01-15");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
    expect(data.error.message).toBe("No active session");
  });

  it("returns zero totals and empty meals for date with no entries", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockSummary: NutritionSummary = {
      date: "2024-01-15",
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

    const request = createRequest("http://localhost:3000/api/nutrition-summary?date=2024-01-15");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.meals).toEqual([]);
    expect(data.data.totals.calories).toBe(0);
    expect(data.data.totals.proteinG).toBe(0);
  });

  it("includes Tier 1 nutrients in aggregation when available", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockSummary: NutritionSummary = {
      date: "2024-01-15",
      meals: [
        {
          mealTypeId: 1,
          entries: [
            {
              id: 1,
              foodName: "Yogurt",
              time: "08:00:00",
              calories: 120,
              proteinG: 10,
              carbsG: 15,
              fatG: 2.5,
              fiberG: 0,
              sodiumMg: 75,
              saturatedFatG: 1.5,
              transFatG: 0,
              sugarsG: 12,
              caloriesFromFat: 22,
            },
          ],
          subtotal: {
            calories: 120,
            proteinG: 10,
            carbsG: 15,
            fatG: 2.5,
            fiberG: 0,
            sodiumMg: 75,
            saturatedFatG: 1.5,
            transFatG: 0,
            sugarsG: 12,
            caloriesFromFat: 22,
          },
        },
      ],
      totals: {
        calories: 120,
        proteinG: 10,
        carbsG: 15,
        fatG: 2.5,
        fiberG: 0,
        sodiumMg: 75,
        saturatedFatG: 1.5,
        transFatG: 0,
        sugarsG: 12,
        caloriesFromFat: 22,
      },
    };

    mockGetDailyNutritionSummary.mockResolvedValue(mockSummary);

    const request = createRequest("http://localhost:3000/api/nutrition-summary?date=2024-01-15");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.totals.saturatedFatG).toBe(1.5);
    expect(data.data.totals.transFatG).toBe(0);
    expect(data.data.totals.sugarsG).toBe(12);
    expect(data.data.totals.caloriesFromFat).toBe(22);
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockSummary: NutritionSummary = {
      date: "2024-01-15",
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

    const request = createRequest("http://localhost:3000/api/nutrition-summary?date=2024-01-15");
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 500 INTERNAL_ERROR when getDailyNutritionSummary throws", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetDailyNutritionSummary.mockRejectedValue(new Error("Database connection failed"));

    const request = createRequest("http://localhost:3000/api/nutrition-summary?date=2024-01-15");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
    expect(data.error.message).toBe("Failed to retrieve nutrition summary");
  });
});
