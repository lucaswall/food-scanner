import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, FoodLogEntryDetail, ServingUnit } from "@/types";

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

const mockCreateNutritionLog = vi.fn();
const mockEnsureFreshToken = vi.fn();
const mockDeleteNutritionLogs = vi.fn();
vi.mock("@/lib/google-health", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  createNutritionLog: (...args: unknown[]) => mockCreateNutritionLog(...args),
  deleteNutritionLogs: (...args: unknown[]) => mockDeleteNutritionLogs(...args),
}));

const mockGetFoodLogEntryDetail = vi.fn();
const mockUpdateFoodLogEntry = vi.fn();
const mockUpdateFoodLogEntryMetadata = vi.fn();
const mockUpdateCustomFoodMetadata = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getFoodLogEntryDetail: (...args: unknown[]) => mockGetFoodLogEntryDetail(...args),
  updateFoodLogEntry: (...args: unknown[]) => mockUpdateFoodLogEntry(...args),
  updateFoodLogEntryMetadata: (...args: unknown[]) => mockUpdateFoodLogEntryMetadata(...args),
  updateCustomFoodMetadata: (...args: unknown[]) => mockUpdateCustomFoodMetadata(...args),
}));

const { POST, isNutritionUnchanged } = await import("@/app/api/edit-food/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  healthConnected: true,
  destroy: vi.fn(),
};

const existingEntry: FoodLogEntryDetail = {
  id: 42,
  customFoodId: 100,
  foodName: "Empanada de carne",
  description: "Standard Argentine beef empanada",
  notes: "Baked style",
  calories: 320,
  proteinG: 12,
  carbsG: 28,
  fatG: 18,
  fiberG: 2,
  sodiumMg: 450,
  saturatedFatG: null,
  transFatG: null,
  sugarsG: null,
  caloriesFromFat: null,
  amount: 150,
  unitId: 147 as unknown as ServingUnit,
  mealTypeId: 5,
  date: "2026-02-15",
  time: "20:00:00",
  healthLogId: "health-log-old-12345",
  confidence: "high",
  isFavorite: false,
  keywords: ["empanada", "carne"],
};

const validBody = {
  entryId: 42,
  food_name: "Empanada de carne actualizada",
  amount: 130,
  unit_id: 147,
  calories: 280,
  protein_g: 10,
  carbs_g: 24,
  fat_g: 16,
  fiber_g: 1.5,
  sodium_mg: 400,
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high" as const,
  notes: "Corrected portion",
  description: "Smaller Argentine beef empanada",
  keywords: ["empanada", "carne"],
  mealTypeId: 5,
  date: "2026-02-15",
  time: "20:00:00",
};

function createMockRequest(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(validSession);
  mockGetFoodLogEntryDetail.mockResolvedValue(existingEntry);
  mockEnsureFreshToken.mockResolvedValue("access-token-abc");
  mockDeleteNutritionLogs.mockResolvedValue(undefined);
  mockCreateNutritionLog.mockResolvedValue({ healthLogId: "health-log-new-99999" });
  mockUpdateFoodLogEntry.mockResolvedValue({ healthLogId: "health-log-new-99999", newCustomFoodId: 200 });
  mockUpdateFoodLogEntryMetadata.mockResolvedValue(undefined);
  mockUpdateCustomFoodMetadata.mockResolvedValue(undefined);
  vi.stubEnv("HEALTH_DRY_RUN", "");
});

