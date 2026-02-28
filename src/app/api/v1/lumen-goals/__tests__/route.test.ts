import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LumenGoals } from "@/types";

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

const mockGetLumenGoalsByDate = vi.fn();
vi.mock("@/lib/lumen", () => ({
  getLumenGoalsByDate: (...args: unknown[]) => mockGetLumenGoalsByDate(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { GET } = await import("@/app/api/v1/lumen-goals/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/v1/lumen-goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns lumen goals for valid API key and date", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const mockGoals: LumenGoals = {
      date: "2026-02-11",
      dayType: "low-carb",
      proteinGoal: 150,
      carbsGoal: 50,
      fatGoal: 100,
    };

    mockGetLumenGoalsByDate.mockResolvedValue(mockGoals);

    const request = createRequest(
      "http://localhost:3000/api/v1/lumen-goals?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.goals).toEqual(mockGoals);
    expect(mockValidateApiRequest).toHaveBeenCalledWith(request);
    expect(mockGetLumenGoalsByDate).toHaveBeenCalledWith("user-123", "2026-02-11");
  });

  it("returns null goals when no lumen data exists for date", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetLumenGoalsByDate.mockResolvedValue(null);

    const request = createRequest(
      "http://localhost:3000/api/v1/lumen-goals?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.goals).toBeNull();
  });

  it("returns 401 for invalid API key", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest(
      "http://localhost:3000/api/v1/lumen-goals?date=2026-02-11",
      { Authorization: "Bearer invalid-key" }
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns 400 for missing date parameter", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/lumen-goals",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("date query parameter is required (YYYY-MM-DD)");
  });

  it("returns 400 for invalid date format", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/lumen-goals?date=invalid-date",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Invalid date format. Use YYYY-MM-DD");
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetLumenGoalsByDate.mockResolvedValue({
      date: "2026-02-11",
      dayType: "low-carb",
      proteinGoal: 150,
      carbsGoal: 50,
      fatGoal: 100,
    });

    const request = createRequest(
      "http://localhost:3000/api/v1/lumen-goals?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const request = createRequest(
      "http://localhost:3000/api/v1/lumen-goals?date=2026-02-11",
      { Authorization: "Bearer test-api-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.error.message).toMatch(/too many requests/i);
  });

  it("uses API key as rate limit key with 60 req/min for DB-only route", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetLumenGoalsByDate.mockResolvedValue(null);

    const request = createRequest(
      "http://localhost:3000/api/v1/lumen-goals?date=2026-02-11",
      { Authorization: "Bearer test-api-key-789" }
    );
    await GET(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "v1:lumen-goals:hashed-test-api",
      60,
      60000
    );
  });

  it("returns ETag header on success response", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetLumenGoalsByDate.mockResolvedValue(null);

    const request = createRequest(
      "http://localhost:3000/api/v1/lumen-goals?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetLumenGoalsByDate.mockResolvedValue(null);

    const firstRequest = createRequest(
      "http://localhost:3000/api/v1/lumen-goals?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const firstResponse = await GET(firstRequest);
    const etag = firstResponse.headers.get("ETag")!;

    const secondRequest = createRequest(
      "http://localhost:3000/api/v1/lumen-goals?date=2026-02-11",
      { Authorization: "Bearer valid-key", "If-None-Match": etag }
    );
    const secondResponse = await GET(secondRequest);

    expect(secondResponse.status).toBe(304);
    expect(await secondResponse.text()).toBe("");
    expect(secondResponse.headers.get("ETag")).toBe(etag);
    expect(secondResponse.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});
