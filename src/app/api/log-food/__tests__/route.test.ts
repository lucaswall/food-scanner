import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FoodLogRequest, FullSession } from "@/types";

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

// Mock logger
vi.mock("@/lib/logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

// Mock Fitbit API functions
const mockFindOrCreateFood = vi.fn();
const mockLogFood = vi.fn();
const mockEnsureFreshToken = vi.fn();
const mockDeleteFoodLog = vi.fn();
vi.mock("@/lib/fitbit", () => ({
  findOrCreateFood: mockFindOrCreateFood,
  logFood: mockLogFood,
  ensureFreshToken: mockEnsureFreshToken,
  deleteFoodLog: (...args: unknown[]) => mockDeleteFoodLog(...args),
}));

// Mock food-log DB module
const mockInsertCustomFood = vi.fn();
const mockInsertFoodLogEntry = vi.fn();
const mockGetCustomFoodById = vi.fn();
const mockUpdateCustomFoodMetadata = vi.fn();
vi.mock("@/lib/food-log", () => ({
  insertCustomFood: (...args: unknown[]) => mockInsertCustomFood(...args),
  insertFoodLogEntry: (...args: unknown[]) => mockInsertFoodLogEntry(...args),
  getCustomFoodById: (...args: unknown[]) => mockGetCustomFoodById(...args),
  updateCustomFoodMetadata: (...args: unknown[]) => mockUpdateCustomFoodMetadata(...args),
}));

const { POST } = await import("@/app/api/log-food/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

const validFoodLogRequest: FoodLogRequest = {
  food_name: "Test Food",
  amount: 100,
  unit_id: 147,
  calories: 150,
  protein_g: 10,
  carbs_g: 20,
  fat_g: 5,
  fiber_g: 3,
  sodium_mg: 200,
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high",
  notes: "Test notes",
  description: "Test description",
  keywords: ["test", "food"],
  mealTypeId: 1,
  date: "2026-02-07",
  time: "12:30:00",
};

function createMockRequest(body: Partial<FoodLogRequest>): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertCustomFood.mockResolvedValue({ id: 1, createdAt: new Date() });
  mockInsertFoodLogEntry.mockResolvedValue({ id: 1, loggedAt: new Date() });
});

