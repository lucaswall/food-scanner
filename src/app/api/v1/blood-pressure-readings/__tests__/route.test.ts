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

const mockUpsertBloodPressureReadings = vi.fn();
const mockGetBloodPressureReadings = vi.fn();
vi.mock("@/lib/health-readings", () => ({
  upsertBloodPressureReadings: (...args: unknown[]) => mockUpsertBloodPressureReadings(...args),
  getBloodPressureReadings: (...args: unknown[]) => mockGetBloodPressureReadings(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { POST, GET } = await import("@/app/api/v1/blood-pressure-readings/route");

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
  systolic: 120,
  diastolic: 80,
};

describe("POST /api/v1/blood-pressure-readings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
  });

  it("returns 200 with upserted count for valid readings array", async () => {
    mockUpsertBloodPressureReadings.mockResolvedValue(2);
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
      { readings: [VALID_READING, { measuredAt: "2026-03-28T12:00:00.000Z", systolic: 118, diastolic: 78 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.upserted).toBe(2);
    expect(mockUpsertBloodPressureReadings).toHaveBeenCalledWith("user-123", expect.any(Array));
  });

  it("returns 200 with upserted: 0 for empty readings array", async () => {
    mockUpsertBloodPressureReadings.mockResolvedValue(0);
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
      { readings: [] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.upserted).toBe(0);
    expect(mockUpsertBloodPressureReadings).toHaveBeenCalledWith("user-123", []);
  });

  it("returns 401 for missing/invalid auth", async () => {
    const errorRes = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorRes);
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
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
      "http://localhost:3000/api/v1/blood-pressure-readings",
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
      "http://localhost:3000/api/v1/blood-pressure-readings",
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
      "http://localhost:3000/api/v1/blood-pressure-readings",
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
      "http://localhost:3000/api/v1/blood-pressure-readings",
      { readings: [{ systolic: 120, diastolic: 80 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/measuredAt/i);
  });

  it("returns 400 for reading missing systolic", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
      { readings: [{ measuredAt: "2026-03-28T08:00:00.000Z", diastolic: 80 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/systolic/i);
  });

  it("returns 400 for reading missing diastolic", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
      { readings: [{ measuredAt: "2026-03-28T08:00:00.000Z", systolic: 120 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/diastolic/i);
  });

  it("returns 400 for invalid measuredAt (not ISO 8601)", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
      { readings: [{ measuredAt: "not-a-date", systolic: 120, diastolic: 80 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/measuredAt/i);
  });

  it("returns 400 for invalid bodyPosition enum value", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
      { readings: [{ ...VALID_READING, bodyPosition: "invalid_value" }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/bodyPosition/i);
  });

  it("returns 400 for invalid measurementLocation enum value", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
      { readings: [{ ...VALID_READING, measurementLocation: "invalid_value" }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/measurementLocation/i);
  });

  it("returns 400 for invalid zoneOffset format", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
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
    mockUpsertBloodPressureReadings.mockRejectedValue(new Error("DB error"));
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
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
    mockUpsertBloodPressureReadings.mockResolvedValue(1);
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
      {
        readings: [{
          measuredAt: "2026-03-28T08:00:00.000Z",
          systolic: 120,
          diastolic: 80,
          bodyPosition: "sitting_down",
          measurementLocation: "left_upper_arm",
        }],
      },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    expect(response.status).toBe(200);
  });
});

describe("GET /api/v1/blood-pressure-readings", () => {
  const MOCK_READINGS = [
    {
      id: 1,
      measuredAt: "2026-03-28T08:00:00.000Z",
      zoneOffset: "+00:00",
      systolic: 120,
      diastolic: 80,
      bodyPosition: "sitting_down",
      measurementLocation: "left_upper_arm",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
  });

  it("returns readings for single date query", async () => {
    mockGetBloodPressureReadings.mockResolvedValue(MOCK_READINGS);
    const request = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(1);
    expect(mockGetBloodPressureReadings).toHaveBeenCalledWith("user-123", "2026-03-28", "2026-03-28");
  });

  it("returns readings for date range query", async () => {
    mockGetBloodPressureReadings.mockResolvedValue(MOCK_READINGS);
    const request = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings?from=2026-03-01&to=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockGetBloodPressureReadings).toHaveBeenCalledWith("user-123", "2026-03-01", "2026-03-28");
  });

  it("returns 200 with empty array when no readings", async () => {
    mockGetBloodPressureReadings.mockResolvedValue([]);
    const request = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toEqual([]);
  });

  it("returns 400 when neither date nor from/to provided", async () => {
    const request = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
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
      "http://localhost:3000/api/v1/blood-pressure-readings?from=2026-03-01",
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
      "http://localhost:3000/api/v1/blood-pressure-readings?to=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/from/i);
  });

  it("returns 400 for invalid date format", async () => {
    const request = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings?date=not-a-date",
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
      "http://localhost:3000/api/v1/blood-pressure-readings?from=2026-03-28&to=2026-03-01",
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
      "http://localhost:3000/api/v1/blood-pressure-readings?date=2026-03-28",
      { Authorization: "Bearer invalid-key" }
    );
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });
    const request = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns 500 when lib function throws", async () => {
    mockGetBloodPressureReadings.mockRejectedValue(new Error("DB error"));
    const request = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns ETag header on success", async () => {
    mockGetBloodPressureReadings.mockResolvedValue(MOCK_READINGS);
    const request = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    mockGetBloodPressureReadings.mockResolvedValue(MOCK_READINGS);
    const firstRequest = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const firstResponse = await GET(firstRequest);
    const etag = firstResponse.headers.get("ETag")!;

    const secondRequest = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key", "If-None-Match": etag }
    );
    const secondResponse = await GET(secondRequest);

    expect(secondResponse.status).toBe(304);
    expect(await secondResponse.text()).toBe("");
    expect(secondResponse.headers.get("ETag")).toBe(etag);
  });
});
