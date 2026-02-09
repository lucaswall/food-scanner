import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, FoodLogHistoryEntry } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (
    session: FullSession | null,
  ): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
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

const mockGetFoodLogHistory = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getFoodLogHistory: (...args: unknown[]) => mockGetFoodLogHistory(...args),
}));

const { GET } = await import("@/app/api/food-history/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  destroy: vi.fn(),
};

const sampleEntries: FoodLogHistoryEntry[] = [
  {
    id: 1,
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
    fitbitLogId: 123,
  },
  {
    id: 2,
    foodName: "Rice",
    calories: 200,
    proteinG: 4,
    carbsG: 45,
    fatG: 1,
    fiberG: 1,
    sodiumMg: 5,
    amount: 150,
    unitId: 147,
    mealTypeId: 3,
    date: "2026-02-05",
    time: "12:00:00",
    fitbitLogId: 456,
  },
];

function createRequest(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/food-history", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createRequest("http://localhost:3000/api/food-history");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns food log entries for authenticated user", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue(sampleEntries);

    const request = createRequest("http://localhost:3000/api/food-history");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.entries).toEqual(sampleEntries);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it("sets Cache-Control header for private caching", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const response = await GET(new Request("http://localhost/api/food-history"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("supports endDate query param for pagination", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/food-history?endDate=2026-02-05");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: "2026-02-05",
      cursor: undefined,
      limit: 20,
    });
  });

  it("ignores endDate with invalid format", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/food-history?endDate=not-a-date");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it("ignores endDate with partial date format", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/food-history?endDate=2026-02");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it("supports composite cursor params (lastDate, lastTime, lastId)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([sampleEntries[1]]);

    const request = createRequest(
      "http://localhost:3000/api/food-history?lastDate=2026-02-06&lastTime=12:30:00&lastId=1",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: { lastDate: "2026-02-06", lastTime: "12:30:00", lastId: 1 },
      limit: 20,
    });
  });

  it("supports cursor with null lastTime (missing param)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/food-history?lastDate=2026-02-06&lastId=5",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: { lastDate: "2026-02-06", lastTime: null, lastId: 5 },
      limit: 20,
    });
  });

  it("supports cursor with empty lastTime", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/food-history?lastDate=2026-02-06&lastTime=&lastId=5",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: { lastDate: "2026-02-06", lastTime: null, lastId: 5 },
      limit: 20,
    });
  });

  it("ignores incomplete cursor (lastDate without lastId)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/food-history?lastDate=2026-02-06",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it("supports limit query param", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/food-history?limit=10");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: undefined,
      limit: 10,
    });
  });

  it("caps limit at 50", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/food-history?limit=100");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: undefined,
      limit: 50,
    });
  });

  it("uses default limit of 20 when not specified", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/food-history");
    await GET(request);

    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it("returns empty array when no entries", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/food-history");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.entries).toEqual([]);
  });

  it("ignores invalid limit (non-numeric) and uses default", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/food-history?limit=abc");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: undefined,
      limit: 20,
    });
  });

  it("treats lastTime with invalid format as null", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/food-history?lastDate=2026-02-06&lastTime=invalid&lastId=1",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: { lastDate: "2026-02-06", lastTime: null, lastId: 1 },
      limit: 20,
    });
  });

  it("treats lastTime with partial format as null", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/food-history?lastDate=2026-02-06&lastTime=12:30&lastId=1",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: { lastDate: "2026-02-06", lastTime: null, lastId: 1 },
      limit: 20,
    });
  });

  it("clamps limit=0 to default", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/food-history?limit=0");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: undefined,
      limit: 1,
    });
  });

  it("clamps negative limit to minimum of 1", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/food-history?limit=-5");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: undefined,
      cursor: undefined,
      limit: 1,
    });
  });

  it("supports all params together (endDate, cursor, limit)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetFoodLogHistory.mockResolvedValue(sampleEntries);

    const request = createRequest(
      "http://localhost:3000/api/food-history?endDate=2026-02-06&lastDate=2026-02-05&lastTime=12:00:00&lastId=2&limit=10",
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith("user-uuid-123", {
      endDate: "2026-02-06",
      cursor: { lastDate: "2026-02-05", lastTime: "12:00:00", lastId: 2 },
      limit: 10,
    });
  });
});
