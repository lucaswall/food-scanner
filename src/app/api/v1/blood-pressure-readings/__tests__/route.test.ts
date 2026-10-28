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

  it("returns 400 when readings array exceeds max batch size", async () => {
    const readings = Array.from({ length: 1001 }, (_, i) => ({
      measuredAt: `2026-03-28T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
      systolic: 120,
      diastolic: 80,
    }));
    const request = createPostRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings",
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
      "http://localhost:3000/api/v1/blood-pressure-readings",
      { readings: [{ measuredAt: "March 28, 2026 08:00:00", systolic: 120, diastolic: 80 }] },
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
      heartRate: 72,
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

  it("includes heartRate in each reading, null when absent", async () => {
    mockGetBloodPressureReadings.mockResolvedValue([
      ...MOCK_READINGS,
      {
        id: 2,
        measuredAt: "2026-03-28T12:00:00.000Z",
        zoneOffset: null,
        systolic: 118,
        diastolic: 78,
        heartRate: null,
        bodyPosition: null,
        measurementLocation: null,
      },
    ]);
    const request = createGetRequest(
      "http://localhost:3000/api/v1/blood-pressure-readings?date=2026-03-28",
      { Authorization: "Bearer valid-key" }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toHaveLength(2);
    expect(data.data[0]).toEqual(expect.objectContaining({ id: 1, systolic: 120, diastolic: 80, heartRate: 72 }));
    expect(data.data[1]).toHaveProperty("heartRate", null);
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

describe("input hardening (blood pressure)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetBloodPressureReadings.mockResolvedValue([]);
    mockUpsertBloodPressureReadings.mockResolvedValue(1);
  });

  async function post(readings: unknown[]) {
    return POST(createPostRequest("http://localhost:3000/api/v1/blood-pressure-readings", { readings }, { Authorization: "Bearer k" }));
  }

  it.each([
    "2026-13-01T08:00:00Z",
    "2026-02-30T08:00:00Z",
    "2026-01-01T25:00:00Z",
    "2026-01-01T08:61:00Z",
    "2026-01-01T08:00:00+25:00",
    "1969-12-31T23:00:00Z",
    "2999-01-01T00:00:00Z",
  ])("rejects measuredAt %s with 400 instead of 500", async (measuredAt) => {
    const response = await post([{ ...VALID_READING, measuredAt }]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
    expect(mockUpsertBloodPressureReadings).not.toHaveBeenCalled();
  });

  it.each([2147483648, 301, 0, 120.5])("rejects systolic %s (out of int4/sane range or non-integer)", async (systolic) => {
    const response = await post([{ ...VALID_READING, systolic }]);
    expect(response.status).toBe(400);
  });

  it.each([2147483648, 301, 0])("rejects diastolic %s", async (diastolic) => {
    const response = await post([{ ...VALID_READING, diastolic }]);
    expect(response.status).toBe(400);
  });

  it.each([72.5, 0, -1, 301, 2147483648, "72", true, {}])(
    "rejects heartRate %s with VALIDATION_ERROR",
    async (heartRate) => {
      const response = await post([{ ...VALID_READING, heartRate }]);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe("VALIDATION_ERROR");
      expect(data.error.message).toBe("Reading at index 0: heartRate must be a positive integer up to 300");
      expect(mockUpsertBloodPressureReadings).not.toHaveBeenCalled();
    },
  );

  it.each([1, 72, 300])("accepts heartRate %s and passes it to the upsert", async (heartRate) => {
    const response = await post([{ ...VALID_READING, heartRate }]);
    expect(response.status).toBe(200);
    expect(mockUpsertBloodPressureReadings).toHaveBeenCalledWith("user-123", [
      expect.objectContaining({ systolic: 120, diastolic: 80, heartRate }),
    ]);
  });

  it("treats a missing heartRate as null (unknown)", async () => {
    const response = await post([VALID_READING]);
    expect(response.status).toBe(200);
    expect(mockUpsertBloodPressureReadings).toHaveBeenCalledWith("user-123", [
      expect.objectContaining({ heartRate: null }),
    ]);
  });

  it("treats an explicit null heartRate as null (unknown)", async () => {
    const response = await post([{ ...VALID_READING, heartRate: null }]);
    expect(response.status).toBe(200);
    expect(mockUpsertBloodPressureReadings).toHaveBeenCalledWith("user-123", [
      expect.objectContaining({ heartRate: null }),
    ]);
  });

  it("reports the index of the reading with an invalid heartRate", async () => {
    const response = await post([{ ...VALID_READING, heartRate: 70 }, { ...VALID_READING, measuredAt: "2026-03-28T09:00:00.000Z", heartRate: 0 }]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/index 1: heartRate/);
  });

  it("GET rejects a range longer than 31 days with 400", async () => {
    const response = await GET(createGetRequest("http://localhost:3000/api/v1/blood-pressure-readings?from=2026-01-01&to=2026-03-01", { Authorization: "Bearer k" }));
    expect(response.status).toBe(400);
    expect(mockGetBloodPressureReadings).not.toHaveBeenCalled();
  });

  it("GET accepts a 31-day range", async () => {
    const response = await GET(createGetRequest("http://localhost:3000/api/v1/blood-pressure-readings?from=2026-03-01&to=2026-03-31", { Authorization: "Bearer k" }));
    expect(response.status).toBe(200);
  });

  it("GET maps the row-limit error to 400", async () => {
    mockGetBloodPressureReadings.mockRejectedValue(new Error("READINGS_LIMIT_EXCEEDED"));
    const response = await GET(createGetRequest("http://localhost:3000/api/v1/blood-pressure-readings?date=2026-03-01", { Authorization: "Bearer k" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
