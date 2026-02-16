import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

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

const mockFindMatchingFoods = vi.fn();
vi.mock("@/lib/food-matching", () => ({
  findMatchingFoods: (...args: unknown[]) => mockFindMatchingFoods(...args),
}));

const { POST } = await import("@/app/api/find-matches/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

const validBody = {
  food_name: "Tea with milk",
  amount: 1,
  unit_id: 91,
  calories: 50,
  protein_g: 2,
  carbs_g: 5,
  fat_g: 2,
  fiber_g: 0,
  sodium_mg: 10,
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high",
  notes: "",
  keywords: ["tea", "milk"],
};

function createMockRequest(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMatchingFoods.mockResolvedValue([]);
});

describe("POST /api/find-matches", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createMockRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 for missing keywords", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const bodyWithoutKeywords = { ...validBody };
    delete (bodyWithoutKeywords as Record<string, unknown>).keywords;
    const request = createMockRequest(bodyWithoutKeywords);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid keywords (not an array)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({ ...validBody, keywords: "not-an-array" });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns empty matches when no similar foods exist", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFindMatchingFoods.mockResolvedValue([]);

    const request = createMockRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.matches).toEqual([]);
  });

  it("returns up to 3 matches with correct shape", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const mockMatches = [
      {
        customFoodId: 1,
        foodName: "Tea with milk",
        calories: 50,
        proteinG: 2,
        carbsG: 5,
        fatG: 2,
        fitbitFoodId: 100,
        matchRatio: 1.0,
        lastLoggedAt: new Date("2026-01-15"),
        amount: 1,
        unitId: 91,
      },
      {
        customFoodId: 2,
        foodName: "Tea with milk and honey",
        calories: 55,
        proteinG: 2,
        carbsG: 6,
        fatG: 2,
        fitbitFoodId: 101,
        matchRatio: 1.0,
        lastLoggedAt: new Date("2026-01-20"),
        amount: 1,
        unitId: 91,
      },
      {
        customFoodId: 3,
        foodName: "Tea",
        calories: 45,
        proteinG: 1,
        carbsG: 4,
        fatG: 1,
        fitbitFoodId: 102,
        matchRatio: 0.5,
        lastLoggedAt: new Date("2026-01-25"),
        amount: 1,
        unitId: 91,
      },
    ];
    mockFindMatchingFoods.mockResolvedValue(mockMatches);

    const request = createMockRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.matches).toHaveLength(3);
    expect(body.data.matches[0].customFoodId).toBe(1);
    expect(body.data.matches[0].matchRatio).toBe(1.0);
    expect(mockFindMatchingFoods).toHaveBeenCalledWith("user-uuid-123", validBody);
  });

  it("returns 400 when keywords present but nutrient fields missing", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({ keywords: ["tea"] });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("Missing required fields");
  });

  it("returns 400 when calories is not a number", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({ ...validBody, calories: "fifty" });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when food_name is missing", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const bodyWithoutFoodName = { ...validBody };
    delete (bodyWithoutFoodName as Record<string, unknown>).food_name;
    const request = createMockRequest(bodyWithoutFoodName);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("succeeds with all required fields present", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFindMatchingFoods.mockResolvedValue([]);

    const request = createMockRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("handles findMatchingFoods errors gracefully", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFindMatchingFoods.mockRejectedValue(new Error("DB connection failed"));

    const request = createMockRequest(validBody);
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  describe("FOO-416: handle empty keywords array", () => {
    it("returns empty matches for empty keywords array instead of 400", async () => {
      mockGetSession.mockResolvedValue(validSession);
      mockFindMatchingFoods.mockResolvedValue([]);

      const bodyWithEmptyKeywords = { ...validBody, keywords: [] };
      const request = createMockRequest(bodyWithEmptyKeywords);
      const response = await POST(request);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.data.matches).toEqual([]);
    });
  });
});
