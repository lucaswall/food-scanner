import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NutritionGoals } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockValidateApiRequest = vi.fn();
vi.mock("@/lib/api-auth", () => ({
  validateApiRequest: (...args: unknown[]) => mockValidateApiRequest(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockEnsureFreshToken = vi.fn();
const mockGetFoodGoals = vi.fn();
vi.mock("@/lib/fitbit", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  getFoodGoals: (...args: unknown[]) => mockGetFoodGoals(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { GET } = await import("@/app/api/v1/nutrition-goals/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/v1/nutrition-goals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns nutrition goals for valid API key", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    mockEnsureFreshToken.mockResolvedValue("fitbit-access-token");

    const mockGoals: NutritionGoals = {
      calories: 2000,
    };

    mockGetFoodGoals.mockResolvedValue(mockGoals);

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-goals",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(mockGoals);
    expect(mockValidateApiRequest).toHaveBeenCalledWith(request);
    expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-123");
    expect(mockGetFoodGoals).toHaveBeenCalledWith("fitbit-access-token");
  });

  it("returns 401 for invalid API key", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-goals",
      { Authorization: "Bearer invalid-key" }
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns 424 when Fitbit credentials are missing", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_CREDENTIALS_MISSING"));

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-goals",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(424);
    expect(data.error.code).toBe("FITBIT_CREDENTIALS_MISSING");
  });

  it("returns 401 when Fitbit token is invalid", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_TOKEN_INVALID"));

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-goals",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.code).toBe("FITBIT_TOKEN_INVALID");
  });

  it("returns 403 when Fitbit scope is missing", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    mockEnsureFreshToken.mockResolvedValue("fitbit-access-token");
    mockGetFoodGoals.mockRejectedValue(new Error("FITBIT_SCOPE_MISSING"));

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-goals",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error.code).toBe("FITBIT_SCOPE_MISSING");
  });

  it("returns 502 when Fitbit API returns an error", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    mockEnsureFreshToken.mockResolvedValue("fitbit-access-token");
    mockGetFoodGoals.mockRejectedValue(new Error("FITBIT_API_ERROR"));

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-goals",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error.code).toBe("FITBIT_API_ERROR");
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    mockEnsureFreshToken.mockResolvedValue("fitbit-access-token");
    mockGetFoodGoals.mockResolvedValue({ calories: 2000 });

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-goals",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 429 when rate limit is exceeded", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-goals",
      { Authorization: "Bearer test-api-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.error.message).toMatch(/too many requests/i);
  });

  it("uses API key as rate limit key with 30 req/min for Fitbit API route", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    mockEnsureFreshToken.mockResolvedValue("fitbit-access-token");
    mockGetFoodGoals.mockResolvedValue({ calories: 2000 });

    const request = createRequest(
      "http://localhost:3000/api/v1/nutrition-goals",
      { Authorization: "Bearer test-api-key-abc" }
    );
    await GET(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "v1:nutrition-goals:test-api-key-abc",
      30,
      60000
    );
  });
});
