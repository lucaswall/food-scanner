import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { FullSession } from "@/types";

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

const mockGetFoodLogEntry = vi.fn();
const mockDeleteFoodLogEntry = vi.fn();
const mockGetFoodLogEntryDetail = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getFoodLogEntry: (...args: unknown[]) => mockGetFoodLogEntry(...args),
  deleteFoodLogEntry: (...args: unknown[]) => mockDeleteFoodLogEntry(...args),
  getFoodLogEntryDetail: (...args: unknown[]) => mockGetFoodLogEntryDetail(...args),
}));

const mockEnsureFreshToken = vi.fn();
const mockDeleteFoodLog = vi.fn();
vi.mock("@/lib/fitbit", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  deleteFoodLog: (...args: unknown[]) => mockDeleteFoodLog(...args),
}));

const { DELETE, GET } = await import("@/app/api/food-history/[id]/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

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
  unitId: 147,
  mealTypeId: 3,
  date: "2026-02-06",
  time: "12:30:00",
  fitbitLogId: 789,
};

function createRequest(): Request {
  return new Request("http://localhost:3000/api/food-history/42", {
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DELETE /api/food-history/[id]", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 when Fitbit not connected", async () => {
    mockGetSession.mockResolvedValue({ ...validSession, fitbitConnected: false });

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_NOT_CONNECTED");
  });

  it("returns 400 for invalid id (non-numeric)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "abc" }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when entry not found", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(null);

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("not found");
  });

  it("deletes from Fitbit and local DB when fitbitLogId exists", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockDeleteFoodLog.mockResolvedValue(undefined);
    mockDeleteFoodLogEntry.mockResolvedValue(undefined);

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.deleted).toBe(true);
    expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-uuid-123", expect.any(Object));
    expect(mockDeleteFoodLog).toHaveBeenCalledWith("fresh-token", 789, expect.any(Object));
    expect(mockDeleteFoodLogEntry).toHaveBeenCalledWith("user-uuid-123", 42, expect.anything());
  });

  it("deletes local only when fitbitLogId is null", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue({ ...sampleEntry, fitbitLogId: null });
    mockDeleteFoodLogEntry.mockResolvedValue(undefined);

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.deleted).toBe(true);
    expect(mockEnsureFreshToken).not.toHaveBeenCalled();
    expect(mockDeleteFoodLog).not.toHaveBeenCalled();
    expect(mockDeleteFoodLogEntry).toHaveBeenCalledWith("user-uuid-123", 42, expect.anything());
  });

  it("returns error if Fitbit delete fails (local entry NOT deleted)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockDeleteFoodLog.mockRejectedValue(new Error("FITBIT_API_ERROR"));

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_API_ERROR");
    expect(mockDeleteFoodLogEntry).not.toHaveBeenCalled();
  });

  it("handles FITBIT_TOKEN_INVALID and returns 401", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_TOKEN_INVALID"));

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_TOKEN_INVALID");
    expect(mockDeleteFoodLogEntry).not.toHaveBeenCalled();
  });

  it("looks up entry with correct userId and id", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockDeleteFoodLog.mockResolvedValue(undefined);
    mockDeleteFoodLogEntry.mockResolvedValue(undefined);

    const request = createRequest();
    await DELETE(request, { params: Promise.resolve({ id: "42" }) });

    expect(mockGetFoodLogEntry).toHaveBeenCalledWith("user-uuid-123", 42);
  });

  describe("FITBIT_DRY_RUN=true", () => {
    it("skips Fitbit delete when entry has fitbitLogId", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
      mockDeleteFoodLogEntry.mockResolvedValue(undefined);

      const request = createRequest();
      const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
      expect(mockEnsureFreshToken).not.toHaveBeenCalled();
      expect(mockDeleteFoodLog).not.toHaveBeenCalled();
      expect(mockDeleteFoodLogEntry).toHaveBeenCalledWith("user-uuid-123", 42, expect.anything());
    });

    it("proceeds with DB delete when entry has null fitbitLogId", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockGetFoodLogEntry.mockResolvedValue({ ...sampleEntry, fitbitLogId: null });
      mockDeleteFoodLogEntry.mockResolvedValue(undefined);

      const request = createRequest();
      const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
      expect(mockEnsureFreshToken).not.toHaveBeenCalled();
      expect(mockDeleteFoodLog).not.toHaveBeenCalled();
      expect(mockDeleteFoodLogEntry).toHaveBeenCalledWith("user-uuid-123", 42, expect.anything());
    });
  });

  describe("partial failure handling", () => {
    it("returns error when Fitbit delete succeeds but DB delete fails", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockDeleteFoodLog.mockResolvedValue(undefined);
      mockDeleteFoodLogEntry.mockRejectedValue(new Error("DB connection failed"));

      const { logger } = await import("@/lib/logger");

      const request = createRequest();
      const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
      expect(body.error.message).toContain("local delete failed");
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "delete_food_log_db_error",
          entryId: 42,
        }),
        expect.stringContaining("Fitbit delete succeeded but local DB delete failed"),
      );
    });

    it("returns error when DB delete fails in dry-run mode", async () => {
      vi.stubEnv("FITBIT_DRY_RUN", "true");
      mockGetSession.mockResolvedValue(validSession);
      mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
      mockDeleteFoodLogEntry.mockRejectedValue(new Error("DB connection failed"));

      const request = createRequest();
      const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error.code).toBe("INTERNAL_ERROR");
    });
  });

  describe("FITBIT_DRY_RUN not set", () => {
    it("existing Fitbit delete behavior works when entry has fitbitLogId", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
      mockEnsureFreshToken.mockResolvedValue("fresh-token");
      mockDeleteFoodLog.mockResolvedValue(undefined);
      mockDeleteFoodLogEntry.mockResolvedValue(undefined);

      const request = createRequest();
      const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.deleted).toBe(true);
      expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-uuid-123", expect.any(Object));
      expect(mockDeleteFoodLog).toHaveBeenCalledWith("fresh-token", 789, expect.any(Object));
      expect(mockDeleteFoodLogEntry).toHaveBeenCalledWith("user-uuid-123", 42, expect.anything());
    });
  });
});

describe("GET /api/food-history/[id]", () => {
  const entryDetail = {
    id: 42,
    foodName: "Chicken Breast",
    calories: 250,
    proteinG: 30,
    carbsG: 0,
    fatG: 5,
    fiberG: 0,
    sodiumMg: 100,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns entry detail for valid id", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntryDetail.mockResolvedValue(entryDetail);

    const request = new Request("http://localhost:3000/api/food-history/42");
    const response = await GET(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(entryDetail);
  });

  it("returns 404 when entry not found", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntryDetail.mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/food-history/99");
    const response = await GET(request, { params: Promise.resolve({ id: "99" }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns ETag header on success response", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntryDetail.mockResolvedValue(entryDetail);

    const request = new Request("http://localhost:3000/api/food-history/42");
    const response = await GET(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntryDetail.mockResolvedValue(entryDetail);

    const response1 = await GET(
      new Request("http://localhost:3000/api/food-history/42"),
      { params: Promise.resolve({ id: "42" }) },
    );
    const etag = response1.headers.get("ETag")!;

    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntryDetail.mockResolvedValue(entryDetail);

    const response2 = await GET(
      new Request("http://localhost:3000/api/food-history/42", {
        headers: { "if-none-match": etag },
      }),
      { params: Promise.resolve({ id: "42" }) },
    );

    expect(response2.status).toBe(304);
    expect(response2.headers.get("ETag")).toBe(etag);
    expect(response2.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});
