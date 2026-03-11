import { describe, it, expect, vi, beforeEach } from "vitest";

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

const mockSearchFoods = vi.fn();
vi.mock("@/lib/food-log", () => ({
  searchFoods: (...args: unknown[]) => mockSearchFoods(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { GET } = await import("@/app/api/v1/search-foods/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

const mockFoods = [
  { id: 1, name: "Oatmeal", calories: 150, keywords: ["oatmeal"] },
  { id: 2, name: "Oat Bran", calories: 90, keywords: ["oat", "bran"] },
];

describe("GET /api/v1/search-foods", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns foods for valid q param", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockSearchFoods.mockResolvedValue(mockFoods);

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.foods).toEqual(mockFoods);
    expect(mockValidateApiRequest).toHaveBeenCalledWith(request);
  });

  it("lowercases and splits q by whitespace into keywords passed to searchFoods", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockSearchFoods.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=Chicken+Breast",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockSearchFoods).toHaveBeenCalledWith(
      "user-123",
      ["chicken", "breast"],
      { limit: 10 },
      expect.anything()
    );
  });

  it("returns 400 VALIDATION_ERROR when q param is missing", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Query must be at least 2 characters");
  });

  it("returns 400 VALIDATION_ERROR when q is 1 character", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=a",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Query must be at least 2 characters");
  });

  it("returns 400 VALIDATION_ERROR when q is only whitespace", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=%20%20%20",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Query must contain at least one word");
  });

  it("clamps limit to minimum 1", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockSearchFoods.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat&limit=0",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockSearchFoods).toHaveBeenCalledWith("user-123", ["oat"], { limit: 1 }, expect.anything());
  });

  it("clamps limit to maximum 50", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockSearchFoods.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat&limit=100",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockSearchFoods).toHaveBeenCalledWith("user-123", ["oat"], { limit: 50 }, expect.anything());
  });

  it("defaults limit to 10 when not provided", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockSearchFoods.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat",
      { Authorization: "Bearer valid-key" }
    );
    await GET(request);

    expect(mockSearchFoods).toHaveBeenCalledWith("user-123", ["oat"], { limit: 10 }, expect.anything());
  });

  it("returns 401 for invalid API key", async () => {
    const errorResp = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResp);

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat",
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
      "http://localhost:3000/api/v1/search-foods?q=oat",
      { Authorization: "Bearer test-api-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.error.message).toMatch(/too many requests/i);
  });

  it("uses correct rate limit key with 60 req/min", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockSearchFoods.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat",
      { Authorization: "Bearer test-api-key-123" }
    );
    await GET(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "v1:search-foods:hashed-test-api",
      60,
      60000
    );
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockSearchFoods.mockResolvedValue([]);

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns ETag header on success response", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockSearchFoods.mockResolvedValue(mockFoods);

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockSearchFoods.mockResolvedValue(mockFoods);

    const firstRequest = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat",
      { Authorization: "Bearer valid-key" }
    );
    const firstResponse = await GET(firstRequest);
    const etag = firstResponse.headers.get("ETag")!;

    const secondRequest = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat",
      { Authorization: "Bearer valid-key", "If-None-Match": etag }
    );
    const secondResponse = await GET(secondRequest);

    expect(secondResponse.status).toBe(304);
    expect(await secondResponse.text()).toBe("");
    expect(secondResponse.headers.get("ETag")).toBe(etag);
    expect(secondResponse.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 500 on internal error", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockSearchFoods.mockRejectedValue(new Error("DB error"));

    const request = createRequest(
      "http://localhost:3000/api/v1/search-foods?q=oat",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
    expect(data.error.message).toBe("Failed to search foods");
  });
});
