import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockValidateApiRequest = vi.fn();
vi.mock("@/lib/api-auth", () => ({
  validateApiRequest: (...args: unknown[]) => mockValidateApiRequest(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetMonthlyUsage = vi.fn();
vi.mock("@/lib/claude-usage", () => ({
  getMonthlyUsage: (...args: unknown[]) => mockGetMonthlyUsage(...args),
}));

const { GET } = await import("@/app/api/claude-usage/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/claude-usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 if no session", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No session" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest("http://localhost:3000/api/claude-usage");
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns monthly usage data for default 3 months", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });

    const mockMonths = [
        {
          month: "2026-02",
          totalRequests: 150,
          totalInputTokens: 50000,
          totalOutputTokens: 25000,
          totalCostUsd: "12.50",
        },
        {
          month: "2026-01",
          totalRequests: 120,
          totalInputTokens: 40000,
          totalOutputTokens: 20000,
          totalCostUsd: "10.00",
        },
        {
          month: "2025-12",
          totalRequests: 100,
          totalInputTokens: 30000,
          totalOutputTokens: 15000,
          totalCostUsd: "7.50",
        },
    ];

    mockGetMonthlyUsage.mockResolvedValue(mockMonths);

    const request = createRequest("http://localhost:3000/api/claude-usage");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.months).toEqual(mockMonths);
    expect(mockValidateApiRequest).toHaveBeenCalledWith(request);
    expect(mockGetMonthlyUsage).toHaveBeenCalledWith("user-123", 3);
  });

  it("supports ?months=N query param", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockGetMonthlyUsage.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/claude-usage?months=6");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetMonthlyUsage).toHaveBeenCalledWith("user-123", 6);
  });

  it("clamps months to max 12", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockGetMonthlyUsage.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/claude-usage?months=24");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetMonthlyUsage).toHaveBeenCalledWith("user-123", 12);
  });

  it("clamps months to min 1 for zero", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockGetMonthlyUsage.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/claude-usage?months=0");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetMonthlyUsage).toHaveBeenCalledWith("user-123", 1);
  });

  it("clamps months to min 1 for negative", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockGetMonthlyUsage.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/claude-usage?months=-5");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetMonthlyUsage).toHaveBeenCalledWith("user-123", 1);
  });

  it("uses default 3 when months param is not a number", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockGetMonthlyUsage.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/claude-usage?months=abc");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockGetMonthlyUsage).toHaveBeenCalledWith("user-123", 3);
  });

  it("returns ApiSuccessResponse format with timestamp", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockGetMonthlyUsage.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/claude-usage");
    const response = await GET(request);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();
    expect(data.timestamp).toBeDefined();
    expect(typeof data.timestamp).toBe("number");
  });

  it("sets Cache-Control header to private, no-cache", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockGetMonthlyUsage.mockResolvedValue([]);

    const request = createRequest("http://localhost:3000/api/claude-usage");
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("handles errors from getMonthlyUsage", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockGetMonthlyUsage.mockRejectedValue(new Error("Database connection failed"));

    const request = createRequest("http://localhost:3000/api/claude-usage");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});
