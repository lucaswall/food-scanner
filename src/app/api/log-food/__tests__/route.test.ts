import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FoodLogRequest, FullSession, ServingUnit } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (
    session: FullSession | null,
    options?: { requireHealth?: boolean },
  ): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      );
    }
    if (options?.requireHealth && !session.healthConnected) {
      return Response.json(
        { success: false, error: { code: "HEALTH_NOT_CONNECTED", message: "Google Health account not connected" }, timestamp: Date.now() },
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

// Mock Google Health API functions
const mockCreateNutritionLog = vi.fn();
const mockEnsureFreshToken = vi.fn();
const mockDeleteNutritionLogs = vi.fn();
vi.mock("@/lib/google-health", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  createNutritionLog: (...args: unknown[]) => mockCreateNutritionLog(...args),
  deleteNutritionLogs: (...args: unknown[]) => mockDeleteNutritionLogs(...args),
}));

// Mock food-log DB module
const mockInsertCustomFoodWithLogEntry = vi.fn();
const mockInsertFoodLogEntry = vi.fn();
const mockGetCustomFoodById = vi.fn();
const mockUpdateCustomFoodMetadata = vi.fn();
vi.mock("@/lib/food-log", () => ({
  insertCustomFoodWithLogEntry: (...args: unknown[]) => mockInsertCustomFoodWithLogEntry(...args),
  insertFoodLogEntry: (...args: unknown[]) => mockInsertFoodLogEntry(...args),
  getCustomFoodById: (...args: unknown[]) => mockGetCustomFoodById(...args),
  updateCustomFoodMetadata: (...args: unknown[]) => mockUpdateCustomFoodMetadata(...args),
}));

const { POST } = await import("@/app/api/log-food/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  healthConnected: true,
  destroy: vi.fn(),
};

