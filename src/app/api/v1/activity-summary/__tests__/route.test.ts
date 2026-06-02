import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivitySummary } from "@/types";

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

const mockGetCachedHealthActivitySummary = vi.fn();
vi.mock("@/lib/health-cache", () => ({
  getCachedHealthActivitySummary: (...args: unknown[]) => mockGetCachedHealthActivitySummary(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { GET } = await import("@/app/api/v1/activity-summary/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/v1/activity-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
  });

  it("returns activity summary for valid API key and date", async () => {
    const mockActivity: ActivitySummary = { caloriesOut: 2500 };
    mockGetCachedHealthActivitySummary.mockResolvedValue(mockActivity);

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockActivity);
    expect(mockValidateApiRequest).toHaveBeenCalledWith(request);
    expect(mockGetCachedHealthActivitySummary).toHaveBeenCalledWith(
      "user-123",
      "2026-02-11",
      expect.any(Object),
      "important",
      null,
    );
  });

  it("passes a valid zoneOffset query param through to the cache layer", async () => {
    const mockActivity: ActivitySummary = { caloriesOut: 2500 };
    mockGetCachedHealthActivitySummary.mockResolvedValue(mockActivity);

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11&zoneOffset=-03:00",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetCachedHealthActivitySummary).toHaveBeenCalledWith(
      "user-123",
      "2026-02-11",
      expect.any(Object),
      "important",
      "-03:00",
    );
  });

  it("returns 400 for an invalid zoneOffset format", async () => {
    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11&zoneOffset=bad",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/zoneOffset/i);
    expect(mockGetCachedHealthActivitySummary).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid API key", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer invalid-key" }
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns 400 for missing date parameter", async () => {
    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("date query parameter is required (YYYY-MM-DD)");
  });

  it("returns 400 for invalid date format", async () => {
    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=invalid-date",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Invalid date format. Use YYYY-MM-DD");
  });

  it("returns 401 when Google Health token is invalid", async () => {
    mockGetCachedHealthActivitySummary.mockRejectedValue(new Error("HEALTH_TOKEN_INVALID"));

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.code).toBe("HEALTH_TOKEN_INVALID");
  });

  it("returns 403 when Google Health scope is missing", async () => {
    mockGetCachedHealthActivitySummary.mockRejectedValue(new Error("HEALTH_SCOPE_MISSING"));

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error.code).toBe("HEALTH_SCOPE_MISSING");
  });

  it("returns 503 when Google Health rate limit is low", async () => {
    mockGetCachedHealthActivitySummary.mockRejectedValue(new Error("HEALTH_RATE_LIMIT_LOW"));

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error.code).toBe("HEALTH_RATE_LIMIT_LOW");
  });

  it("returns 502 when Google Health API returns an error", async () => {
    mockGetCachedHealthActivitySummary.mockRejectedValue(new Error("HEALTH_API_ERROR"));

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error.code).toBe("HEALTH_API_ERROR");
  });

  it("returns 500 HEALTH_TOKEN_SAVE_FAILED when token upsert fails after refresh", async () => {
    mockGetCachedHealthActivitySummary.mockRejectedValue(new Error("HEALTH_TOKEN_SAVE_FAILED"));

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe("HEALTH_TOKEN_SAVE_FAILED");
  });

  it("returns 429 when API rate limit is exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns 500 on unexpected errors", async () => {
    mockGetCachedHealthActivitySummary.mockRejectedValue(new Error("DB connection failed"));

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});
