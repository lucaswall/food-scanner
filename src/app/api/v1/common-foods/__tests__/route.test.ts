import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommonFood, CommonFoodsCursor, RecentFoodsCursor } from "@/types";

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

const mockGetCommonFoods = vi.fn();
const mockGetRecentFoods = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getCommonFoods: (...args: unknown[]) => mockGetCommonFoods(...args),
  getRecentFoods: (...args: unknown[]) => mockGetRecentFoods(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockIsValidDateFormat = vi.fn();
vi.mock("@/lib/date-utils", () => ({
  isValidDateFormat: (...args: unknown[]) => mockIsValidDateFormat(...args),
}));

const { GET } = await import("@/app/api/v1/common-foods/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

const mockFood: CommonFood = {
  customFoodId: 1,
  foodName: "Oatmeal",
  amount: 1,
  unitId: 304,
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
  fitbitFoodId: 123,
  mealTypeId: 1,
  isFavorite: false,
};

describe("GET /api/v1/common-foods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsValidDateFormat.mockReturnValue(true);
  });

  // --- Default tab (foods) ---

  it("returns foods and nextCursor from getCommonFoods (default tab)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    const cursor: CommonFoodsCursor = { score: 0.9, id: 3 };
    mockGetCommonFoods.mockResolvedValue({ foods: [mockFood], nextCursor: cursor });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.foods).toEqual([mockFood]);
    expect(data.data.nextCursor).toEqual(cursor);
    expect(mockGetCommonFoods).toHaveBeenCalled();
  });

  it("passes clientDate and clientTime to getCommonFoods", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods?clientDate=2026-03-01&clientTime=08:30",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockGetCommonFoods).toHaveBeenCalledWith(
      "user-123",
      "08:30",
      "2026-03-01",
      expect.objectContaining({ limit: 10 }),
      expect.anything()
    );
  });

  it("parses score-based cursor and passes to getCommonFoods", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const cursor = { score: 0.95, id: 5 };
    const request = createRequest(
      `http://localhost:3000/api/v1/common-foods?cursor=${encodeURIComponent(JSON.stringify(cursor))}`,
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockGetCommonFoods).toHaveBeenCalledWith(
      "user-123",
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ cursor: { score: 0.95, id: 5 } }),
      expect.anything()
    );
  });

  it("returns 400 for invalid clientDate format", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockIsValidDateFormat.mockReturnValueOnce(false);

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods?clientDate=not-a-date",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/clientDate/i);
  });

  it("returns 400 for invalid clientTime format", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods?clientTime=25:99",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/clientTime/i);
  });

  it("returns 400 for invalid cursor JSON (default tab)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods?cursor=not-json",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/cursor/i);
  });

  it("returns 400 for invalid cursor shape (missing score/id)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      `http://localhost:3000/api/v1/common-foods?cursor=${encodeURIComponent(JSON.stringify({ foo: "bar" }))}`,
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  // --- Recent tab ---

  it("returns foods and nextCursor from getRecentFoods (tab=recent)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    const cursor: RecentFoodsCursor = { lastDate: "2026-03-01", lastTime: null, lastId: 5 };
    mockGetRecentFoods.mockResolvedValue({ foods: [mockFood], nextCursor: cursor });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods?tab=recent",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.foods).toEqual([mockFood]);
    expect(data.data.nextCursor).toEqual(cursor);
    expect(mockGetRecentFoods).toHaveBeenCalled();
    expect(mockGetCommonFoods).not.toHaveBeenCalled();
  });

  it("parses time-based cursor and passes to getRecentFoods", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetRecentFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const cursor = { lastDate: "2026-03-01", lastTime: null, lastId: 5 };
    const request = createRequest(
      `http://localhost:3000/api/v1/common-foods?tab=recent&cursor=${encodeURIComponent(JSON.stringify(cursor))}`,
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockGetRecentFoods).toHaveBeenCalledWith(
      "user-123",
      expect.objectContaining({ cursor: { lastDate: "2026-03-01", lastTime: null, lastId: 5 } }),
      expect.anything()
    );
  });

  it("returns 400 for invalid cursor format (tab=recent)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods?tab=recent&cursor=not-json",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  // --- Shared tests ---

  it("clamps limit to minimum 1", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods?limit=0",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockGetCommonFoods).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ limit: 1 }),
      expect.anything()
    );
  });

  it("clamps limit to maximum 50", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods?limit=100",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockGetCommonFoods).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ limit: 50 }),
      expect.anything()
    );
  });

  it("defaults limit to 10 when not provided", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockGetCommonFoods).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ limit: 10 }),
      expect.anything()
    );
  });

  it("returns 401 when auth fails", async () => {
    const errorResp = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Not authenticated" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResp);

    const request = createRequest("http://localhost:3000/api/v1/common-foods");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods",
      { Authorization: "Bearer test-api-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.error.message).toMatch(/too many requests/i);
  });

  it("uses correct rate limit key: v1:common-foods:hashed-<key> with 60 req/min", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods",
      { Authorization: "Bearer test-api-key-456" }
    );
    await GET(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "v1:common-foods:hashed-test-api",
      60,
      60000
    );
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns ETag header on success response", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetCommonFoods.mockResolvedValue({ foods: [], nextCursor: null });

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetCommonFoods.mockResolvedValue({ foods: [mockFood], nextCursor: null });

    const firstRequest = createRequest(
      "http://localhost:3000/api/v1/common-foods",
      { Authorization: "Bearer valid-key" }
    );
    const firstResponse = await GET(firstRequest);
    const etag = firstResponse.headers.get("ETag")!;

    const secondRequest = createRequest(
      "http://localhost:3000/api/v1/common-foods",
      { Authorization: "Bearer valid-key", "If-None-Match": etag }
    );
    const secondResponse = await GET(secondRequest);

    expect(secondResponse.status).toBe(304);
    expect(await secondResponse.text()).toBe("");
    expect(secondResponse.headers.get("ETag")).toBe(etag);
    expect(secondResponse.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 500 on internal error (default tab)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetCommonFoods.mockRejectedValue(new Error("DB error"));

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns 500 on internal error (tab=recent)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetRecentFoods.mockRejectedValue(new Error("DB error"));

    const request = createRequest(
      "http://localhost:3000/api/v1/common-foods?tab=recent",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});
