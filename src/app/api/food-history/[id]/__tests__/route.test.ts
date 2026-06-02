import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FullSession } from "@/types";

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

const mockGetFoodLogEntry = vi.fn();
const mockDeleteFoodLogEntry = vi.fn();
const mockGetFoodLogEntryDetail = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getFoodLogEntry: (...args: unknown[]) => mockGetFoodLogEntry(...args),
  deleteFoodLogEntry: (...args: unknown[]) => mockDeleteFoodLogEntry(...args),
  getFoodLogEntryDetail: (...args: unknown[]) => mockGetFoodLogEntryDetail(...args),
}));

const mockEnsureFreshToken = vi.fn();
const mockDeleteNutritionLogs = vi.fn();
vi.mock("@/lib/google-health", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  deleteNutritionLogs: (...args: unknown[]) => mockDeleteNutritionLogs(...args),
}));

const { DELETE, GET } = await import("@/app/api/food-history/[id]/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  healthConnected: true,
  destroy: vi.fn(),
};

// Entry with a string healthLogId (Google Health)
const sampleEntry = {
  id: 42,
  foodName: "Chicken Breast",
  calories: 250,
  proteinG: 30,
  carbsG: 0,
  fatG: 5,
  fiberG: 0,
  sodiumMg: 100,
  amount: 200,
  unitId: "g",
  mealTypeId: 3,
  date: "2026-02-06",
  time: "12:30:00",
  healthLogId: "health-log-id-789",
};

function createRequest(): Request {
  return new Request("http://localhost:3000/api/food-history/42", {
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("HEALTH_DRY_RUN", "");
});

afterEach(() => {
  vi.stubEnv("HEALTH_DRY_RUN", "");
});

describe("DELETE /api/food-history/[id]", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);
    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 HEALTH_NOT_CONNECTED without health connection", async () => {
    mockGetSession.mockResolvedValue({ ...validSession, healthConnected: false });
    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_NOT_CONNECTED");
  });

  it("returns 400 for invalid id", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "not-a-number" }) });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when entry not found", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(null);
    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("deletes remote health log then DB row and returns success", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockDeleteNutritionLogs.mockResolvedValue(undefined);
    mockDeleteFoodLogEntry.mockResolvedValue(undefined);

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(200);

    expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-uuid-123", expect.any(Object));
    expect(mockDeleteNutritionLogs).toHaveBeenCalledWith(
      "fresh-token",
      ["health-log-id-789"],
      expect.any(Object),
      "user-uuid-123",
      "user",
    );
    expect(mockDeleteFoodLogEntry).toHaveBeenCalledWith("user-uuid-123", 42, expect.any(Object));

    const body = await response.json();
    expect(body.data.deleted).toBe(true);
  });

  it("skips remote delete when entry has no healthLogId", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue({ ...sampleEntry, healthLogId: null });
    mockDeleteFoodLogEntry.mockResolvedValue(undefined);

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(200);

    expect(mockEnsureFreshToken).not.toHaveBeenCalled();
    expect(mockDeleteNutritionLogs).not.toHaveBeenCalled();
    expect(mockDeleteFoodLogEntry).toHaveBeenCalled();
  });

  it("skips remote delete in HEALTH_DRY_RUN mode", async () => {
    vi.stubEnv("HEALTH_DRY_RUN", "true");
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockDeleteFoodLogEntry.mockResolvedValue(undefined);

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(200);

    expect(mockEnsureFreshToken).not.toHaveBeenCalled();
    expect(mockDeleteNutritionLogs).not.toHaveBeenCalled();
    expect(mockDeleteFoodLogEntry).toHaveBeenCalled();
  });

  it("returns 401 HEALTH_TOKEN_INVALID on invalid token", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockRejectedValue(new Error("HEALTH_TOKEN_INVALID"));

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_TOKEN_INVALID");
  });

  it("returns 502 HEALTH_API_ERROR on delete failure", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockDeleteNutritionLogs.mockRejectedValue(new Error("HEALTH_API_ERROR"));

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_API_ERROR");
  });

  it("still deletes the local row (200) when Health reports the entry already gone (HEALTH_LOG_NOT_FOUND drift)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockDeleteNutritionLogs.mockRejectedValue(new Error("HEALTH_LOG_NOT_FOUND"));
    mockDeleteFoodLogEntry.mockResolvedValue(undefined);

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });

    // drift is surfaced in logs, but the user is not stranded — local row is removed
    expect(mockDeleteFoodLogEntry).toHaveBeenCalledWith("user-uuid-123", 42, expect.any(Object));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.deleted).toBe(true);
  });

  it("returns 503 HEALTH_RATE_LIMIT_LOW on rate limit", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockRejectedValue(new Error("HEALTH_RATE_LIMIT_LOW"));

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_RATE_LIMIT_LOW");
  });

  it("returns 504 HEALTH_TIMEOUT when ensureFreshToken times out", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockRejectedValue(new Error("HEALTH_TIMEOUT"));

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(504);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_TIMEOUT");
  });

  it("returns 429 HEALTH_RATE_LIMIT when deleteNutritionLogs is rate-limited", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockDeleteNutritionLogs.mockRejectedValue(new Error("HEALTH_RATE_LIMIT"));

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_RATE_LIMIT");
  });

  it("returns 403 HEALTH_SCOPE_MISSING when Google Health scope is missing", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockRejectedValue(new Error("HEALTH_SCOPE_MISSING"));

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("HEALTH_SCOPE_MISSING");
  });

  it("returns 500 INTERNAL_ERROR when DB delete fails after remote success", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockDeleteNutritionLogs.mockResolvedValue(undefined);
    mockDeleteFoodLogEntry.mockRejectedValue(new Error("DB error"));

    const response = await DELETE(createRequest(), { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});

describe("GET /api/food-history/[id]", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);
    const request = new Request("http://localhost:3000/api/food-history/42");
    const response = await GET(request, { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(401);
  });

  it("returns 404 when entry not found", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntryDetail.mockResolvedValue(null);
    const request = new Request("http://localhost:3000/api/food-history/42");
    const response = await GET(request, { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(404);
  });

  it("returns 200 with entry detail", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntryDetail.mockResolvedValue({
      ...sampleEntry,
      customFoodId: 10,
      description: null,
      notes: null,
      confidence: "high",
      isFavorite: false,
      keywords: [],
    });
    const request = new Request("http://localhost:3000/api/food-history/42");
    const response = await GET(request, { params: Promise.resolve({ id: "42" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.foodName).toBe("Chicken Breast");
    expect(body.data.healthLogId).toBe("health-log-id-789");
  });
});
