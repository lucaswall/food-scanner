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

vi.mock("@/lib/food-log", () => ({
  getCommonFoods: (...args: unknown[]) => mockGetCommonFoods(...args),
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

describe("GET /api/common-foods", () => {
  it("returns common foods for authenticated user", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      fitbitConnected: true,
    });

    mockGetCommonFoods.mockResolvedValue([
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

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.foods).toHaveLength(1);
    expect(data.data.foods[0].foodName).toBe("Chicken");
    expect(mockGetCommonFoods).toHaveBeenCalledWith(
      "test@example.com",
      expect.stringMatching(/^\d{2}:\d{2}:\d{2}$/),
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

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mockGetCommonFoods).not.toHaveBeenCalled();
  });

  it("returns empty array when no history", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      fitbitConnected: true,
    });

    mockGetCommonFoods.mockResolvedValue([]);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.foods).toEqual([]);
  });

  it("returns 500 when getCommonFoods throws", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      fitbitConnected: true,
    });

    mockGetCommonFoods.mockRejectedValue(new Error("DB connection failed"));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});