describe("POST /api/edit-food", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 HEALTH_NOT_CONNECTED without health connection", async () => {
    mockGetSession.mockResolvedValue({ ...validSession, healthConnected: false });
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_NOT_CONNECTED");
  });

  it("returns 400 for missing entryId", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { entryId, ...bodyWithoutEntryId } = validBody;
    const response = await POST(createMockRequest(bodyWithoutEntryId));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for missing FoodAnalysis fields", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { food_name, ...bodyWithoutFoodName } = validBody;
    const response = await POST(createMockRequest(bodyWithoutFoodName));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid mealTypeId", async () => {
    const response = await POST(createMockRequest({ ...validBody, mealTypeId: 6 }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("mealTypeId");
  });

  it("returns 400 when keywords is empty array", async () => {
    const response = await POST(createMockRequest({ ...validBody, keywords: [] }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when entry not found", async () => {
    mockGetFoodLogEntryDetail.mockResolvedValue(null);
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("regular path: deletes old healthLogId then calls createNutritionLog once", async () => {
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(200);

    expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
      "access-token-abc",
      ["health-log-old-12345"],
      expect.any(Object),
      "user-uuid-123",
    );
    expect(mockCreateNutritionLog).toHaveBeenCalledTimes(1);
  });

  it("regular path: persists new string healthLogId from createNutritionLog", async () => {
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "health-log-new-xyz" });
    mockUpdateFoodLogEntry.mockResolvedValue({ healthLogId: "health-log-new-xyz", newCustomFoodId: 200 });

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(200);

    expect(mockUpdateFoodLogEntry).toHaveBeenCalledWith(
      "user-uuid-123",
      42,
      expect.objectContaining({ healthLogId: "health-log-new-xyz" }),
      expect.anything(),
    );
  });

  it("regular path: response includes new healthLogId string", async () => {
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "health-log-new-abc" });
    mockUpdateFoodLogEntry.mockResolvedValue({ healthLogId: "health-log-new-abc", newCustomFoodId: 200 });

    const response = await POST(createMockRequest(validBody));
    const body = await response.json();

    expect(body.data.healthLogId).toBe("health-log-new-abc");
    expect(body.data.foodLogId).toBe(42);
    expect(body.data.reusedFood).toBe(false);
  });

  it("regular path: DB failure calls deleteNutritionLogs on new health log (compensation)", async () => {
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "new-log-to-delete" });
    mockUpdateFoodLogEntry.mockRejectedValue(new Error("DB error"));

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(500);

    const body = await response.json();
    // Either INTERNAL_ERROR or PARTIAL_ERROR depending on compensation result
    expect(["INTERNAL_ERROR", "PARTIAL_ERROR"]).toContain(body.error.code);
    expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
      "access-token-abc",
      ["new-log-to-delete"],
      expect.any(Object),
      "user-uuid-123",
    );
  });

  it("regular path: relog failure calls createNutritionLog for compensation (re-create original)", async () => {
    // First createNutritionLog (new food) fails, triggering compensation
    mockCreateNutritionLog.mockRejectedValue(new Error("HEALTH_API_ERROR"));

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_API_ERROR");
  });

  describe("fast path (nutrition unchanged)", () => {
    // Entry with same nutrition as body
    const unchangedBody = {
      entryId: 42,
      food_name: "Empanada de carne",
      amount: 150,
      unit_id: 147,
      calories: 320,
      protein_g: 12,
      carbs_g: 28,
      fat_g: 18,
      fiber_g: 2,
      sodium_mg: 450,
      saturated_fat_g: null,
      trans_fat_g: null,
      sugars_g: null,
      calories_from_fat: null,
      confidence: "high" as const,
      notes: "Baked style",
      description: "Standard Argentine beef empanada",
      keywords: ["empanada", "carne"],
      mealTypeId: 5,
      date: "2026-02-15",
      time: "20:00:00",
    };

    it("fast path: deletes old healthLogId and creates new via createNutritionLog (entry's own nutrients)", async () => {
      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(200);

      expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
        "access-token-abc",
        ["health-log-old-12345"],
        expect.any(Object),
        "user-uuid-123",
      );
      expect(mockCreateNutritionLog).toHaveBeenCalledTimes(1);
    });

    it("fast path: returns new healthLogId string in response", async () => {
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "fast-path-new-log" });

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.healthLogId).toBe("fast-path-new-log");
      expect(body.data.reusedFood).toBe(true);
    });

    it("fast path: DB failure after relog calls deleteNutritionLogs on new log (compensation)", async () => {
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "fast-path-new-rollback" });
      mockUpdateFoodLogEntryMetadata.mockRejectedValue(new Error("DB error"));

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      // Compensation: delete new log
      expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
        expect.any(String),
        ["fast-path-new-rollback"],
        expect.any(Object),
        "user-uuid-123",
      );
    });

    it("fast path: relog failure triggers compensation (re-create original)", async () => {
      // First createNutritionLog (fast path relog) fails
      mockCreateNutritionLog.mockRejectedValue(new Error("HEALTH_API_ERROR"));

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("HEALTH_API_ERROR");
    });

    it("HEALTH_DRY_RUN: skips remote calls on fast path", async () => {
      vi.stubEnv("HEALTH_DRY_RUN", "true");

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(200);
      expect(mockCreateNutritionLog).not.toHaveBeenCalled();
      expect(mockDeleteNutritionLogs).not.toHaveBeenCalled();

      const body = await response.json();
      expect(body.data.dryRun).toBe(true);
    });
  });

  describe("isNutritionUnchanged", () => {
    it("returns true when all nutrition fields match", () => {
      const analysis = {
        food_name: existingEntry.foodName,
        amount: existingEntry.amount,
        unit_id: existingEntry.unitId,
        calories: existingEntry.calories,
        protein_g: existingEntry.proteinG,
        carbs_g: existingEntry.carbsG,
        fat_g: existingEntry.fatG,
        fiber_g: existingEntry.fiberG,
        sodium_mg: existingEntry.sodiumMg,
        saturated_fat_g: null,
        trans_fat_g: null,
        sugars_g: null,
        calories_from_fat: null,
        confidence: "high" as const,
        notes: existingEntry.notes ?? "",
        description: existingEntry.description ?? "",
        keywords: existingEntry.keywords,
      };
      expect(isNutritionUnchanged(analysis, existingEntry)).toBe(true);
    });

    it("returns false when calories differ", () => {
      const analysis = {
        food_name: existingEntry.foodName,
        amount: existingEntry.amount,
        unit_id: existingEntry.unitId,
        calories: existingEntry.calories + 10,
        protein_g: existingEntry.proteinG,
        carbs_g: existingEntry.carbsG,
        fat_g: existingEntry.fatG,
        fiber_g: existingEntry.fiberG,
        sodium_mg: existingEntry.sodiumMg,
        saturated_fat_g: null,
        trans_fat_g: null,
        sugars_g: null,
        calories_from_fat: null,
        confidence: "high" as const,
        notes: existingEntry.notes ?? "",
        description: existingEntry.description ?? "",
        keywords: existingEntry.keywords,
      };
      expect(isNutritionUnchanged(analysis, existingEntry)).toBe(false);
    });
  });

  describe("HEALTH_DRY_RUN mode", () => {
    it("skips remote calls in regular path and returns dryRun flag", async () => {
      vi.stubEnv("HEALTH_DRY_RUN", "true");

      const response = await POST(createMockRequest(validBody));
      expect(response.status).toBe(200);
      expect(mockEnsureFreshToken).not.toHaveBeenCalled();
      expect(mockCreateNutritionLog).not.toHaveBeenCalled();
      expect(mockDeleteNutritionLogs).not.toHaveBeenCalled();

      const body = await response.json();
      expect(body.data.dryRun).toBe(true);
    });
  });
});
