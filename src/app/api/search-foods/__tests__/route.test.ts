import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

const mockGetSession = vi.fn();
const mockValidateSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

const mockSearchFoods = vi.fn();

vi.mock("@/lib/food-log", () => ({
  searchFoods: (...args: unknown[]) => mockSearchFoods(...args),
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

const { GET } = await import("@/app/api/search-foods/route");

function makeRequest(params: Record<string, string> = {}): Request {
  const url = new URL("http://localhost:3000/api/search-foods");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return new Request(url.toString());
}

describe("GET /api/search-foods", () => {
  it("returns matching foods for valid query", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    mockSearchFoods.mockResolvedValue([
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
    ]);

    const response = await GET(makeRequest({ q: "chicken" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.foods).toHaveLength(1);
    expect(data.data.foods[0].foodName).toBe("Chicken");
    expect(mockSearchFoods).toHaveBeenCalledWith("user-uuid-123", "chicken", { limit: 10 });
  });

  it("passes limit param to searchFoods", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    mockSearchFoods.mockResolvedValue([]);

    await GET(makeRequest({ q: "rice", limit: "5" }));

    expect(mockSearchFoods).toHaveBeenCalledWith("user-uuid-123", "rice", { limit: 5 });
  });

  it("returns 400 when query is missing", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    const response = await GET(makeRequest());
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(mockSearchFoods).not.toHaveBeenCalled();
  });

  it("returns 400 when query is less than 2 characters", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    const response = await GET(makeRequest({ q: "a" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 for unauthenticated user", async () => {
    mockGetSession.mockResolvedValue(null);
    mockValidateSession.mockReturnValue(
      Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      ),
    );

    const response = await GET(makeRequest({ q: "chicken" }));

    expect(response.status).toBe(401);
    expect(mockSearchFoods).not.toHaveBeenCalled();
  });

  it("sets Cache-Control header", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    mockSearchFoods.mockResolvedValue([]);

    const response = await GET(makeRequest({ q: "test" }));
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=30, stale-while-revalidate=60");
  });

  it("returns 500 when searchFoods throws", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      fitbitConnected: true,
    });

    mockSearchFoods.mockRejectedValue(new Error("DB error"));

    const response = await GET(makeRequest({ q: "chicken" }));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});
