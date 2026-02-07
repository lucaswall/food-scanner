import { describe, it, expect, vi, beforeEach } from "vitest";
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
    return null;
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockGetFoodLogEntry = vi.fn();
const mockDeleteFoodLogEntry = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getFoodLogEntry: (...args: unknown[]) => mockGetFoodLogEntry(...args),
  deleteFoodLogEntry: (...args: unknown[]) => mockDeleteFoodLogEntry(...args),
}));

const mockEnsureFreshToken = vi.fn();
const mockDeleteFoodLog = vi.fn();
vi.mock("@/lib/fitbit", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  deleteFoodLog: (...args: unknown[]) => mockDeleteFoodLog(...args),
}));

const { DELETE } = await import("@/app/api/food-history/[id]/route");

const validSession: FullSession = {
  sessionId: "test-session",
  email: "test@example.com",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
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
    expect(body.error.code).toBe("VALIDATION_ERROR");
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
    expect(mockEnsureFreshToken).toHaveBeenCalledWith("test@example.com");
    expect(mockDeleteFoodLog).toHaveBeenCalledWith("fresh-token", 789);
    expect(mockDeleteFoodLogEntry).toHaveBeenCalledWith("test@example.com", 42);
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
    expect(mockDeleteFoodLogEntry).toHaveBeenCalledWith("test@example.com", 42);
  });

  it("returns error if Fitbit delete fails (local entry NOT deleted)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockDeleteFoodLog.mockRejectedValue(new Error("FITBIT_API_ERROR"));

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "42" }) });

    expect(response.status).toBe(500);
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

  it("looks up entry with correct email and id", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogEntry.mockResolvedValue(sampleEntry);
    mockEnsureFreshToken.mockResolvedValue("fresh-token");
    mockDeleteFoodLog.mockResolvedValue(undefined);
    mockDeleteFoodLogEntry.mockResolvedValue(undefined);

    const request = createRequest();
    await DELETE(request, { params: Promise.resolve({ id: "42" }) });

    expect(mockGetFoodLogEntry).toHaveBeenCalledWith("test@example.com", 42);
  });
});
