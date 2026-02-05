import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FoodLogRequest, SessionData } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

// Mock iron-session
vi.mock("iron-session", () => ({
  getIronSession: vi.fn(),
}));

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
  }),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Fitbit API functions
const mockFindOrCreateFood = vi.fn();
const mockLogFood = vi.fn();
const mockEnsureFreshToken = vi.fn();
vi.mock("@/lib/fitbit", () => ({
  findOrCreateFood: mockFindOrCreateFood,
  logFood: mockLogFood,
  ensureFreshToken: mockEnsureFreshToken,
}));

const { getIronSession } = await import("iron-session");
const { POST } = await import("@/app/api/log-food/route");

const mockGetIronSession = vi.mocked(getIronSession);

const validSession: SessionData = {
  sessionId: "test-session",
  email: "wall.lucas@gmail.com",
  createdAt: Date.now(),
  expiresAt: Date.now() + 86400000,
  fitbit: {
    accessToken: "token",
    refreshToken: "refresh",
    userId: "user-123",
    expiresAt: Date.now() + 28800000,
  },
};

const validFoodLogRequest: FoodLogRequest = {
  food_name: "Test Food",
  portion_size_g: 100,
  calories: 150,
  protein_g: 10,
  carbs_g: 20,
  fat_g: 5,
  fiber_g: 3,
  sodium_mg: 200,
  confidence: "high",
  notes: "Test notes",
  mealTypeId: 1,
};