describe("POST /api/log-food", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 FITBIT_NOT_CONNECTED if no Fitbit tokens", async () => {
    mockGetSession.mockResolvedValue({
      ...validSession,
      fitbitConnected: false,
    });

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_NOT_CONNECTED");
  });

  it("returns 400 VALIDATION_ERROR for invalid mealTypeId", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      ...validFoodLogRequest,
      mealTypeId: 6,
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("mealTypeId");
  });

  it("returns 400 VALIDATION_ERROR for missing unit_id", async () => {
    mockGetSession.mockResolvedValue(validSession);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { unit_id, ...requestWithoutUnitId } = validFoodLogRequest;
    const request = createMockRequest(requestWithoutUnitId as Partial<FoodLogRequest>);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for missing required FoodAnalysis fields", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      mealTypeId: 1,
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 200 with FoodLogResponse on success", async () => {
    mockGetSession.mockResolvedValue(validSession);
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

  it("passes userId to ensureFreshToken", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });

    const request = createMockRequest(validFoodLogRequest);
    await POST(request);

    expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-uuid-123", expect.any(Object));
  });

  it("returns 500 FITBIT_API_ERROR on Fitbit failure", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockRejectedValue(new Error("FITBIT_API_ERROR"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_API_ERROR");
  });

  it("returns 424 FITBIT_CREDENTIALS_MISSING when ensureFreshToken throws FITBIT_CREDENTIALS_MISSING", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_CREDENTIALS_MISSING"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(424);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_CREDENTIALS_MISSING");
    expect(body.error.message).toContain("credentials");
  });

  it("returns 401 FITBIT_TOKEN_INVALID triggers reconnect prompt", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_TOKEN_INVALID"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_TOKEN_INVALID");
    expect(body.error.message).toContain("reconnect");
  });

  it("returns 504 FITBIT_TIMEOUT when request times out (FOO-426)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_TIMEOUT"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_TIMEOUT");
    expect(body.error.message).toContain("timed out");
  });

  it("returns reusedFood=false when food is logged", async () => {
    mockGetSession.mockResolvedValue(validSession);
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
      mockGetSession.mockResolvedValue(validSession);
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

  it("passes client-provided date and time to logFood", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });

    const request = createMockRequest({
      ...validFoodLogRequest,
      date: "2024-01-15",
      time: "20:30:00",
    });
    await POST(request);

    expect(mockLogFood).toHaveBeenCalledWith(
      "fresh-token",
      123,
      1,
      100,
      147,
      "2024-01-15",
      "20:30:00",
      expect.any(Object),
    );
  });

  it("returns 400 when date is missing", async () => {
    mockGetSession.mockResolvedValue(validSession);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { date: _date, ...requestWithoutDate } = validFoodLogRequest;
    const request = createMockRequest(requestWithoutDate as Partial<FoodLogRequest>);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when time is missing", async () => {
    mockGetSession.mockResolvedValue(validSession);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { time: _time, ...requestWithoutTime } = validFoodLogRequest;
    const request = createMockRequest(requestWithoutTime as Partial<FoodLogRequest>);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for invalid date format", async () => {
    const invalidDates = ["invalid-date", "01-15-2024", "2024/01/15", "2024-1-15", "24-01-15"];

    for (const date of invalidDates) {
      vi.clearAllMocks();
      mockGetSession.mockResolvedValue(validSession);

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
    const invalidTimes = ["invalid-time", "12:00:00:00", "1:00:00", "12:0:00", "1:00", "12:0"];

    for (const time of invalidTimes) {
      vi.clearAllMocks();
      mockGetSession.mockResolvedValue(validSession);

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

  it("returns 400 for semantically invalid dates", async () => {
    const invalidDates = ["9999-99-99", "2024-02-30", "2024-13-01", "2024-00-15"];

    for (const date of invalidDates) {
      vi.clearAllMocks();
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        ...validFoodLogRequest,
        date,
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns 400 for semantically invalid times", async () => {
    const invalidTimes = ["99:99:99", "24:00:00", "12:60:00", "12:00:60", "24:00", "12:60", "99:99"];

    for (const time of invalidTimes) {
      vi.clearAllMocks();
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        ...validFoodLogRequest,
        time,
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("accepts valid date and time formats", async () => {
    mockGetSession.mockResolvedValue(validSession);
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
      100,
      147,
      "2024-01-15",
      "12:30:00",
      expect.any(Object),
    );
  });

  it("accepts HH:mm time format without seconds", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });

    const request = createMockRequest({
      ...validFoodLogRequest,
      date: "2024-01-15",
      time: "12:30",
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockLogFood).toHaveBeenCalledWith(
      "fresh-token",
      123,
      1,
      100,
      147,
      "2024-01-15",
      "12:30",
      expect.any(Object),
    );
  });

  it("calls insertCustomFood and insertFoodLogEntry after successful Fitbit logging", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });
    mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
    mockInsertFoodLogEntry.mockResolvedValue({ id: 10, loggedAt: new Date() });

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockInsertCustomFood).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.objectContaining({
        foodName: "Test Food",
        amount: 100,
        unitId: 147,
        calories: 150,
        proteinG: 10,
        carbsG: 20,
        fatG: 5,
        fiberG: 3,
        sodiumMg: 200,
        confidence: "high",
        notes: "Test notes",
        fitbitFoodId: 123,
      }),
    );
    expect(mockInsertFoodLogEntry).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.objectContaining({
        customFoodId: 42,
        mealTypeId: 1,
        amount: 100,
        unitId: 147,
        fitbitLogId: 456,
      }),
    );
    const body = await response.json();
    expect(body.data.foodLogId).toBe(10);
  });

  it("passes keywords through to insertCustomFood", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });
    mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
    mockInsertFoodLogEntry.mockResolvedValue({ id: 10, loggedAt: new Date() });

    const request = createMockRequest(validFoodLogRequest);
    await POST(request);

    expect(mockInsertCustomFood).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.objectContaining({
        keywords: ["test", "food"],
      }),
    );
  });

  it("returns error and compensates Fitbit when insertCustomFood fails in new food flow", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });
    mockInsertCustomFood.mockRejectedValue(new Error("DB connection failed"));
    mockDeleteFoodLog.mockResolvedValue(undefined);

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(mockDeleteFoodLog).toHaveBeenCalledWith("fresh-token", 456, expect.any(Object));
  });

  it("returns error and compensates Fitbit when insertFoodLogEntry fails in new food flow", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });
    mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
    mockInsertFoodLogEntry.mockRejectedValue(new Error("DB connection failed"));
    mockDeleteFoodLog.mockResolvedValue(undefined);

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(mockDeleteFoodLog).toHaveBeenCalledWith("fresh-token", 456, expect.any(Object));
  });

  it("returns PARTIAL_ERROR when DB fails and compensation also fails in new food flow", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });
    mockInsertCustomFood.mockRejectedValue(new Error("DB connection failed"));
    mockDeleteFoodLog.mockRejectedValue(new Error("Fitbit API error"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("PARTIAL_ERROR");
    expect(body.error.message).toContain("local save failed");
  });

  it("returns error and compensates Fitbit when insertFoodLogEntry fails in reuse flow", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockGetCustomFoodById.mockResolvedValue({
      id: 42,
      email: "user-uuid-123",
      foodName: "Tea with milk",
      amount: "1",
      unitId: 91,
      calories: 50,
      fitbitFoodId: 12345,
      confidence: "high",
      notes: null,
      keywords: ["tea", "milk"],
      createdAt: new Date("2026-02-05T12:00:00Z"),
    });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 789, loggedFood: { foodId: 12345 } },
    });
    mockInsertFoodLogEntry.mockRejectedValue(new Error("DB connection failed"));
    mockDeleteFoodLog.mockResolvedValue(undefined);

    const request = createMockRequest({
      ...validFoodLogRequest,
      reuseCustomFoodId: 42,
    });
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(mockDeleteFoodLog).toHaveBeenCalledWith("fresh-token", 789, expect.any(Object));
  });

  it("returns error without compensation in dry-run mode when DB fails", async () => {
    vi.stubEnv("FITBIT_DRY_RUN", "true");
    try {
      mockGetSession.mockResolvedValue(validSession);
      mockInsertCustomFood.mockRejectedValue(new Error("DB connection failed"));

      const request = createMockRequest(validFoodLogRequest);
      const response = await POST(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(mockDeleteFoodLog).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  describe("reuse flow with reuseCustomFoodId", () => {
    const existingFood = {
      id: 42,
      email: "user-uuid-123",
      foodName: "Tea with milk",
      amount: "1",
      unitId: 91,
      calories: 50,
      proteinG: "2",
      carbsG: "5",
      fatG: "2",
      fiberG: "0",
      sodiumMg: "30",
      fitbitFoodId: 12345,
      confidence: "high",
      notes: null,
      keywords: ["tea", "milk"],
      createdAt: new Date("2026-02-05T12:00:00Z"),
    };

    it("does NOT call findOrCreateFood when reuseCustomFoodId provided", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 789, loggedFood: { foodId: 12345 } },
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        ...validFoodLogRequest,
        reuseCustomFoodId: 42,
      });
      await POST(request);

      expect(mockFindOrCreateFood).not.toHaveBeenCalled();
      expect(mockGetCustomFoodById).toHaveBeenCalledWith("user-uuid-123", 42);
    });

    it("calls logFood with existing food's fitbitFoodId", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 789, loggedFood: { foodId: 12345 } },
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        ...validFoodLogRequest,
        reuseCustomFoodId: 42,
      });
      await POST(request);

      expect(mockLogFood).toHaveBeenCalledWith(
        "fresh-token",
        12345,
        1,
        Number(existingFood.amount),
        existingFood.unitId,
        "2026-02-07",
        "12:30:00",
        expect.any(Object),
      );
    });

    it("inserts food_log_entry referencing existing custom_food", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 789, loggedFood: { foodId: 12345 } },
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        ...validFoodLogRequest,
        reuseCustomFoodId: 42,
      });
      await POST(request);

      expect(mockInsertCustomFood).not.toHaveBeenCalled();
      expect(mockInsertFoodLogEntry).toHaveBeenCalledWith(
        "user-uuid-123",
        expect.objectContaining({
          customFoodId: 42,
          fitbitLogId: 789,
        }),
      );
    });

    it("response has reusedFood: true", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 789, loggedFood: { foodId: 12345 } },
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        ...validFoodLogRequest,
        reuseCustomFoodId: 42,
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.reusedFood).toBe(true);
    });

    it("returns error when custom food not found", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(null);

      const request = createMockRequest({
        ...validFoodLogRequest,
        reuseCustomFoodId: 999,
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns error when custom food has no fitbitFoodId", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue({ ...existingFood, fitbitFoodId: null });

      const request = createMockRequest({
        ...validFoodLogRequest,
        reuseCustomFoodId: 42,
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("accepts minimal body with reuseCustomFoodId, mealTypeId, date, and time", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 789, loggedFood: { foodId: 12345 } },
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
      } as Partial<FoodLogRequest>);
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.reusedFood).toBe(true);
      expect(mockFindOrCreateFood).not.toHaveBeenCalled();
    });

    it("without reuseCustomFoodId, flow is unchanged", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 456, loggedFood: { foodId: 123 } },
      });
      mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 10, loggedAt: new Date() });

      const request = createMockRequest(validFoodLogRequest);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockFindOrCreateFood).toHaveBeenCalled();
      expect(mockGetCustomFoodById).not.toHaveBeenCalled();
      expect(mockInsertCustomFood).toHaveBeenCalled();
    });

    it("calls updateCustomFoodMetadata when reuse request includes new metadata fields", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 789, loggedFood: { foodId: 12345 } },
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });
      mockUpdateCustomFoodMetadata.mockResolvedValue(undefined);

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
        newDescription: "Updated description",
        newNotes: "Updated notes",
        newKeywords: ["updated", "keywords"],
        newConfidence: "medium",
      } as Partial<FoodLogRequest>);
      await POST(request);

      expect(mockUpdateCustomFoodMetadata).toHaveBeenCalledWith(
        "user-uuid-123",
        42,
        {
          description: "Updated description",
          notes: "Updated notes",
          keywords: ["updated", "keywords"],
          confidence: "medium",
        }
      );
    });

    it("calls updateCustomFoodMetadata with only provided new metadata fields", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 789, loggedFood: { foodId: 12345 } },
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });
      mockUpdateCustomFoodMetadata.mockResolvedValue(undefined);

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
        newDescription: "Only description updated",
      } as Partial<FoodLogRequest>);
      await POST(request);

      expect(mockUpdateCustomFoodMetadata).toHaveBeenCalledWith(
        "user-uuid-123",
        42,
        {
          description: "Only description updated",
        }
      );
    });

    it("does NOT call updateCustomFoodMetadata when reuse request has no new metadata fields", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 789, loggedFood: { foodId: 12345 } },
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
      } as Partial<FoodLogRequest>);
      await POST(request);

      expect(mockUpdateCustomFoodMetadata).not.toHaveBeenCalled();
    });

    it("returns 400 VALIDATION_ERROR for reuseCustomFoodId: 0 (FOO-562)", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        reuseCustomFoodId: 0,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
      } as Partial<FoodLogRequest>);
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for negative reuseCustomFoodId (FOO-562)", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        reuseCustomFoodId: -1,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
      } as Partial<FoodLogRequest>);
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for newDescription exceeding 2000 characters (FOO-567)", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
        newDescription: "a".repeat(2001),
      } as Partial<FoodLogRequest>);
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for newNotes exceeding 2000 characters (FOO-567)", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
        newNotes: "a".repeat(2001),
      } as Partial<FoodLogRequest>);
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("logs food successfully even if updateCustomFoodMetadata fails", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 789, loggedFood: { foodId: 12345 } },
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });
      mockUpdateCustomFoodMetadata.mockRejectedValue(new Error("DB error"));

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
        newDescription: "New description",
      } as Partial<FoodLogRequest>);
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.success).toBe(true);
      expect(body.data.foodLogId).toBe(20);
    });
  });

  describe("max-length validation (FOO-567)", () => {
    it("returns 400 VALIDATION_ERROR for food_name exceeding 500 characters", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        ...validFoodLogRequest,
        food_name: "a".repeat(501),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("accepts food_name at exactly 500 characters", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 456, loggedFood: { foodId: 123 } },
      });

      const request = createMockRequest({
        ...validFoodLogRequest,
        food_name: "a".repeat(500),
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it("returns 400 VALIDATION_ERROR for description exceeding 2000 characters", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        ...validFoodLogRequest,
        description: "a".repeat(2001),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for notes exceeding 2000 characters", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        ...validFoodLogRequest,
        notes: "a".repeat(2001),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 VALIDATION_ERROR for keyword element exceeding 100 characters", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        ...validFoodLogRequest,
        keywords: ["a".repeat(101)],
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("accepts keyword element at exactly 100 characters", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 456, loggedFood: { foodId: 123 } },
      });

      const request = createMockRequest({
        ...validFoodLogRequest,
        keywords: ["a".repeat(100)],
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it("returns 400 VALIDATION_ERROR for keywords array exceeding 20 elements", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        ...validFoodLogRequest,
        keywords: Array.from({ length: 21 }, (_, i) => `keyword${i}`),
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("accepts keywords array with exactly 20 elements", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 456, loggedFood: { foodId: 123 } },
      });

      const request = createMockRequest({
        ...validFoodLogRequest,
        keywords: Array.from({ length: 20 }, (_, i) => `keyword${i}`),
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    it("returns 400 VALIDATION_ERROR for newKeywords array exceeding 20 elements in reuse path", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "12:00:00",
        newKeywords: Array.from({ length: 21 }, (_, i) => `keyword${i}`),
      } as Partial<FoodLogRequest>);
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("dry-run mode (FITBIT_DRY_RUN=true)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("skips Fitbit API calls in new food flow", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 10, loggedAt: new Date() });

      const request = createMockRequest(validFoodLogRequest);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockEnsureFreshToken).not.toHaveBeenCalled();
      expect(mockFindOrCreateFood).not.toHaveBeenCalled();
      expect(mockLogFood).not.toHaveBeenCalled();
    });

    it("returns success with dryRun flag and no fitbitLogId in new food flow", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 10, loggedAt: new Date() });

      const request = createMockRequest(validFoodLogRequest);
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.success).toBe(true);
      expect(body.data.dryRun).toBe(true);
      expect(body.data.fitbitLogId).toBeUndefined();
      expect(body.data.fitbitFoodId).toBeUndefined();
    });

    it("still calls insertCustomFood and insertFoodLogEntry in new food flow", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 10, loggedAt: new Date() });

      const request = createMockRequest(validFoodLogRequest);
      await POST(request);

      expect(mockInsertCustomFood).toHaveBeenCalledWith(
        "user-uuid-123",
        expect.objectContaining({
          foodName: "Test Food",
          fitbitFoodId: null,
        }),
      );
      expect(mockInsertFoodLogEntry).toHaveBeenCalledWith(
        "user-uuid-123",
        expect.objectContaining({
          customFoodId: 42,
          fitbitLogId: null,
        }),
      );
    });

    it("insertFoodLogEntry receives fitbitLogId: null in new food flow", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 10, loggedAt: new Date() });

      const request = createMockRequest(validFoodLogRequest);
      const response = await POST(request);

      const body = await response.json();
      expect(body.data.foodLogId).toBe(10);
      expect(mockInsertFoodLogEntry).toHaveBeenCalledWith(
        "user-uuid-123",
        expect.objectContaining({
          fitbitLogId: null,
        }),
      );
    });

    it("skips Fitbit API calls in reuse flow but still inserts log entry", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockGetCustomFoodById.mockResolvedValue({
        id: 42,
        email: "user-uuid-123",
        foodName: "Tea with milk",
        amount: "1",
        unitId: 91,
        calories: 50,
        fitbitFoodId: null,
        confidence: "high",
        notes: null,
        keywords: ["tea", "milk"],
        createdAt: new Date("2026-02-05T12:00:00Z"),
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
      } as Partial<FoodLogRequest>);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockEnsureFreshToken).not.toHaveBeenCalled();
      expect(mockLogFood).not.toHaveBeenCalled();
      expect(mockInsertFoodLogEntry).toHaveBeenCalledWith(
        "user-uuid-123",
        expect.objectContaining({
          customFoodId: 42,
          fitbitLogId: null,
        }),
      );
      const body = await response.json();
      expect(body.data.dryRun).toBe(true);
      expect(body.data.fitbitLogId).toBeUndefined();
    });

    it("reuse flow allows food with null fitbitFoodId in dry-run", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockGetCustomFoodById.mockResolvedValue({
        id: 42,
        email: "user-uuid-123",
        foodName: "Dry-run food",
        amount: "1",
        unitId: 91,
        calories: 50,
        fitbitFoodId: null,
        confidence: "high",
        notes: null,
        keywords: [],
        createdAt: new Date(),
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 30, loggedAt: new Date() });

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
      } as Partial<FoodLogRequest>);
      const response = await POST(request);

      // Should NOT return 400 for missing fitbitFoodId in dry-run
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.success).toBe(true);
    });

    it("normal flow executes when FITBIT_DRY_RUN is not set", async () => {
      // Ensure env is NOT set
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
      mockLogFood.mockResolvedValue({
        foodLog: { logId: 456, loggedFood: { foodId: 123 } },
      });
      mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 10, loggedAt: new Date() });

      const request = createMockRequest(validFoodLogRequest);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockEnsureFreshToken).toHaveBeenCalled();
      expect(mockFindOrCreateFood).toHaveBeenCalled();
      expect(mockLogFood).toHaveBeenCalled();
      const body = await response.json();
      expect(body.data.dryRun).toBeUndefined();
    });
  });

  it("returns 400 VALIDATION_ERROR when keywords array has more than 20 elements (FOO-570)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const tooManyKeywords = Array.from({ length: 21 }, (_, i) => `keyword${i}`);
    const request = createMockRequest({
      ...validFoodLogRequest,
      keywords: tooManyKeywords,
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts keywords array with exactly 20 elements (FOO-570)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });
    mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
    mockInsertFoodLogEntry.mockResolvedValue({ id: 10, loggedAt: new Date() });

    const exactlyTwentyKeywords = Array.from({ length: 20 }, (_, i) => `keyword${i}`);
    const request = createMockRequest({
      ...validFoodLogRequest,
      keywords: exactlyTwentyKeywords,
    });
    const response = await POST(request);

    expect(response.status).toBe(200);
  });

  it("returns 400 VALIDATION_ERROR when newKeywords array has more than 20 elements in reuse flow (FOO-570)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const tooManyKeywords = Array.from({ length: 21 }, (_, i) => `keyword${i}`);
    const request = createMockRequest({
      reuseCustomFoodId: 42,
      mealTypeId: 1,
      date: "2026-02-07",
      time: "12:30:00",
      newKeywords: tooManyKeywords,
    } as Partial<FoodLogRequest>);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
