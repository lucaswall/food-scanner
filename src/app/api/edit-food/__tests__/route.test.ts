import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, FoodLogEntryDetail } from "@/types";

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

const mockGetFoodLogEntryDetail = vi.fn();
const mockUpdateFoodLogEntry = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getFoodLogEntryDetail: (...args: unknown[]) => mockGetFoodLogEntryDetail(...args),
  updateFoodLogEntry: (...args: unknown[]) => mockUpdateFoodLogEntry(...args),
}));

const { POST } = await import("@/app/api/edit-food/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
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
  unitId: 147,
  mealTypeId: 5,
  date: "2026-02-15",
  time: "20:00:00",
  fitbitLogId: 12345,
  confidence: "high",
  isFavorite: false,
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
  mockDeleteFoodLog.mockResolvedValue(undefined);
  mockFindOrCreateFood.mockResolvedValue({ foodId: 9000, reused: false });
  mockLogFood.mockResolvedValue({ foodLog: { logId: 99999 } });
  mockUpdateFoodLogEntry.mockResolvedValue({ fitbitLogId: 99999, newCustomFoodId: 200 });
  vi.stubEnv("FITBIT_DRY_RUN", "false");
});

describe("POST /api/edit-food", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 FITBIT_NOT_CONNECTED without Fitbit", async () => {
    mockGetSession.mockResolvedValue({ ...validSession, fitbitConnected: false });
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_NOT_CONNECTED");
  });

  it("returns 400 for missing entryId", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { entryId, ...bodyWithoutEntryId } = validBody;
    const response = await POST(createMockRequest(bodyWithoutEntryId));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for non-integer entryId", async () => {
    const response = await POST(createMockRequest({ ...validBody, entryId: 1.5 }));
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

  it("returns 400 for invalid date format", async () => {
    const response = await POST(createMockRequest({ ...validBody, date: "not-a-date" }));
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

  it("deletes old Fitbit log and creates new one on success", async () => {
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(200);
    expect(mockDeleteFoodLog).toHaveBeenCalledWith("access-token-abc", 12345, expect.anything());
    expect(mockLogFood).toHaveBeenCalled();
    expect(mockUpdateFoodLogEntry).toHaveBeenCalled();
  });

  it("skips Fitbit delete when entry has no fitbitLogId", async () => {
    mockGetFoodLogEntryDetail.mockResolvedValue({ ...existingEntry, fitbitLogId: null });
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(200);
    expect(mockDeleteFoodLog).not.toHaveBeenCalled();
    expect(mockLogFood).toHaveBeenCalled();
  });

  it("skips Fitbit operations in dry-run mode", async () => {
    vi.stubEnv("FITBIT_DRY_RUN", "true");
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(200);
    expect(mockDeleteFoodLog).not.toHaveBeenCalled();
    expect(mockLogFood).not.toHaveBeenCalled();
    expect(mockUpdateFoodLogEntry).toHaveBeenCalled();
  });

  it("passes new fitbitLogId to updateFoodLogEntry", async () => {
    await POST(createMockRequest(validBody));
    expect(mockUpdateFoodLogEntry).toHaveBeenCalledWith(
      "user-uuid-123",
      42,
      expect.objectContaining({ fitbitLogId: 99999 }),
      expect.anything(),
    );
  });

  it("returns success response with fitbitLogId and entryId", async () => {
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.fitbitLogId).toBe(99999);
    expect(body.data.entryId).toBe(42);
  });

  it("compensates by re-logging original when new Fitbit log fails", async () => {
    mockLogFood.mockRejectedValueOnce(new Error("Fitbit API error"));
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(500);
    expect(mockUpdateFoodLogEntry).not.toHaveBeenCalled();
    // Compensation: re-log original (findOrCreateFood for original entry)
    expect(mockLogFood).toHaveBeenCalledTimes(2);
  });

  it("returns 500 INTERNAL_ERROR when DB update fails after Fitbit success", async () => {
    mockUpdateFoodLogEntry.mockRejectedValueOnce(new Error("DB error"));
    const response = await POST(createMockRequest(validBody));
    expect(response.status).toBe(500);
    // Compensation: delete new Fitbit log
    expect(mockDeleteFoodLog).toHaveBeenCalledWith("access-token-abc", 99999, expect.anything());
  });
});
