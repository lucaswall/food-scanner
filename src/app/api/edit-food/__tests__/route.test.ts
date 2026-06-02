import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, FoodLogEntryDetail } from "@/types";

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
    if (options?.requireHealth && session.healthScopeComplete === false) {
      return Response.json(
        { success: false, error: { code: "HEALTH_SCOPE_MISSING", message: "Missing required Google Health scopes" }, timestamp: Date.now() },
        { status: 403 },
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

const { POST, isNutritionUnchanged, buildAnalysisFromEntry } = await import("@/app/api/edit-food/route");

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
  unitId: "g",
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
  unit_id: "g",
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
  // resetAllMocks clears Once queues AND call history — ensures test isolation
  vi.resetAllMocks();
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

  it("returns 403 HEALTH_SCOPE_MISSING when connected but health scopes are incomplete", async () => {
    // Write routes (requireHealth) must reject a partial-scope grant at the gate (FOO-1126),
    // not deep inside createNutritionLog. healthScopeComplete === false → 403.
    mockGetSession.mockResolvedValue({ ...validSession, healthConnected: true, healthScopeComplete: false });
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_SCOPE_MISSING");
  });

  it("maps a token-refresh failure to 401 HEALTH_TOKEN_INVALID instead of an unhandled 500", async () => {
    mockEnsureFreshToken.mockRejectedValueOnce(new Error("HEALTH_TOKEN_INVALID"));
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_TOKEN_INVALID");
  });

  it("maps a low rate-limit headroom on token refresh to 503", async () => {
    mockEnsureFreshToken.mockRejectedValueOnce(new Error("HEALTH_RATE_LIMIT_LOW"));
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_RATE_LIMIT_LOW");
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
      "user",
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
      "cleanup",
    );
  });

  it("regular path: DB failure re-creates original health log and updates DB metadata (full compensation)", async () => {
    // Setup: new createNutritionLog succeeds, DB update fails
    mockCreateNutritionLog
      .mockResolvedValueOnce({ healthLogId: "new-log-to-delete" }) // initial create
      .mockResolvedValueOnce({ healthLogId: "compensation-log-id" }); // re-create original
    mockUpdateFoodLogEntry.mockRejectedValue(new Error("DB error"));
    // compensation ensureFreshToken (second call)
    mockEnsureFreshToken
      .mockResolvedValueOnce("access-token-abc")
      .mockResolvedValueOnce("fresh-token-compensation");

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");

    // delete the new log (cleanup mode — idempotent, no throw on 404)
    expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
      "fresh-token-compensation",
      ["new-log-to-delete"],
      expect.any(Object),
      "user-uuid-123",
      "cleanup",
    );
    // re-create original from entry's nutrients
    expect(mockCreateNutritionLog).toHaveBeenCalledTimes(2);
    // persist compensation id to DB
    expect(mockUpdateFoodLogEntryMetadata).toHaveBeenCalledWith(
      "user-uuid-123",
      42,
      expect.objectContaining({ healthLogId: "compensation-log-id" }),
      expect.anything(),
    );
  });

  it("regular path: relog failure + compensation success → original error propagated (HEALTH_API_ERROR)", async () => {
    // Relog fails, compensation re-creates original successfully → original health error propagated
    mockCreateNutritionLog
      .mockRejectedValueOnce(new Error("HEALTH_API_ERROR")) // relog fails
      .mockResolvedValueOnce({ healthLogId: "compensation-restored-log" }); // compensation succeeds
    mockEnsureFreshToken
      .mockResolvedValueOnce("token-primary")
      .mockResolvedValueOnce("token-compensation");

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_API_ERROR");
    // Verify compensation was triggered (2 createNutritionLog calls)
    expect(mockCreateNutritionLog).toHaveBeenCalledTimes(2);
  });

  it("regular path: delete failure with HEALTH_SCOPE_MISSING returns 403", async () => {
    // deleteNutritionLogs (for old log) fails with scope error
    mockDeleteNutritionLogs.mockRejectedValue(new Error("HEALTH_SCOPE_MISSING"));

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_SCOPE_MISSING");
  });

  it("regular path: delete failure with HEALTH_TIMEOUT returns 504", async () => {
    mockDeleteNutritionLogs.mockRejectedValue(new Error("HEALTH_TIMEOUT"));

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_TIMEOUT");
  });

  describe("fast path (nutrition unchanged)", () => {
    // Entry with same nutrition as body
    const unchangedBody = {
      entryId: 42,
      food_name: "Empanada de carne",
      amount: 150,
      unit_id: "g",
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
        "user",
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
      // Both the primary DB update AND the compensation's id-link update fail here,
      // leaving an orphaned compensation log + stale DB pointer → PARTIAL_ERROR so the
      // client knows manual cleanup may be needed (not a silent INTERNAL_ERROR).
      expect(body.error.code).toBe("PARTIAL_ERROR");
      // Compensation: delete new log (cleanup mode — idempotent)
      expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
        expect.any(String),
        ["fast-path-new-rollback"],
        expect.any(Object),
        "user-uuid-123",
        "cleanup",
      );
    });

    it("fast path: relog failure + compensation success → original error propagated (HEALTH_API_ERROR)", async () => {
      // Fast-path relog fails, but compensation re-create succeeds (original restored)
      // When compensation succeeds, the original health error is returned (502 HEALTH_API_ERROR)
      mockCreateNutritionLog
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR")) // fast-path relog fails
        .mockResolvedValueOnce({ healthLogId: "compensation-restored-log" }); // compensation succeeds
      mockEnsureFreshToken
        .mockResolvedValueOnce("token-fast-path")
        .mockResolvedValueOnce("token-compensation");

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error.code).toBe("HEALTH_API_ERROR");
      // Verify compensation was triggered (2 createNutritionLog calls)
      expect(mockCreateNutritionLog).toHaveBeenCalledTimes(2);
    });

    it("fast path: relog-failure compensation re-creates original but DB id-link update fails → PARTIAL_ERROR", async () => {
      // Fast-path relog (1st create) fails → compensation re-creates the original (2nd create)
      // succeeds, but persisting the compensation id to the DB fails. The client must see
      // PARTIAL_ERROR (orphaned compensation log + stale DB pointer), not a misleading
      // success log followed by a generic health error. Mirrors the regular-path contract.
      mockCreateNutritionLog
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR")) // fast-path relog fails
        .mockResolvedValueOnce({ healthLogId: "fp-compensation-log" }); // compensation re-create succeeds
      mockUpdateFoodLogEntryMetadata.mockRejectedValue(new Error("DB error"));

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("PARTIAL_ERROR");
      // Compensation re-created the original log before the DB link failed
      expect(mockCreateNutritionLog).toHaveBeenCalledTimes(2);
    });

    it("fast path: DB failure + compensation re-create itself throws → PARTIAL_ERROR (not INTERNAL_ERROR)", async () => {
      // Relog succeeds (new log created) → primary DB update fails → compensation attempts to
      // delete the new log + re-create the original, but the re-create THROWS. The new health
      // log is orphaned, so the client must see PARTIAL_ERROR consistent with the regular path
      // (previously this fell through to a misleading INTERNAL_ERROR). (bug-hunter HIGH)
      mockCreateNutritionLog
        .mockResolvedValueOnce({ healthLogId: "fp-relog-orphan" }) // fast-path relog succeeds
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR")); // compensation re-create throws
      mockUpdateFoodLogEntryMetadata.mockRejectedValueOnce(new Error("DB error")); // primary DB update fails

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("PARTIAL_ERROR");
      // Compensation tried to clean up the orphaned new log
      expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
        expect.any(String),
        ["fp-relog-orphan"],
        expect.any(Object),
        "user-uuid-123",
        "cleanup",
      );
    });

    it("fast path: delete failure with HEALTH_SCOPE_MISSING returns 403", async () => {
      // deleteNutritionLogs (for old log) fails with scope error
      mockDeleteNutritionLogs.mockRejectedValue(new Error("HEALTH_SCOPE_MISSING"));

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error.code).toBe("HEALTH_SCOPE_MISSING");
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

  // ── FOO-1129: compensation contract + CRITICAL logging ──────────────────────

  describe("fast path: compensation failure contract (FOO-1129)", () => {
    const unchangedBodyFP = {
      entryId: 42,
      food_name: "Empanada de carne",
      amount: 150,
      unit_id: "g",
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

    it("delete-ok + relog-fail + compensation-fail → PARTIAL_ERROR (not the original health error) (FOO-1129)", async () => {
      // Delete succeeds, fast-path relog fails, compensation re-create also fails
      mockCreateNutritionLog
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR")) // fast-path relog fails
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR")); // compensation re-create fails
      mockEnsureFreshToken
        .mockResolvedValueOnce("token-fast-path")
        .mockResolvedValueOnce("token-compensation");

      const response = await POST(createMockRequest(unchangedBodyFP));
      expect(response.status).toBe(500);
      const body = await response.json();
      // Must be PARTIAL_ERROR, not the original HEALTH_API_ERROR (which would be 502)
      expect(body.error.code).toBe("PARTIAL_ERROR");
    });

    it("delete-ok + relog-fail + compensation-fail → CRITICAL log includes oldHealthLogId (FOO-1129)", async () => {
      mockCreateNutritionLog
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR"))
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR"));
      mockEnsureFreshToken
        .mockResolvedValueOnce("token-fast-path")
        .mockResolvedValueOnce("token-compensation");

      await POST(createMockRequest(unchangedBodyFP));

      const { logger } = await import("@/lib/logger") as unknown as { logger: { error: ReturnType<typeof vi.fn> } };
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ oldHealthLogId: "health-log-old-12345" }),
        expect.stringContaining("CRITICAL"),
      );
    });

    it("fast path: primary delete uses mode=user (throws on 404 drift) (FOO-1129)", async () => {
      await POST(createMockRequest(unchangedBodyFP));
      // Primary delete should use mode "user" so a 404 surfaces as HEALTH_LOG_NOT_FOUND
      expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
        expect.any(String),
        ["health-log-old-12345"],
        expect.any(Object),
        "user-uuid-123",
        "user",
      );
    });
  });

  describe("regular path: compensation failure contract (FOO-1129)", () => {
    it("delete-ok + relog-fail + compensation-fail → PARTIAL_ERROR (not the original health error) (FOO-1129)", async () => {
      // Delete succeeds, new log creation fails, compensation re-create also fails
      mockCreateNutritionLog
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR")) // relog fails
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR")); // compensation re-create fails
      mockEnsureFreshToken
        .mockResolvedValueOnce("token-primary")
        .mockResolvedValueOnce("token-compensation");

      const response = await POST(createMockRequest(validBody));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("PARTIAL_ERROR");
    });

    it("delete-ok + relog-fail + compensation-fail → CRITICAL log includes oldHealthLogId (FOO-1129)", async () => {
      mockCreateNutritionLog
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR"))
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR"));
      mockEnsureFreshToken
        .mockResolvedValueOnce("token-primary")
        .mockResolvedValueOnce("token-compensation");

      await POST(createMockRequest(validBody));

      const { logger } = await import("@/lib/logger") as unknown as { logger: { error: ReturnType<typeof vi.fn> } };
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ oldHealthLogId: "health-log-old-12345" }),
        expect.stringContaining("CRITICAL"),
      );
    });

    it("regular path: primary delete uses mode=user (throws on 404 drift) (FOO-1129)", async () => {
      await POST(createMockRequest(validBody));
      expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
        expect.any(String),
        ["health-log-old-12345"],
        expect.any(Object),
        "user-uuid-123",
        "user",
      );
    });

    it("DB compensation: delete-fail → PARTIAL_ERROR (FOO-1129)", async () => {
      // New log created, DB update fails, then compensation deleteNutritionLogs also fails
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "new-log-123" });
      mockUpdateFoodLogEntry.mockRejectedValue(new Error("DB error"));
      mockDeleteNutritionLogs
        .mockResolvedValueOnce(undefined)  // primary delete succeeds
        .mockRejectedValueOnce(new Error("HEALTH_API_ERROR")); // compensation delete fails
      mockEnsureFreshToken
        .mockResolvedValueOnce("token-primary")
        .mockResolvedValueOnce("token-compensation");

      const response = await POST(createMockRequest(validBody));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("PARTIAL_ERROR");
    });
  });

  // ── buildAnalysisFromEntry unit tests (FOO-1129) ────────────────────────────

  describe("buildAnalysisFromEntry", () => {
    it("maps all entry fields to FoodAnalysis correctly", () => {
      const result = buildAnalysisFromEntry(existingEntry);
      expect(result.food_name).toBe("Empanada de carne");
      expect(result.amount).toBe(150);
      expect(result.unit_id).toBe("g");
      expect(result.calories).toBe(320);
      expect(result.protein_g).toBe(12);
      expect(result.carbs_g).toBe(28);
      expect(result.fat_g).toBe(18);
      expect(result.fiber_g).toBe(2);
      expect(result.sodium_mg).toBe(450);
      expect(result.saturated_fat_g).toBeNull();
      expect(result.trans_fat_g).toBeNull();
      expect(result.sugars_g).toBeNull();
      expect(result.calories_from_fat).toBeNull();
      expect(result.confidence).toBe("high");
      expect(result.notes).toBe("Baked style");
      expect(result.description).toBe("Standard Argentine beef empanada");
      expect(result.keywords).toEqual(["empanada", "carne"]);
    });

    it("coerces null optional fields to null (not undefined)", () => {
      const entryWithNulls = { ...existingEntry, saturatedFatG: null, transFatG: null, sugarsG: null, caloriesFromFat: null };
      const result = buildAnalysisFromEntry(entryWithNulls);
      expect(result.saturated_fat_g).toBeNull();
      expect(result.trans_fat_g).toBeNull();
      expect(result.sugars_g).toBeNull();
      expect(result.calories_from_fat).toBeNull();
    });

    it("coerces null notes/description to empty string", () => {
      const entryWithNulls = { ...existingEntry, notes: null, description: null };
      const result = buildAnalysisFromEntry(entryWithNulls);
      expect(result.notes).toBe("");
      expect(result.description).toBe("");
    });
  });
});