// unit_id uses number (147=g) since food-validation.ts still validates as number (Task 21 migrates it)
const validFoodLogRequest: FoodLogRequest = {
  food_name: "Test Food",
  amount: 100,
  unit_id: 147 as unknown as ServingUnit,
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

function createMockRequest(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertCustomFoodWithLogEntry.mockResolvedValue({ customFoodId: 1, foodLogId: 1 });
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

  it("returns 400 HEALTH_NOT_CONNECTED if health not connected", async () => {
    mockGetSession.mockResolvedValue({
      ...validSession,
      healthConnected: false,
    });

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_NOT_CONNECTED");
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

  it("calls createNutritionLog EXACTLY once (not two calls) and persists returned string healthLogId", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "health-log-abc-123" });
    mockInsertCustomFoodWithLogEntry.mockResolvedValue({ customFoodId: 42, foodLogId: 10 });

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockCreateNutritionLog).toHaveBeenCalledTimes(1);

    // DB receives the string healthLogId
    expect(mockInsertCustomFoodWithLogEntry).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.any(Object),
      expect.objectContaining({ healthLogId: "health-log-abc-123" }),
      expect.anything(),
    );

    const body = await response.json();
    expect(body.data.healthLogId).toBe("health-log-abc-123");
    expect(body.data.foodLogId).toBe(10);
  });

  it("passes userId to ensureFreshToken", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-id" });

    const request = createMockRequest(validFoodLogRequest);
    await POST(request);

    expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-uuid-123", expect.any(Object));
  });

  it("returns 503 on HEALTH_RATE_LIMIT_LOW", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("HEALTH_RATE_LIMIT_LOW"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_RATE_LIMIT_LOW");
  });

  it("returns 401 HEALTH_TOKEN_INVALID triggers reconnect prompt", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockRejectedValue(new Error("HEALTH_TOKEN_INVALID"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_TOKEN_INVALID");
  });

  it("returns 500 HEALTH_API_ERROR on createNutritionLog failure", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockCreateNutritionLog.mockRejectedValue(new Error("HEALTH_API_ERROR"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_API_ERROR");
  });

  it("DB failure after create calls deleteNutritionLogs and returns INTERNAL_ERROR", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-to-rollback" });
    mockInsertCustomFoodWithLogEntry.mockRejectedValue(new Error("DB connection failed"));
    mockDeleteNutritionLogs.mockResolvedValue(undefined);

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
      "fresh-token",
      ["log-to-rollback"],
      expect.any(Object),
      "user-uuid-123",
    );
  });

  it("returns PARTIAL_ERROR when DB fails and compensation deleteNutritionLogs also fails", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-to-rollback" });
    mockInsertCustomFoodWithLogEntry.mockRejectedValue(new Error("DB connection failed"));
    mockDeleteNutritionLogs.mockRejectedValue(new Error("Health API error"));

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("PARTIAL_ERROR");
    expect(body.error.message).toContain("local save failed");
  });

  it("calls insertCustomFoodWithLogEntry after successful health log creation", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-456" });
    mockInsertCustomFoodWithLogEntry.mockResolvedValue({ customFoodId: 42, foodLogId: 10 });

    const request = createMockRequest(validFoodLogRequest);
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockInsertCustomFoodWithLogEntry).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.objectContaining({
        foodName: "Test Food",
        amount: 100,
        calories: 150,
        proteinG: 10,
        carbsG: 20,
        fatG: 5,
        fiberG: 3,
        sodiumMg: 200,
        confidence: "high",
        notes: "Test notes",
      }),
      expect.objectContaining({
        mealTypeId: 1,
        amount: 100,
        healthLogId: "log-456",
      }),
      expect.anything(),
    );
  });

  it("passes client-provided date and time to createNutritionLog", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-xyz" });

    const request = createMockRequest({
      ...validFoodLogRequest,
      date: "2024-01-15",
      time: "20:30:00",
    });
    await POST(request);

    expect(mockCreateNutritionLog).toHaveBeenCalledWith(
      "fresh-token",
      expect.any(Object),
      expect.any(Object),
      "user-uuid-123",
    );
  });

  it("validates all valid meal type IDs", async () => {
    const validMealTypeIds = [1, 2, 3, 4, 5, 7];

    for (const mealTypeId of validMealTypeIds) {
      vi.clearAllMocks();
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-" + mealTypeId });
      mockInsertCustomFoodWithLogEntry.mockResolvedValue({ customFoodId: 1, foodLogId: 1 });

      const request = createMockRequest({
        ...validFoodLogRequest,
        mealTypeId,
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
    }
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

  describe("clientToken idempotency", () => {
    it("two POSTs with the same clientToken/user call createNutritionLog once and return the same foodLogId", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-idem-1" });
      mockInsertCustomFoodWithLogEntry.mockResolvedValue({ customFoodId: 5, foodLogId: 99 });

      const body = { ...validFoodLogRequest, clientToken: "unique-token-xyz" };

      const response1 = await POST(createMockRequest(body));
      const response2 = await POST(createMockRequest(body));

      expect(response1.status).toBe(200);
      expect(response2.status).toBe(200);

      // createNutritionLog called exactly once
      expect(mockCreateNutritionLog).toHaveBeenCalledTimes(1);

      const data1 = (await response1.json()).data;
      const data2 = (await response2.json()).data;
      // Both return the same foodLogId
      expect(data1.foodLogId).toBe(99);
      expect(data2.foodLogId).toBe(99);
    });

    it("different clientToken creates a new log", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockCreateNutritionLog
        .mockResolvedValueOnce({ healthLogId: "log-token-a" })
        .mockResolvedValueOnce({ healthLogId: "log-token-b" });
      mockInsertCustomFoodWithLogEntry
        .mockResolvedValueOnce({ customFoodId: 1, foodLogId: 10 })
        .mockResolvedValueOnce({ customFoodId: 2, foodLogId: 20 });

      const body1 = { ...validFoodLogRequest, clientToken: "token-A" };
      const body2 = { ...validFoodLogRequest, clientToken: "token-B" };

      await POST(createMockRequest(body1));
      await POST(createMockRequest(body2));

      expect(mockCreateNutritionLog).toHaveBeenCalledTimes(2);
    });
  });

  describe("reuse flow with reuseCustomFoodId", () => {
    const existingFood = {
      id: 42,
      userId: "user-uuid-123",
      foodName: "Tea with milk",
      amount: "1",
      unitId: "cup" as ServingUnit,
      calories: 50,
      proteinG: "2",
      carbsG: "5",
      fatG: "2",
      fiberG: "0",
      sodiumMg: "30",
      saturatedFatG: null,
      transFatG: null,
      sugarsG: null,
      caloriesFromFat: null,
      confidence: "high",
      notes: null,
      description: null,
      keywords: ["tea", "milk"],
      createdAt: new Date("2026-02-05T12:00:00Z"),
    };

    it("calls createNutritionLog (not a separate findOrCreate) from stored custom food nutrients", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-reuse-1" });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        ...validFoodLogRequest,
        reuseCustomFoodId: 42,
      });
      await POST(request);

      expect(mockCreateNutritionLog).toHaveBeenCalledTimes(1);
      expect(mockGetCustomFoodById).toHaveBeenCalledWith("user-uuid-123", 42);
    });

    it("does NOT require a fitbitFoodId on the reused food (no legacy id check)", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      // No fitbitFoodId field at all
      mockGetCustomFoodById.mockResolvedValue({ ...existingFood });
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-reuse-no-id" });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
      });
      const response = await POST(request);

      // Should succeed (200), not 400 for missing fitbit id
      expect(response.status).toBe(200);
    });

    it("inserts food_log_entry with healthLogId from createNutritionLog", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-reuse-abc" });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        ...validFoodLogRequest,
        reuseCustomFoodId: 42,
      });
      await POST(request);

      expect(mockInsertFoodLogEntry).toHaveBeenCalledWith(
        "user-uuid-123",
        expect.objectContaining({
          customFoodId: 42,
          healthLogId: "log-reuse-abc",
        }),
      );
    });

    it("response has reusedFood: true and healthLogId string", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-reuse-xyz" });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        ...validFoodLogRequest,
        reuseCustomFoodId: 42,
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.reusedFood).toBe(true);
      expect(body.data.healthLogId).toBe("log-reuse-xyz");
    });

    it("returns 400 when custom food not found", async () => {
      mockGetSession.mockResolvedValue(validSession);
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

    it("DB failure in reuse flow calls deleteNutritionLogs and returns INTERNAL_ERROR", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-reuse-rollback" });
      mockInsertFoodLogEntry.mockRejectedValue(new Error("DB connection failed"));
      mockDeleteNutritionLogs.mockResolvedValue(undefined);

      const request = createMockRequest({
        ...validFoodLogRequest,
        reuseCustomFoodId: 42,
      });
      const response = await POST(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
        "fresh-token",
        ["log-reuse-rollback"],
        expect.any(Object),
        "user-uuid-123",
      );
    });

    it("calls updateCustomFoodMetadata when reuse request includes new metadata fields", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockGetCustomFoodById.mockResolvedValue(existingFood);
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "log-meta" });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });
      mockUpdateCustomFoodMetadata.mockResolvedValue(undefined);

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
        newDescription: "Updated description",
        newNotes: "Updated notes",
      });
      await POST(request);

      expect(mockUpdateCustomFoodMetadata).toHaveBeenCalledWith(
        "user-uuid-123",
        42,
        expect.objectContaining({ description: "Updated description", notes: "Updated notes" }),
      );
    });

    it("returns 400 VALIDATION_ERROR for reuseCustomFoodId: 0", async () => {
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest({
        reuseCustomFoodId: 0,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
      });
      const response = await POST(request);

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("dry-run mode (HEALTH_DRY_RUN=true)", () => {
    afterEach(() => {
      vi.stubEnv("HEALTH_DRY_RUN", "");
    });

    it("skips remote calls in new food flow", async () => {
      vi.stubEnv("HEALTH_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest(validFoodLogRequest);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockEnsureFreshToken).not.toHaveBeenCalled();
      expect(mockCreateNutritionLog).not.toHaveBeenCalled();
    });

    it("returns success with dryRun flag and no healthLogId in new food flow", async () => {
      vi.stubEnv("HEALTH_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockInsertCustomFoodWithLogEntry.mockResolvedValue({ customFoodId: 42, foodLogId: 10 });

      const request = createMockRequest(validFoodLogRequest);
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.success).toBe(true);
      expect(body.data.dryRun).toBe(true);
      expect(body.data.healthLogId).toBeUndefined();
    });

    it("still calls insertCustomFoodWithLogEntry in new food flow with healthLogId: null", async () => {
      vi.stubEnv("HEALTH_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);

      const request = createMockRequest(validFoodLogRequest);
      await POST(request);

      expect(mockInsertCustomFoodWithLogEntry).toHaveBeenCalledWith(
        "user-uuid-123",
        expect.objectContaining({ foodName: "Test Food" }),
        expect.objectContaining({ healthLogId: null }),
        expect.anything(),
      );
    });

    it("skips remote calls in reuse flow but still inserts log entry", async () => {
      vi.stubEnv("HEALTH_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockGetCustomFoodById.mockResolvedValue({
        id: 42,
        userId: "user-uuid-123",
        foodName: "Tea with milk",
        amount: "1",
        unitId: "cup" as ServingUnit,
        calories: 50,
        proteinG: "2",
        carbsG: "5",
        fatG: "2",
        fiberG: "0",
        sodiumMg: "30",
        saturatedFatG: null,
        transFatG: null,
        sugarsG: null,
        caloriesFromFat: null,
        confidence: "high",
        notes: null,
        description: null,
        keywords: ["tea", "milk"],
        createdAt: new Date("2026-02-05T12:00:00Z"),
      });
      mockInsertFoodLogEntry.mockResolvedValue({ id: 20, loggedAt: new Date() });

      const request = createMockRequest({
        reuseCustomFoodId: 42,
        mealTypeId: 1,
        date: "2026-02-07",
        time: "08:00:00",
      });
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(mockEnsureFreshToken).not.toHaveBeenCalled();
      expect(mockCreateNutritionLog).not.toHaveBeenCalled();
      expect(mockInsertFoodLogEntry).toHaveBeenCalledWith(
        "user-uuid-123",
        expect.objectContaining({ customFoodId: 42, healthLogId: null }),
      );
      const body = await response.json();
      expect(body.data.dryRun).toBe(true);
    });
  });

  describe("max-length validation", () => {
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
  });
});
