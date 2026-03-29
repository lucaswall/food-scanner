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

const mockUpsertGlucoseReadings = vi.fn();
const mockGetGlucoseReadings = vi.fn();
vi.mock("@/lib/health-readings", () => ({
  upsertGlucoseReadings: (...args: unknown[]) => mockUpsertGlucoseReadings(...args),
  getGlucoseReadings: (...args: unknown[]) => mockGetGlucoseReadings(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { POST, GET } = await import("@/app/api/v1/glucose-readings/route");

function createPostRequest(url: string, body: unknown, extraHeaders?: HeadersInit): Request {
  return new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function createGetRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

const VALID_READING = {
  measuredAt: "2026-03-28T08:00:00.000Z",
  valueMgDl: 95,
};

describe("POST /api/v1/glucose-readings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
  });

  it("returns 200 with upserted count for valid readings array", async () => {
    mockUpsertGlucoseReadings.mockResolvedValue(2);
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [VALID_READING, { measuredAt: "2026-03-28T12:00:00.000Z", valueMgDl: 110 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.upserted).toBe(2);
    expect(mockUpsertGlucoseReadings).toHaveBeenCalledWith("user-123", expect.any(Array));
  });

  it("returns 200 with upserted: 0 for empty readings array", async () => {
    mockUpsertGlucoseReadings.mockResolvedValue(0);
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.upserted).toBe(0);
    expect(mockUpsertGlucoseReadings).toHaveBeenCalledWith("user-123", []);
  });

  it("returns 401 for missing/invalid auth", async () => {
    const errorRes = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorRes);
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [VALID_READING] },
      { Authorization: "Bearer invalid-key" }
    );
    const response = await POST(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [VALID_READING] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.error.message).toMatch(/too many requests/i);
  });

  it("returns 400 for missing readings field in body", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      {},
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/readings/i);
  });

  it("returns 400 when readings is not an array", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: "not-an-array" },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for reading missing measuredAt", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [{ valueMgDl: 95 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/measuredAt/i);
  });

  it("returns 400 for reading missing valueMgDl", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [{ measuredAt: "2026-03-28T08:00:00.000Z" }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/valueMgDl/i);
  });

  it("returns 400 when readings array exceeds max batch size", async () => {
    const readings = Array.from({ length: 1001 }, (_, i) => ({
      measuredAt: `2026-03-28T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
      valueMgDl: 95,
    }));
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/1000/);
  });

  it("returns 400 for non-ISO-8601 but parseable date string", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [{ measuredAt: "March 28, 2026 08:00:00", valueMgDl: 95 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/measuredAt/i);
  });

  it("returns 400 for invalid measuredAt (not ISO 8601)", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [{ measuredAt: "not-a-date", valueMgDl: 95 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/measuredAt/i);
  });

  it("returns 400 for invalid relationToMeal enum value", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [{ ...VALID_READING, relationToMeal: "invalid_value" }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/relationToMeal/i);
  });

  it("returns 400 for invalid mealType enum value", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [{ ...VALID_READING, mealType: "invalid_value" }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/mealType/i);
  });

  it("returns 400 for invalid specimenSource enum value", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [{ ...VALID_READING, specimenSource: "invalid_value" }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/specimenSource/i);
  });

  it("returns 400 for invalid zoneOffset format", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [{ ...VALID_READING, zoneOffset: "America/New_York" }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/zoneOffset/i);
  });

  it("returns 500 when lib function throws", async () => {
    mockUpsertGlucoseReadings.mockRejectedValue(new Error("DB error"));
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { readings: [VALID_READING] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  it("accepts valid optional enum values", async () => {
    mockUpsertGlucoseReadings.mockResolvedValue(1);
    const request = createPostRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      {
        readings: [{
          measuredAt: "2026-03-28T08:00:00.000Z",
          valueMgDl: 95,
          relationToMeal: "before_meal",
          mealType: "breakfast",
          specimenSource: "capillary_blood",
        }],
      },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});

describe("GET /api/v1/glucose-readings", () => {
  const MOCK_READINGS = [
    {
      id: 1,
      measuredAt: "2026-03-28T08:00:00.000Z",
      zoneOffset: "+00:00",
      valueMgDl: 95,
      relationToMeal: "fasting",
      mealType: null,
      specimenSource: "capillary_blood",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
  });

  it("returns readings for single date query", async () => {
    mockGetGlucoseReadings.mockResolvedValue(MOCK_READINGS);
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(1);
    expect(mockGetGlucoseReadings).toHaveBeenCalledWith("user-123", "2026-03-28", "2026-03-28");
  });

  it("returns readings for date range query", async () => {
    mockGetGlucoseReadings.mockResolvedValue(MOCK_READINGS);
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?from=2026-03-01&to=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockGetGlucoseReadings).toHaveBeenCalledWith("user-123", "2026-03-01", "2026-03-28");
  });

  it("returns 200 with empty array when no readings", async () => {
    mockGetGlucoseReadings.mockResolvedValue([]);
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toEqual([]);
  });

  it("returns 400 when neither date nor from/to provided", async () => {
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/date.*from.*to|missing/i);
  });

  it("returns 400 for from without to", async () => {
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?from=2026-03-01",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/to/i);
  });

  it("returns 400 for to without from", async () => {
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?to=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/from/i);
  });

  it("returns 400 for invalid date format in date param", async () => {
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?date=not-a-date",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/invalid date/i);
  });

  it("returns 400 for invalid date format in from param", async () => {
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?from=not-a-date&to=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/invalid date/i);
  });

  it("returns 400 when from is after to", async () => {
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?from=2026-03-28&to=2026-03-01",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/from.*after.*to|range/i);
  });

  it("returns 401 for invalid auth", async () => {
    const errorRes = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorRes);
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?date=2026-03-28",
      { Authorization: "Bearer invalid-key" }
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns 500 when lib function throws", async () => {
    mockGetGlucoseReadings.mockRejectedValue(new Error("DB error"));
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns ETag header on success", async () => {
    mockGetGlucoseReadings.mockResolvedValue(MOCK_READINGS);
    const request = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    mockGetGlucoseReadings.mockResolvedValue(MOCK_READINGS);
    const firstRequest = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const firstResponse = await GET(firstRequest);
    const etag = firstResponse.headers.get("ETag")!;

    const secondRequest = createGetRequest(
      "http://localhost:3000/api/v1/glucose-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key", "If-None-Match": etag }
    );
    const secondResponse = await GET(secondRequest);

    expect(secondResponse.status).toBe(304);
    expect(await secondResponse.text()).toBe("");
    expect(secondResponse.headers.get("ETag")).toBe(etag);
  });
});
