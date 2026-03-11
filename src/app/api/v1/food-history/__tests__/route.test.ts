import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FoodLogHistoryEntry } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockValidateApiRequest = vi.fn();
vi.mock("@/lib/api-auth", () => ({
  validateApiRequest: (...args: unknown[]) => mockValidateApiRequest(...args),
  hashForRateLimit: (key: string) => `hashed-${key.slice(0, 8)}`,
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const mockGetFoodLogHistory = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getFoodLogHistory: (...args: unknown[]) => mockGetFoodLogHistory(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { GET } = await import("@/app/api/v1/food-history/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

const mockEntry: FoodLogHistoryEntry = {
  id: 1,
  customFoodId: 10,
  foodName: "Oatmeal",
  calories: 150,
  proteinG: 5,
  carbsG: 27,
  fatG: 3,
  fiberG: 4,
  sodiumMg: 0,
  saturatedFatG: 0.5,
  transFatG: 0,
  sugarsG: 1,
  caloriesFromFat: 27,
  amount: 1,
  unitId: 304,
  mealTypeId: 1,
  date: "2026-02-10",
  time: "08:00:00",
  fitbitLogId: null,
  isFavorite: false,
};

describe("GET /api/v1/food-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns paginated entries for valid auth and default params", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFoodLogHistory.mockResolvedValue([mockEntry]);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-history",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.entries).toHaveLength(1);
    expect(data.data.entries[0].id).toBe(1);
    expect(mockValidateApiRequest).toHaveBeenCalledWith(request);
    expect(mockGetFoodLogHistory).toHaveBeenCalledWith(
      "user-123",
      { endDate: undefined, cursor: undefined, limit: 20 },
      expect.anything()
    );
  });

  it("passes cursor params when lastDate and lastId provided", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-history?lastDate=2026-02-10&lastTime=08:00:00&lastId=5",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockGetFoodLogHistory).toHaveBeenCalledWith(
      "user-123",
      {
        endDate: undefined,
        cursor: { lastDate: "2026-02-10", lastTime: "08:00:00", lastId: 5 },
        limit: 20,
      },
      expect.anything()
    );
  });

  it("passes cursor with null lastTime when lastTime is missing", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-history?lastDate=2026-02-10&lastId=5",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockGetFoodLogHistory).toHaveBeenCalledWith(
      "user-123",
      {
        endDate: undefined,
        cursor: { lastDate: "2026-02-10", lastTime: null, lastId: 5 },
        limit: 20,
      },
      expect.anything()
    );
  });

  it("passes endDate filter when provided", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-history?endDate=2026-02-15",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockGetFoodLogHistory).toHaveBeenCalledWith(
      "user-123",
      { endDate: "2026-02-15", cursor: undefined, limit: 20 },
      expect.anything()
    );
  });

  it("clamps limit to min 1 and max 50, defaults to 20", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFoodLogHistory.mockResolvedValue([]);

    // Too large
    const r1 = createRequest(
      "http://localhost:3000/api/v1/food-history?limit=100",
      { Authorization: "Bearer valid-key" }
    );
    await GET(r1);
    expect(mockGetFoodLogHistory).toHaveBeenLastCalledWith("user-123", expect.objectContaining({ limit: 50 }), expect.anything());

    // Too small
    const r2 = createRequest(
      "http://localhost:3000/api/v1/food-history?limit=0",
      { Authorization: "Bearer valid-key" }
    );
    await GET(r2);
    expect(mockGetFoodLogHistory).toHaveBeenLastCalledWith("user-123", expect.objectContaining({ limit: 1 }), expect.anything());

    // Default (no param)
    const r3 = createRequest(
      "http://localhost:3000/api/v1/food-history",
      { Authorization: "Bearer valid-key" }
    );
    await GET(r3);
    expect(mockGetFoodLogHistory).toHaveBeenLastCalledWith("user-123", expect.objectContaining({ limit: 20 }), expect.anything());
  });

  it("returns 401 when validateApiRequest returns Response", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-history",
      { Authorization: "Bearer invalid-key" }
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const request = createRequest(
      "http://localhost:3000/api/v1/food-history",
      { Authorization: "Bearer test-api-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.error.message).toMatch(/too many requests/i);
  });

  it("uses correct rate limit key format: v1:food-history:hashed-<key>", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-history",
      { Authorization: "Bearer test-api-key-123" }
    );
    await GET(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "v1:food-history:hashed-test-api",
      60,
      60000
    );
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFoodLogHistory.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-history",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns ETag header on success response", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFoodLogHistory.mockResolvedValue([mockEntry]);

    const request = createRequest(
      "http://localhost:3000/api/v1/food-history",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 Not Modified when If-None-Match matches ETag", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFoodLogHistory.mockResolvedValue([mockEntry]);

    const firstRequest = createRequest(
      "http://localhost:3000/api/v1/food-history",
      { Authorization: "Bearer valid-key" }
    );
    const firstResponse = await GET(firstRequest);
    const etag = firstResponse.headers.get("ETag")!;

    const secondRequest = createRequest(
      "http://localhost:3000/api/v1/food-history",
      { Authorization: "Bearer valid-key", "If-None-Match": etag }
    );
    const secondResponse = await GET(secondRequest);

    expect(secondResponse.status).toBe(304);
    expect(await secondResponse.text()).toBe("");
    expect(secondResponse.headers.get("ETag")).toBe(etag);
    expect(secondResponse.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 500 when getFoodLogHistory throws", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFoodLogHistory.mockRejectedValue(new Error("DB connection failed"));

    const request = createRequest(
      "http://localhost:3000/api/v1/food-history",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});