function createMockRequest(body: Partial<FoodLogRequest>): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/log-food", () => {
  it("returns 401 for missing session", async () => {
    mockGetIronSession.mockResolvedValue({
      save: vi.fn(),
    } as never);

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 401 AUTH_SESSION_EXPIRED for expired session", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "wall.lucas@gmail.com",
      createdAt: Date.now() - 86400000,
      expiresAt: Date.now() - 1000, // Expired 1 second ago
      fitbit: {
        accessToken: "token",
        refreshToken: "refresh",
        userId: "user-123",
        expiresAt: Date.now() + 28800000,
      },
      save: vi.fn(),
    } as never);

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_SESSION_EXPIRED");
  });

  it("returns 400 FITBIT_NOT_CONNECTED if no Fitbit tokens", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "wall.lucas@gmail.com",
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      save: vi.fn(),
    } as never);

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_NOT_CONNECTED");
  });

  it("returns 400 VALIDATION_ERROR for invalid mealTypeId", async () => {
    mockGetIronSession.mockResolvedValue({
      ...validSession,
      save: vi.fn(),
    } as never);

    const request = createMockRequest({
      ...validFoodLogRequest,
      mealTypeId: 6, // Invalid - 6 is not a valid meal type (valid: 1,2,3,4,5,7)
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("mealTypeId");
  });

  it("returns 400 VALIDATION_ERROR for missing required FoodAnalysis fields", async () => {
    mockGetIronSession.mockResolvedValue({
      ...validSession,
      save: vi.fn(),
    } as never);

    const request = createMockRequest({
      mealTypeId: 1,
      // Missing food_name, calories, etc.
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 200 with FoodLogResponse on success", async () => {
    const mockSave = vi.fn();
    mockGetIronSession.mockResolvedValue({
      ...validSession,
      save: mockSave,
    } as never);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.fitbitFoodId).toBe(123);
    expect(body.data.fitbitLogId).toBe(456);
    expect(body.data.reusedFood).toBe(false);
  });

  it("returns 500 FITBIT_API_ERROR on Fitbit failure", async () => {
    mockGetIronSession.mockResolvedValue({
      ...validSession,
      save: vi.fn(),
    } as never);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockRejectedValue(new Error("FITBIT_API_ERROR"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_API_ERROR");
  });

  it("returns 401 FITBIT_TOKEN_INVALID triggers reconnect prompt", async () => {
    mockGetIronSession.mockResolvedValue({
      ...validSession,
      save: vi.fn(),
    } as never);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_TOKEN_INVALID"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_TOKEN_INVALID");
    expect(body.error.message).toContain("reconnect");
  });

  it("saves session after token refresh", async () => {
    const mockSave = vi.fn();
    const sessionWithSave = {
      ...validSession,
      save: mockSave,
    };
    mockGetIronSession.mockResolvedValue(sessionWithSave as never);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });

    const request = createMockRequest(validFoodLogRequest);
    await POST(request);

    // Session should be saved to persist any token refresh
    expect(mockSave).toHaveBeenCalled();
  });

  it("returns reusedFood=false when food is logged", async () => {
    mockGetIronSession.mockResolvedValue({
      ...validSession,
      save: vi.fn(),
    } as never);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 111, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 222, loggedFood: { foodId: 111 } },
    });

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.reusedFood).toBe(false);
  });

  it("validates all valid meal type IDs", async () => {
    const validMealTypeIds = [1, 2, 3, 4, 5, 7];

    for (const mealTypeId of validMealTypeIds) {
      vi.clearAllMocks();
      mockGetIronSession.mockResolvedValue({
        ...validSession,
        save: vi.fn(),
      } as never);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 456, loggedFood: { foodId: 123 } },
      });

      const request = createMockRequest({
        ...validFoodLogRequest,
        mealTypeId,
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    }
  });

  it("uses provided date in logFood call", async () => {
    mockGetIronSession.mockResolvedValue({
      ...validSession,
      save: vi.fn(),
    } as never);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });

    const request = createMockRequest({
      ...validFoodLogRequest,
      date: "2024-01-15",
    });
    await POST(request);

    expect(mockLogFood).toHaveBeenCalledWith(
      "fresh-token",
      123,
      1,
      100, // portion_size_g from validFoodLogRequest
      "2024-01-15",
      undefined
    );
  });

  it("uses current date when date not provided", async () => {
    mockGetIronSession.mockResolvedValue({
      ...validSession,
      save: vi.fn(),
    } as never);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });

    const request = createMockRequest(validFoodLogRequest);
    await POST(request);

    // Should use today's date format YYYY-MM-DD
    expect(mockLogFood).toHaveBeenCalledWith(
      "fresh-token",
      123,
      1,
      100, // portion_size_g from validFoodLogRequest
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      undefined
    );
  });

  it("returns 400 VALIDATION_ERROR for invalid date format", async () => {
    // Test formats that don't match YYYY-MM-DD pattern
    const invalidDates = ["invalid-date", "01-15-2024", "2024/01/15", "2024-1-15", "24-01-15"];

    for (const date of invalidDates) {
      vi.clearAllMocks();
      mockGetIronSession.mockResolvedValue({
        ...validSession,
        save: vi.fn(),
      } as never);

      const request = createMockRequest({
        ...validFoodLogRequest,
        date,
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("date");
    }
  });

  it("returns 400 VALIDATION_ERROR for invalid time format", async () => {
    // Test formats that don't match HH:mm:ss pattern
    const invalidTimes = ["invalid-time", "12:00", "12:00:00:00", "1:00:00", "12:0:00"];

    for (const time of invalidTimes) {
      vi.clearAllMocks();
      mockGetIronSession.mockResolvedValue({
        ...validSession,
        save: vi.fn(),
      } as never);

      const request = createMockRequest({
        ...validFoodLogRequest,
        time,
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("time");
    }
  });

  it("accepts valid date and time formats", async () => {
    mockGetIronSession.mockResolvedValue({
      ...validSession,
      save: vi.fn(),
    } as never);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });

    const request = createMockRequest({
      ...validFoodLogRequest,
      date: "2024-01-15",
      time: "12:30:00",
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockLogFood).toHaveBeenCalledWith(
      "fresh-token",
      123,
      1,
      100, // portion_size_g from validFoodLogRequest
      "2024-01-15",
      "12:30:00"
    );
  });
});
