import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

// Mock session module
const mockGetSession = vi.fn();
const mockValidateSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

// Mock food-log module
const mockGetCustomFoodByShareToken = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getCustomFoodByShareToken: (...args: unknown[]) => mockGetCustomFoodByShareToken(...args),
}));

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
};

vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
  createRequestLogger: vi.fn(() => mockLogger),
}));

const { GET } = await import("@/app/api/shared-food/[token]/route");

const mockSession = {
  userId: "user-uuid-123",
  fitbitConnected: true,
  hasFitbitCredentials: true,
};

const mockFood = {
  id: 42,
  userId: "owner-user-id",
  foodName: "Grilled Chicken",
  amount: "150",
  unitId: 147,
  calories: 250,
  proteinG: "30",
  carbsG: "5",
  fatG: "10",
  fiberG: "2",
  sodiumMg: "400",
  saturatedFatG: null,
  transFatG: null,
  sugarsG: null,
  caloriesFromFat: null,
  fitbitFoodId: 123,
  confidence: "high",
  notes: "Some notes",
  description: "A grilled chicken breast",
  keywords: ["chicken", "protein"],
  isFavorite: false,
  shareToken: "valid-token-12",
  createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(mockSession);
  mockValidateSession.mockReturnValue(null);
});

function makeRequest(token: string) {
  return new Request(`http://localhost:3000/api/shared-food/${token}`);
}

function makeParams(token: string) {
  return { params: Promise.resolve({ token }) };
}

describe("GET /api/shared-food/[token]", () => {
  it("returns food nutrition data in snake_case FoodAnalysis format", async () => {
    mockGetCustomFoodByShareToken.mockResolvedValue(mockFood);

    const response = await GET(makeRequest("valid-token-12"), makeParams("valid-token-12"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.food_name).toBe("Grilled Chicken");
    expect(body.data.calories).toBe(250);
    expect(body.data.protein_g).toBe(30);
    expect(body.data.carbs_g).toBe(5);
    expect(body.data.fat_g).toBe(10);
    expect(body.data.fiber_g).toBe(2);
    expect(body.data.sodium_mg).toBe(400);
    expect(body.data.unit_id).toBe(147);
    expect(body.data.amount).toBe(150);
    expect(body.data.saturated_fat_g).toBeNull();
    expect(body.data.trans_fat_g).toBeNull();
    expect(body.data.sugars_g).toBeNull();
    expect(body.data.calories_from_fat).toBeNull();
    expect(body.data.confidence).toBe("high");
    expect(body.data.notes).toBe("Some notes");
    expect(body.data.description).toBe("A grilled chicken breast");
    expect(body.data.keywords).toEqual(["chicken", "protein"]);
  });

  it("does not return id field", async () => {
    mockGetCustomFoodByShareToken.mockResolvedValue(mockFood);

    const response = await GET(makeRequest("valid-token-12"), makeParams("valid-token-12"));
    const body = await response.json();

    expect(body.data.id).toBeUndefined();
  });

  it("does not use camelCase field names", async () => {
    mockGetCustomFoodByShareToken.mockResolvedValue(mockFood);

    const response = await GET(makeRequest("valid-token-12"), makeParams("valid-token-12"));
    const body = await response.json();

    expect(body.data.foodName).toBeUndefined();
    expect(body.data.proteinG).toBeUndefined();
    expect(body.data.carbsG).toBeUndefined();
    expect(body.data.fatG).toBeUndefined();
    expect(body.data.fiberG).toBeUndefined();
    expect(body.data.sodiumMg).toBeUndefined();
    expect(body.data.unitId).toBeUndefined();
    expect(body.data.saturatedFatG).toBeUndefined();
    expect(body.data.transFatG).toBeUndefined();
    expect(body.data.sugarsG).toBeUndefined();
    expect(body.data.caloriesFromFat).toBeUndefined();
  });

  it("returns 404 for invalid token", async () => {
    mockGetCustomFoodByShareToken.mockResolvedValue(null);

    const response = await GET(makeRequest("bad-token"), makeParams("bad-token"));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("requires authentication (401 without session)", async () => {
    mockValidateSession.mockReturnValue(
      Response.json({ success: false, error: { code: "AUTH_MISSING_SESSION" } }, { status: 401 })
    );

    const response = await GET(makeRequest("valid-token-12"), makeParams("valid-token-12"));

    expect(response.status).toBe(401);
  });

  it("passes token to getCustomFoodByShareToken", async () => {
    mockGetCustomFoodByShareToken.mockResolvedValue(mockFood);

    await GET(makeRequest("abc123"), makeParams("abc123"));

    expect(mockGetCustomFoodByShareToken).toHaveBeenCalledWith("abc123");
  });

  it("returns parsed numeric fields", async () => {
    mockGetCustomFoodByShareToken.mockResolvedValue(mockFood);

    const response = await GET(makeRequest("valid-token-12"), makeParams("valid-token-12"));
    const body = await response.json();

    // proteinG is stored as "30" string but should be returned as number
    expect(typeof body.data.protein_g).toBe("number");
    expect(body.data.protein_g).toBe(30);
  });

  it("does not log the share token value", async () => {
    mockGetCustomFoodByShareToken.mockResolvedValue(mockFood);

    await GET(makeRequest("secret-token-val"), makeParams("secret-token-val"));

    for (const call of [...mockLogger.info.mock.calls, ...mockLogger.warn.mock.calls, ...mockLogger.error.mock.calls]) {
      const logObj = JSON.stringify(call);
      expect(logObj).not.toContain("secret-token-val");
    }
  });
});
