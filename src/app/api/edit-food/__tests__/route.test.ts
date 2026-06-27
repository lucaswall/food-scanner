import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, FoodLogEntryDetail } from "@/types";

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

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
  zoneOffset: "-03:00",
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
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
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

  it("regular path: creates the new log FIRST, then deletes the old log (cleanup) LAST", async () => {
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(200);

    // New ordering (P1-7): create new → DB flip → delete old. A single create, and the
    // old-log delete is cleanup mode (idempotent) and runs last.
    expect(mockCreateNutritionLog).toHaveBeenCalledTimes(1);
    expect(mockDeleteNutritionLogs).toHaveBeenCalledTimes(1);
    expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
      "access-token-abc",
      ["health-log-old-12345"],
      expect.any(Object),
      "user-uuid-123",
      "cleanup",
    );
    // create strictly precedes the old-log delete
    expect(mockCreateNutritionLog.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteNutritionLogs.mock.invocationCallOrder[0],
    );
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

  it("regular path: create failure → maps health error and never deletes (old log intact)", async () => {
    // Create is first; if it fails, nothing was deleted — old log + DB row untouched.
    mockCreateNutritionLog.mockRejectedValue(new Error("HEALTH_API_ERROR"));

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_API_ERROR");

    // No compensation, no deletes — the old log was never touched.
    expect(mockDeleteNutritionLogs).not.toHaveBeenCalled();
    expect(mockUpdateFoodLogEntry).not.toHaveBeenCalled();
  });

  it("regular path: create failure with HEALTH_SCOPE_MISSING returns 403 (no delete)", async () => {
    mockCreateNutritionLog.mockRejectedValue(new Error("HEALTH_SCOPE_MISSING"));

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_SCOPE_MISSING");
    expect(mockDeleteNutritionLogs).not.toHaveBeenCalled();
  });

  it("regular path: DB failure after create → deletes the NEW orphan log (cleanup), returns INTERNAL_ERROR", async () => {
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "new-log-orphan" });
    mockUpdateFoodLogEntry.mockRejectedValue(new Error("DB error"));

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(500);
    const body = await response.json();
    // Clean rollback: only the new (orphan) log is deleted, old log + DB row intact.
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(mockDeleteNutritionLogs).toHaveBeenCalledTimes(1);
    expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
      "access-token-abc",
      ["new-log-orphan"],
      expect.any(Object),
      "user-uuid-123",
      "cleanup",
    );
    // The old log was never deleted (still authoritative); no re-create attempted.
    expect(mockDeleteNutritionLogs).not.toHaveBeenCalledWith(
      expect.anything(),
      ["health-log-old-12345"],
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(mockCreateNutritionLog).toHaveBeenCalledTimes(1);
  });

  it("regular path: DB failure + new-log cleanup also fails → PARTIAL_ERROR", async () => {
    mockCreateNutritionLog.mockResolvedValue({ healthLogId: "new-log-orphan" });
    mockUpdateFoodLogEntry.mockRejectedValue(new Error("DB error"));
    mockDeleteNutritionLogs.mockRejectedValue(new Error("HEALTH_API_ERROR"));

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("PARTIAL_ERROR");
  });

  it("regular path: old-log delete failure AFTER commit → still returns 200 (logged orphan warning)", async () => {
    // Create + DB flip both succeed; only the final old-log cleanup fails. A recoverable
    // duplicate is strictly better than data loss, so the request must NOT fail.
    mockDeleteNutritionLogs.mockRejectedValue(new Error("HEALTH_API_ERROR"));

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.reusedFood).toBe(false);

    const { logger } = await import("@/lib/logger") as unknown as { logger: { error: ReturnType<typeof vi.fn> } };
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ oldHealthLogId: "health-log-old-12345" }),
      expect.stringContaining("CRITICAL"),
    );
  });

  it("regular path: old-log delete drift (HEALTH_LOG_NOT_FOUND) is swallowed by cleanup mode → 200", async () => {
    // cleanup mode already treats NOT_FOUND as already-deleted inside deleteNutritionLogs;
    // the route never needs special drift handling on the old log anymore.
    mockDeleteNutritionLogs.mockResolvedValue(undefined);

    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(200);
    expect(mockCreateNutritionLog).toHaveBeenCalledTimes(1);
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

    it("fast path: creates new log FIRST (entry's own nutrients), then deletes old (cleanup) LAST", async () => {
      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(200);

      expect(mockCreateNutritionLog).toHaveBeenCalledTimes(1);
      expect(mockDeleteNutritionLogs).toHaveBeenCalledTimes(1);
      expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
        "access-token-abc",
        ["health-log-old-12345"],
        expect.any(Object),
        "user-uuid-123",
        "cleanup",
      );
      expect(mockCreateNutritionLog.mock.invocationCallOrder[0]).toBeLessThan(
        mockDeleteNutritionLogs.mock.invocationCallOrder[0],
      );
    });

    it("fast path: returns new healthLogId string in response", async () => {
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "fast-path-new-log" });

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.healthLogId).toBe("fast-path-new-log");
      expect(body.data.reusedFood).toBe(true);
    });

    it("fast path: create failure → maps health error and never deletes (old log intact)", async () => {
      mockCreateNutritionLog.mockRejectedValue(new Error("HEALTH_API_ERROR"));

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error.code).toBe("HEALTH_API_ERROR");
      // Nothing deleted — the old log and DB row are untouched.
      expect(mockDeleteNutritionLogs).not.toHaveBeenCalled();
      expect(mockUpdateFoodLogEntryMetadata).not.toHaveBeenCalled();
    });

    it("fast path: DB failure after create → deletes the NEW orphan log (cleanup), returns INTERNAL_ERROR", async () => {
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "fast-path-new-orphan" });
      mockUpdateFoodLogEntryMetadata.mockRejectedValue(new Error("DB error"));

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(500);
      const body = await response.json();
      // Clean rollback: new orphan deleted, old log + DB row intact.
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(mockDeleteNutritionLogs).toHaveBeenCalledTimes(1);
      expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
        "access-token-abc",
        ["fast-path-new-orphan"],
        expect.any(Object),
        "user-uuid-123",
        "cleanup",
      );
      // Single create — no re-create of the original (it was never touched).
      expect(mockCreateNutritionLog).toHaveBeenCalledTimes(1);
    });

    it("fast path: DB failure + new-log cleanup also fails → PARTIAL_ERROR", async () => {
      mockCreateNutritionLog.mockResolvedValue({ healthLogId: "fast-path-new-orphan" });
      mockUpdateFoodLogEntryMetadata.mockRejectedValue(new Error("DB error"));
      mockDeleteNutritionLogs.mockRejectedValue(new Error("HEALTH_API_ERROR"));

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("PARTIAL_ERROR");
    });

    it("fast path: old-log delete failure AFTER commit → still returns 200 (logged orphan warning)", async () => {
      mockDeleteNutritionLogs.mockRejectedValue(new Error("HEALTH_API_ERROR"));

      const response = await POST(createMockRequest(unchangedBody));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.reusedFood).toBe(true);

      const { logger } = await import("@/lib/logger") as unknown as { logger: { error: ReturnType<typeof vi.fn> } };
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ oldHealthLogId: "health-log-old-12345" }),
        expect.stringContaining("CRITICAL"),
      );
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

  // Task 3: Per-user rate limiting (FOO-1145)
  describe("rate limiting", () => {
    it("returns 429 RATE_LIMIT_EXCEEDED when rate limit is exceeded", async () => {
      mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

      const response = await POST(createMockRequest(validBody));

      expect(response.status).toBe(429);
      const body = await response.json();
      expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("does NOT call createNutritionLog or updateFoodLogEntry when rate limit exceeded", async () => {
      mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

      await POST(createMockRequest(validBody));

      expect(mockEnsureFreshToken).not.toHaveBeenCalled();
      expect(mockCreateNutritionLog).not.toHaveBeenCalled();
      expect(mockUpdateFoodLogEntry).not.toHaveBeenCalled();
    });
  });
});
