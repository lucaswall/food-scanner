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

const mockGetEarliestEntryDate = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getEarliestEntryDate: (...args: unknown[]) => mockGetEarliestEntryDate(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { GET } = await import("@/app/api/v1/earliest-entry/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/v1/earliest-entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns date when entries exist", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetEarliestEntryDate.mockResolvedValue("2025-01-15");

    const request = createRequest(
      "http://localhost:3000/api/v1/earliest-entry",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.date).toBe("2025-01-15");
    expect(mockValidateApiRequest).toHaveBeenCalledWith(request);
    expect(mockGetEarliestEntryDate).toHaveBeenCalledWith("user-123", expect.anything());
  });

  it("returns null when no entries exist", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetEarliestEntryDate.mockResolvedValue(null);

    const request = createRequest(
      "http://localhost:3000/api/v1/earliest-entry",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.date).toBeNull();
  });

  it("returns 401 when validateApiRequest returns Response", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest(
      "http://localhost:3000/api/v1/earliest-entry",
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
      "http://localhost:3000/api/v1/earliest-entry",
      { Authorization: "Bearer test-api-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.error.message).toMatch(/too many requests/i);
  });

  it("uses correct rate limit key format: v1:earliest-entry:hashed-<key>", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetEarliestEntryDate.mockResolvedValue(null);

    const request = createRequest(
      "http://localhost:3000/api/v1/earliest-entry",
      { Authorization: "Bearer test-api-key-123" }
    );
    await GET(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "v1:earliest-entry:hashed-test-api",
      60,
      60000
    );
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetEarliestEntryDate.mockResolvedValue(null);

    const request = createRequest(
      "http://localhost:3000/api/v1/earliest-entry",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns ETag header on success response", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetEarliestEntryDate.mockResolvedValue("2025-01-15");

    const request = createRequest(
      "http://localhost:3000/api/v1/earliest-entry",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 Not Modified when If-None-Match matches ETag", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetEarliestEntryDate.mockResolvedValue("2025-01-15");

    const firstRequest = createRequest(
      "http://localhost:3000/api/v1/earliest-entry",
      { Authorization: "Bearer valid-key" }
    );
    const firstResponse = await GET(firstRequest);
    const etag = firstResponse.headers.get("ETag")!;

    const secondRequest = createRequest(
      "http://localhost:3000/api/v1/earliest-entry",
      { Authorization: "Bearer valid-key", "If-None-Match": etag }
    );
    const secondResponse = await GET(secondRequest);

    expect(secondResponse.status).toBe(304);
    expect(await secondResponse.text()).toBe("");
    expect(secondResponse.headers.get("ETag")).toBe(etag);
    expect(secondResponse.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 500 when getEarliestEntryDate throws", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetEarliestEntryDate.mockRejectedValue(new Error("DB error"));

    const request = createRequest(
      "http://localhost:3000/api/v1/earliest-entry",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});
