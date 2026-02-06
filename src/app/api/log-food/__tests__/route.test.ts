import { describe, it, expect, vi, beforeEach } from "vitest";
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
    return null;
  },
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

// Mock food-log DB module
const mockInsertCustomFood = vi.fn();
const mockInsertFoodLogEntry = vi.fn();
const mockGetCustomFoodById = vi.fn();
vi.mock("@/lib/food-log", () => ({
  insertCustomFood: (...args: unknown[]) => mockInsertCustomFood(...args),
  insertFoodLogEntry: (...args: unknown[]) => mockInsertFoodLogEntry(...args),
  getCustomFoodById: (...args: unknown[]) => mockGetCustomFoodById(...args),
}));

const { POST } = await import("@/app/api/log-food/route");

const validSession: FullSession = {
  sessionId: "test-session",
  email: "test@example.com",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
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
  confidence: "high",
  notes: "Test notes",
  keywords: ["test", "food"],
  mealTypeId: 1,
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

  it("passes email to ensureFreshToken", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });

    const request = createMockRequest(validFoodLogRequest);
    await POST(request);

    expect(mockEnsureFreshToken).toHaveBeenCalledWith("test@example.com");
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

  it("uses provided date in logFood call", async () => {
    mockGetSession.mockResolvedValue(validSession);
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
      100,
      147,
      "2024-01-15",
      undefined
    );
  });

  it("uses current date when date not provided", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });

    const request = createMockRequest(validFoodLogRequest);
    await POST(request);

    expect(mockLogFood).toHaveBeenCalledWith(
      "fresh-token",
      123,
      1,
      100,
      147,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      undefined
    );
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
    const invalidTimes = ["invalid-time", "12:00", "12:00:00:00", "1:00:00", "12:0:00"];

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
    const invalidTimes = ["99:99:99", "24:00:00", "12:60:00", "12:00:60"];

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
      "12:30:00"
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
      "test@example.com",
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
      "test@example.com",
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
      "test@example.com",
      expect.objectContaining({
        keywords: ["test", "food"],
      }),
    );
  });

  it("returns success even if insertCustomFood fails (non-fatal)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });
    mockInsertCustomFood.mockRejectedValue(new Error("DB connection failed"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.fitbitFoodId).toBe(123);
    expect(body.data.fitbitLogId).toBe(456);
    expect(body.data.foodLogId).toBeUndefined();
    expect(mockInsertFoodLogEntry).not.toHaveBeenCalled();
  });

  it("returns success even if insertFoodLogEntry fails (non-fatal)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockFindOrCreateFood.mockResolvedValue({ foodId: 123, reused: false });
    mockLogFood.mockResolvedValue({
      foodLog: { logId: 456, loggedFood: { foodId: 123 } },
    });
    mockInsertCustomFood.mockResolvedValue({ id: 42, createdAt: new Date() });
    mockInsertFoodLogEntry.mockRejectedValue(new Error("DB connection failed"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.fitbitFoodId).toBe(123);
    expect(body.data.fitbitLogId).toBe(456);
    expect(body.data.foodLogId).toBeUndefined();
  });

  describe("reuse flow with reuseCustomFoodId", () => {
    const existingFood = {
      id: 42,
      email: "test@example.com",
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
      expect(mockGetCustomFoodById).toHaveBeenCalledWith(42);
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
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        undefined,
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
        "test@example.com",
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
  });
});
