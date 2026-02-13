import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ActivitySummary } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockValidateApiRequest = vi.fn();
vi.mock("@/lib/api-auth", () => ({
  validateApiRequest: (...args: unknown[]) => mockValidateApiRequest(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockEnsureFreshToken = vi.fn();
const mockGetActivitySummary = vi.fn();
vi.mock("@/lib/fitbit", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  getActivitySummary: (...args: unknown[]) => mockGetActivitySummary(...args),
}));

const { GET } = await import("@/app/api/v1/activity-summary/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/v1/activity-summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns activity summary for valid API key and date", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockEnsureFreshToken.mockResolvedValue("fitbit-access-token");

    const mockActivity: ActivitySummary = {
      caloriesOut: 2500,
    };

    mockGetActivitySummary.mockResolvedValue(mockActivity);

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
    expect(mockEnsureFreshToken).toHaveBeenCalledWith("user-123");
    expect(mockGetActivitySummary).toHaveBeenCalledWith("fitbit-access-token", "2026-02-11");
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
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });

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
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });

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

  it("returns 404 when Fitbit credentials are missing", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_CREDENTIALS_MISSING"));

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error.code).toBe("FITBIT_CREDENTIALS_MISSING");
  });

  it("returns 401 when Fitbit token is invalid", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockEnsureFreshToken.mockRejectedValue(new Error("FITBIT_TOKEN_INVALID"));

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error.code).toBe("FITBIT_TOKEN_INVALID");
  });

  it("returns 403 when Fitbit scope is missing", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockEnsureFreshToken.mockResolvedValue("fitbit-access-token");
    mockGetActivitySummary.mockRejectedValue(new Error("FITBIT_SCOPE_MISSING"));

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error.code).toBe("FITBIT_SCOPE_MISSING");
  });

  it("returns 502 when Fitbit API returns an error", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockEnsureFreshToken.mockResolvedValue("fitbit-access-token");
    mockGetActivitySummary.mockRejectedValue(new Error("FITBIT_API_ERROR"));

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(502);
    expect(data.error.code).toBe("FITBIT_API_ERROR");
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockEnsureFreshToken.mockResolvedValue("fitbit-access-token");
    mockGetActivitySummary.mockResolvedValue({
      caloriesOut: 2500,
    });

    const request = createRequest(
      "http://localhost:3000/api/v1/activity-summary?date=2026-02-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});
