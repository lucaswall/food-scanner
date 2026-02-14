import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

const mockGetSession = vi.fn();
const mockValidateSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

const mockGetCommonFoods = vi.fn();
const mockGetRecentFoods = vi.fn();

vi.mock("@/lib/food-log", () => ({
  getCommonFoods: (...args: unknown[]) => mockGetCommonFoods(...args),
  getRecentFoods: (...args: unknown[]) => mockGetRecentFoods(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateSession.mockReturnValue(null);
});

const { GET } = await import("@/app/api/common-foods/route");

function makeRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:3000/api/common-foods");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

describe("GET /api/common-foods", () => {
  it("returns common foods with nextCursor for authenticated user", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    mockGetCommonFoods.mockResolvedValue({
      foods: [
        {
          customFoodId: 1,
          foodName: "Chicken",
          amount: 150,
          unitId: 147,
          calories: 250,
          proteinG: 30,
          carbsG: 5,
          fatG: 10,
          fiberG: 2,
          sodiumMg: 400,
          fitbitFoodId: 100,
          mealTypeId: 3,
        },
      ],
      nextCursor: { score: 0.85, id: 1 },
    });

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.foods).toHaveLength(1);
    expect(data.data.foods[0].foodName).toBe("Chicken");
    expect(data.data.nextCursor).toEqual({ score: 0.85, id: 1 });
    expect(mockGetCommonFoods).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      { limit: 10, cursor: undefined },
    );
  });

  it("passes limit and cursor query params to getCommonFoods", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const cursor = JSON.stringify({ score: 0.5, id: 10 });
    await GET(makeRequest({ limit: "5", cursor }));

    expect(mockGetCommonFoods).toHaveBeenCalledWith(
      "user-uuid-123",
      expect.any(String),
      expect.any(String),
      { limit: 5, cursor: { score: 0.5, id: 10 } },
    );
  });

  it("returns 401 for unauthenticated user", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateSession.mockReturnValue(
      Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      ),
    );

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(mockGetCommonFoods).not.toHaveBeenCalled();
  });

  it("returns empty array when no history", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.foods).toEqual([]);
    expect(data.data.nextCursor).toBeNull();
  });

  it("sets Cache-Control header for private caching", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const response = await GET(makeRequest());
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 500 when getCommonFoods throws", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    mockGetCommonFoods.mockRejectedValue(new Error("DB connection failed"));

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  describe("tab=recent", () => {
    it("calls getRecentFoods when tab=recent", async () => {
      mockGetSession.mockResolvedValue({
        sessionId: "test-session",
        userId: "user-uuid-123",
        fitbitConnected: true,
      });

      mockGetRecentFoods.mockResolvedValue({
        foods: [
          {
            customFoodId: 1,
            foodName: "Recent Salad",
            amount: 200,
            unitId: 147,
            calories: 100,
            proteinG: 5,
            carbsG: 15,
            fatG: 3,
            fiberG: 4,
            sodiumMg: 150,
            fitbitFoodId: 101,
            mealTypeId: 3,
          },
        ],
        nextCursor: null,
      });

      const response = await GET(makeRequest({ tab: "recent" }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.foods[0].foodName).toBe("Recent Salad");
      expect(mockGetRecentFoods).toHaveBeenCalledWith("user-uuid-123", { limit: 10, cursor: undefined });
      expect(mockGetCommonFoods).not.toHaveBeenCalled();
    });

    it("passes parsed JSON cursor for recent tab", async () => {
      mockGetSession.mockResolvedValue({
        sessionId: "test-session",
        userId: "user-uuid-123",
        fitbitConnected: true,
      });

      mockGetRecentFoods.mockResolvedValue({ foods: [], nextCursor: null });

      const cursor = JSON.stringify({ lastDate: "2026-02-05", lastTime: "12:00:00", lastId: 5 });
      await GET(makeRequest({ tab: "recent", cursor }));

      expect(mockGetRecentFoods).toHaveBeenCalledWith("user-uuid-123", {
        limit: 10,
        cursor: { lastDate: "2026-02-05", lastTime: "12:00:00", lastId: 5 },
      });
    });

    it("returns 400 for invalid cursor JSON in recent tab", async () => {
      mockGetSession.mockResolvedValue({
        sessionId: "test-session",
        userId: "user-uuid-123",
        fitbitConnected: true,
      });

      const response = await GET(makeRequest({ tab: "recent", cursor: "invalid-json" }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for recent cursor with wrong shape (valid JSON)", async () => {
      mockGetSession.mockResolvedValue({
        sessionId: "test-session",
        userId: "user-uuid-123",
        fitbitConnected: true,
      });

      // Valid JSON but wrong shape — missing lastDate, lastId
      const cursor = JSON.stringify({ foo: "bar" });
      const response = await GET(makeRequest({ tab: "recent", cursor }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for recent cursor with non-finite lastId", async () => {
      mockGetSession.mockResolvedValue({
        sessionId: "test-session",
        userId: "user-uuid-123",
        fitbitConnected: true,
      });

      const cursor = JSON.stringify({ lastDate: "2026-02-08", lastTime: "12:00:00", lastId: "not-a-number" });
      const response = await GET(makeRequest({ tab: "recent", cursor }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 for suggested cursor with wrong shape (valid JSON)", async () => {
      mockGetSession.mockResolvedValue({
        sessionId: "test-session",
        userId: "user-uuid-123",
        fitbitConnected: true,
      });

      const cursor = JSON.stringify({ wrong: "shape" });
      const response = await GET(makeRequest({ cursor }));
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("client-provided time/date (FOO-410)", () => {
    it("uses clientTime and clientDate query params for ranking when provided", async () => {
      mockGetSession.mockResolvedValue({
        sessionId: "test-session",
        userId: "user-uuid-123",
        fitbitConnected: true,
      });

      mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

      const response = await GET(makeRequest({ clientTime: "14:30:00", clientDate: "2026-02-14" }));

      expect(response.status).toBe(200);
      expect(mockGetCommonFoods).toHaveBeenCalledWith(
        "user-uuid-123",
        "14:30:00", // Client's local time, not server time
        "2026-02-14", // Client's local date, not server date
        { limit: 10, cursor: undefined },
      );
    });

    it("falls back to server time/date when clientTime and clientDate are not provided", async () => {
      mockGetSession.mockResolvedValue({
        sessionId: "test-session",
        userId: "user-uuid-123",
        fitbitConnected: true,
      });

      mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

      const response = await GET(makeRequest());

      expect(response.status).toBe(200);
      expect(mockGetCommonFoods).toHaveBeenCalledWith(
        "user-uuid-123",
        expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/), // Server-generated time
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), // Server-generated date
        { limit: 10, cursor: undefined },
      );
    });
  });
});
