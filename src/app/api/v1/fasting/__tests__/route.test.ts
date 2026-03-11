import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastingWindow } from "@/types";

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

const mockGetFastingWindow = vi.fn();
const mockGetFastingWindows = vi.fn();
vi.mock("@/lib/fasting", () => ({
  getFastingWindow: (...args: unknown[]) => mockGetFastingWindow(...args),
  getFastingWindows: (...args: unknown[]) => mockGetFastingWindows(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const mockIsToday = vi.fn();
const mockAddDays = vi.fn();
const mockIsValidDateFormat = vi.fn();
vi.mock("@/lib/date-utils", () => ({
  isToday: (date: string) => mockIsToday(date),
  addDays: (date: string, days: number) => mockAddDays(date, days),
  isValidDateFormat: (date: string) => mockIsValidDateFormat(date),
}));

const { GET } = await import("@/app/api/v1/fasting/route");

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/v1/fasting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: valid date formats
    mockIsValidDateFormat.mockReturnValue(true);
    // Default: isToday returns false
    mockIsToday.mockReturnValue(false);
    // Default: addDays returns predictable date
    mockAddDays.mockImplementation((date: string, days: number) => {
      if (days === -1) return "2026-03-10";
      return "2026-03-12";
    });
  });

  // ── Auth / Rate limit ──────────────────────────────────────────────────────

  it("returns 401 when API key is invalid", async () => {
    const errorResponse = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorResponse);

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11",
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
      "http://localhost:3000/api/v1/fasting?date=2026-03-11",
      { Authorization: "Bearer test-api-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.error.message).toMatch(/too many requests/i);
  });

  it("uses rate limit key v1:fasting:hashed-<key> with 60 req/min", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFastingWindow.mockResolvedValue(null);

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11",
      { Authorization: "Bearer test-api-key-123" }
    );
    await GET(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "v1:fasting:hashed-test-api",
      60,
      60000
    );
  });

  // ── Single date mode ───────────────────────────────────────────────────────

  it("returns 400 for missing date parameter (single date mode)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Missing date parameter");
  });

  it("returns 400 for invalid date format", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockIsValidDateFormat.mockReturnValue(false);

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-13-45",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Invalid date format. Use YYYY-MM-DD");
  });

  it("returns { window, live: null } for successful single date request", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockIsToday.mockReturnValue(false);

    const mockWindow: FastingWindow = {
      date: "2026-03-11",
      lastMealTime: "21:00:00",
      firstMealTime: "09:00:00",
      durationMinutes: 720,
    };
    mockGetFastingWindow.mockResolvedValue(mockWindow);

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({ window: mockWindow, live: null });
    expect(mockGetFastingWindow).toHaveBeenCalledWith("user-123", "2026-03-11", expect.anything());
  });

  it("returns live object when clientDate matches date and firstMealTime is null", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockAddDays.mockReturnValue("2026-03-10");

    const mockWindow: FastingWindow = {
      date: "2026-03-11",
      lastMealTime: "20:00:00",
      firstMealTime: null,
      durationMinutes: null,
    };
    mockGetFastingWindow.mockResolvedValue(mockWindow);

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11&clientDate=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.live).toEqual({
      lastMealTime: "20:00:00",
      startDate: "2026-03-10",
    });
    expect(mockAddDays).toHaveBeenCalledWith("2026-03-11", -1);
  });

  it("returns live: null when firstMealTime is not null (fast completed)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const mockWindow: FastingWindow = {
      date: "2026-03-11",
      lastMealTime: "20:00:00",
      firstMealTime: "09:00:00",
      durationMinutes: 780,
    };
    mockGetFastingWindow.mockResolvedValue(mockWindow);

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11&clientDate=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.live).toBeNull();
  });

  it("falls back to isToday() when clientDate is not provided for live detection", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockIsToday.mockReturnValue(true);
    mockAddDays.mockReturnValue("2026-03-10");

    const mockWindow: FastingWindow = {
      date: "2026-03-11",
      lastMealTime: "20:00:00",
      firstMealTime: null,
      durationMinutes: null,
    };
    mockGetFastingWindow.mockResolvedValue(mockWindow);

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data.live).toEqual({
      lastMealTime: "20:00:00",
      startDate: "2026-03-10",
    });
    expect(mockIsToday).toHaveBeenCalledWith("2026-03-11");
  });

  it("returns 500 on getFastingWindow error", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFastingWindow.mockRejectedValue(new Error("Database error"));

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  // ── Date range mode ────────────────────────────────────────────────────────

  it("returns { windows } for valid date range", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const mockWindows: FastingWindow[] = [
      { date: "2026-03-10", lastMealTime: "20:00:00", firstMealTime: "09:00:00", durationMinutes: 780 },
      { date: "2026-03-11", lastMealTime: "21:00:00", firstMealTime: "10:00:00", durationMinutes: 720 },
    ];
    mockGetFastingWindows.mockResolvedValue(mockWindows);

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?from=2026-03-10&to=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({ windows: mockWindows });
    expect(mockGetFastingWindows).toHaveBeenCalledWith("user-123", "2026-03-10", "2026-03-11", expect.anything());
  });

  it("returns 400 when only `to` is provided (missing `from`)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?to=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toContain("Both from and to");
  });

  it("returns 400 when only `from` is provided (missing `to`)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?from=2026-03-10",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toContain("Both from and to");
  });

  it("returns 400 when `from` date format is invalid", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockIsValidDateFormat.mockImplementation((date: string) => date !== "invalid");

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?from=invalid&to=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Invalid from date format. Use YYYY-MM-DD");
  });

  it("returns 400 when `to` date format is invalid", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockIsValidDateFormat.mockImplementation((date: string) => date !== "invalid");

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?from=2026-03-10&to=invalid",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("Invalid to date format. Use YYYY-MM-DD");
  });

  it("returns 400 when `from` is after `to`", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?from=2026-03-15&to=2026-03-10",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toBe("from date must be before or equal to to date");
  });

  it("returns 500 on getFastingWindows error", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFastingWindows.mockRejectedValue(new Error("Database error"));

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?from=2026-03-10&to=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  // ── Shared headers ─────────────────────────────────────────────────────────

  it("sets Cache-Control: private, no-cache on success", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFastingWindow.mockResolvedValue(null);

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns ETag header on success response", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFastingWindow.mockResolvedValue(null);

    const request = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetFastingWindow.mockResolvedValue({
      date: "2026-03-11",
      lastMealTime: "20:00:00",
      firstMealTime: "09:00:00",
      durationMinutes: 780,
    });

    const firstRequest = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11",
      { Authorization: "Bearer valid-key" }
    );
    const firstResponse = await GET(firstRequest);
    const etag = firstResponse.headers.get("ETag")!;

    mockGetFastingWindow.mockResolvedValue({
      date: "2026-03-11",
      lastMealTime: "20:00:00",
      firstMealTime: "09:00:00",
      durationMinutes: 780,
    });

    const secondRequest = createRequest(
      "http://localhost:3000/api/v1/fasting?date=2026-03-11",
      { Authorization: "Bearer valid-key", "If-None-Match": etag }
    );
    const secondResponse = await GET(secondRequest);

    expect(secondResponse.status).toBe(304);
    expect(await secondResponse.text()).toBe("");
    expect(secondResponse.headers.get("ETag")).toBe(etag);
    expect(secondResponse.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});
