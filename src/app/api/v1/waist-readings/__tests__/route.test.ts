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

const mockUpsertWaistReadings = vi.fn();
const mockGetWaistReadings = vi.fn();
vi.mock("@/lib/health-readings", () => ({
  upsertWaistReadings: (...args: unknown[]) => mockUpsertWaistReadings(...args),
  getWaistReadings: (...args: unknown[]) => mockGetWaistReadings(...args),
}));

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

const { POST, GET } = await import("@/app/api/v1/waist-readings/route");

const URL_BASE = "http://localhost:3000/api/v1/waist-readings";

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
  valueCm: 104.5,
};

describe("POST /api/v1/waist-readings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
  });

  it("returns 200 with upserted count for valid readings array", async () => {
    mockUpsertWaistReadings.mockResolvedValue(2);
    const request = createPostRequest(
      URL_BASE,
      { readings: [VALID_READING, { measuredAt: "2026-03-28T12:00:00.000Z", valueCm: 103.2, zoneOffset: "-03:00" }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual({ upserted: 2 });
    expect(mockUpsertWaistReadings).toHaveBeenCalledWith("user-123", [
      { measuredAt: "2026-03-28T08:00:00.000Z", valueCm: 104.5, zoneOffset: null },
      { measuredAt: "2026-03-28T12:00:00.000Z", valueCm: 103.2, zoneOffset: "-03:00" },
    ]);
  });

  it("treats an explicit null zoneOffset as absent", async () => {
    mockUpsertWaistReadings.mockResolvedValue(1);
    const request = createPostRequest(
      URL_BASE,
      { readings: [{ ...VALID_READING, zoneOffset: null }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockUpsertWaistReadings).toHaveBeenCalledWith("user-123", [
      { measuredAt: "2026-03-28T08:00:00.000Z", valueCm: 104.5, zoneOffset: null },
    ]);
  });

  it("returns 200 with upserted: 0 for empty readings array", async () => {
    mockUpsertWaistReadings.mockResolvedValue(0);
    const request = createPostRequest(URL_BASE, { readings: [] }, { Authorization: "Bearer valid-key" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.upserted).toBe(0);
    expect(mockUpsertWaistReadings).toHaveBeenCalledWith("user-123", []);
  });

  it("returns 401 for missing/invalid auth", async () => {
    const errorRes = Response.json(
      { success: false, error: { code: "AUTH_MISSING_SESSION", message: "Invalid API key" }, timestamp: Date.now() },
      { status: 401 }
    );
    mockValidateApiRequest.mockResolvedValue(errorRes);
    const request = createPostRequest(URL_BASE, { readings: [VALID_READING] }, { Authorization: "Bearer invalid-key" });
    const response = await POST(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("AUTH_MISSING_SESSION");
    expect(mockUpsertWaistReadings).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });
    const request = createPostRequest(URL_BASE, { readings: [VALID_READING] }, { Authorization: "Bearer valid-key" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.error.message).toMatch(/too many requests/i);
  });

  it("uses a waist-specific rate-limit key", async () => {
    mockUpsertWaistReadings.mockResolvedValue(1);
    await POST(createPostRequest(URL_BASE, { readings: [VALID_READING] }, { Authorization: "Bearer valid-key" }));

    expect(mockCheckRateLimit).toHaveBeenCalledWith(expect.stringMatching(/^v1:waist-readings:/), 60, 60000);
  });

  it("returns 400 for invalid JSON body", async () => {
    const request = new Request(URL_BASE, {
      method: "POST",
      body: "{not json",
      headers: { "Content-Type": "application/json", Authorization: "Bearer valid-key" },
    });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for missing readings field in body", async () => {
    const request = createPostRequest(URL_BASE, {}, { Authorization: "Bearer valid-key" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/readings/i);
  });

  it("returns 400 when readings is not an array", async () => {
    const request = createPostRequest(URL_BASE, { readings: "not-an-array" }, { Authorization: "Bearer valid-key" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when a reading is not an object", async () => {
    const request = createPostRequest(URL_BASE, { readings: [VALID_READING, 42] }, { Authorization: "Bearer valid-key" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/index 1/);
  });

  it("returns 400 for reading missing measuredAt", async () => {
    const request = createPostRequest(URL_BASE, { readings: [{ valueCm: 104.5 }] }, { Authorization: "Bearer valid-key" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/measuredAt/i);
  });

  it("returns 400 for reading missing valueCm", async () => {
    const request = createPostRequest(
      URL_BASE,
      { readings: [{ measuredAt: "2026-03-28T08:00:00.000Z" }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/valueCm/i);
    expect(data.error.message).toMatch(/300/);
  });

  it("returns 400 for invalid ISO 8601 measuredAt", async () => {
    const request = createPostRequest(
      URL_BASE,
      { readings: [{ measuredAt: "not-a-date", valueCm: 104.5 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/measuredAt/i);
  });

  it("returns 400 for non-ISO-8601 but parseable date string", async () => {
    const request = createPostRequest(
      URL_BASE,
      { readings: [{ measuredAt: "March 28, 2026", valueCm: 104.5 }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/measuredAt/i);
  });

  it("returns 400 for invalid zoneOffset format", async () => {
    const request = createPostRequest(
      URL_BASE,
      { readings: [{ ...VALID_READING, zoneOffset: "America/Argentina/Buenos_Aires" }] },
      { Authorization: "Bearer valid-key" }
    );
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/zoneOffset/i);
  });

  it("returns 400 when readings array exceeds max batch size", async () => {
    const readings = Array.from({ length: 1001 }, (_, i) => ({
      measuredAt: `2026-03-28T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
      valueCm: 104.5,
    }));
    const request = createPostRequest(URL_BASE, { readings }, { Authorization: "Bearer valid-key" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/1000/);
    expect(mockUpsertWaistReadings).not.toHaveBeenCalled();
  });

  it("returns 500 when lib function throws", async () => {
    mockUpsertWaistReadings.mockRejectedValue(new Error("DB error"));
    const request = createPostRequest(URL_BASE, { readings: [VALID_READING] }, { Authorization: "Bearer valid-key" });
    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.success).toBe(false);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});

describe("GET /api/v1/waist-readings", () => {
  const MOCK_READINGS = [
    {
      id: 1,
      measuredAt: "2026-03-28T08:00:00.000Z",
      zoneOffset: "-03:00",
      valueCm: 104.5,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
  });

  it("returns readings for single date query", async () => {
    mockGetWaistReadings.mockResolvedValue(MOCK_READINGS);
    const response = await GET(createGetRequest(`${URL_BASE}?date=2026-03-28`, { Authorization: "Bearer valid-key" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toEqual(MOCK_READINGS);
    expect(mockGetWaistReadings).toHaveBeenCalledWith("user-123", "2026-03-28", "2026-03-28");
  });

  it("returns readings for date range query", async () => {
    mockGetWaistReadings.mockResolvedValue(MOCK_READINGS);
    const response = await GET(
      createGetRequest(`${URL_BASE}?from=2026-03-01&to=2026-03-28`, { Authorization: "Bearer valid-key" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockGetWaistReadings).toHaveBeenCalledWith("user-123", "2026-03-01", "2026-03-28");
  });

  it("returns 200 with empty array when no readings", async () => {
    mockGetWaistReadings.mockResolvedValue([]);
    const response = await GET(createGetRequest(`${URL_BASE}?date=2026-03-28`, { Authorization: "Bearer valid-key" }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.data).toEqual([]);
  });

  it("sets Cache-Control: private, no-cache", async () => {
    mockGetWaistReadings.mockResolvedValue(MOCK_READINGS);
    const response = await GET(createGetRequest(`${URL_BASE}?date=2026-03-28`, { Authorization: "Bearer valid-key" }));

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 400 when neither date nor from/to provided", async () => {
    const response = await GET(createGetRequest(URL_BASE, { Authorization: "Bearer valid-key" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/date.*from.*to|missing/i);
  });

  it("returns 400 for from without to", async () => {
    const response = await GET(createGetRequest(`${URL_BASE}?from=2026-03-01`, { Authorization: "Bearer valid-key" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/to/i);
  });

  it("returns 400 for to without from", async () => {
    const response = await GET(createGetRequest(`${URL_BASE}?to=2026-03-28`, { Authorization: "Bearer valid-key" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/from/i);
  });

  it("returns 400 for invalid date format", async () => {
    const response = await GET(createGetRequest(`${URL_BASE}?date=not-a-date`, { Authorization: "Bearer valid-key" }));
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/invalid date/i);
  });

  it("returns 400 for invalid date format in from param", async () => {
    const response = await GET(
      createGetRequest(`${URL_BASE}?from=2026-3-1&to=2026-03-28`, { Authorization: "Bearer valid-key" })
    );
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error.code).toBe("VALIDATION_ERROR");
    expect(data.error.message).toMatch(/from/i);
  });

  it("returns 400 when from is after to", async () => {
    const response = await GET(
      createGetRequest(`${URL_BASE}?from=2026-03-28&to=2026-03-01`, { Authorization: "Bearer valid-key" })
    );
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
    const response = await GET(createGetRequest(`${URL_BASE}?date=2026-03-28`, { Authorization: "Bearer invalid-key" }));

    expect(response.status).toBe(401);
    expect(mockGetWaistReadings).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });
    const response = await GET(createGetRequest(`${URL_BASE}?date=2026-03-28`, { Authorization: "Bearer valid-key" }));
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns 500 when lib function throws", async () => {
    mockGetWaistReadings.mockRejectedValue(new Error("DB error"));
    const response = await GET(createGetRequest(`${URL_BASE}?date=2026-03-28`, { Authorization: "Bearer valid-key" }));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns ETag header on success", async () => {
    mockGetWaistReadings.mockResolvedValue(MOCK_READINGS);
    const response = await GET(createGetRequest(`${URL_BASE}?date=2026-03-28`, { Authorization: "Bearer valid-key" }));

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    mockGetWaistReadings.mockResolvedValue(MOCK_READINGS);
    const firstResponse = await GET(
      createGetRequest(`${URL_BASE}?date=2026-03-28`, { Authorization: "Bearer valid-key" })
    );
    const etag = firstResponse.headers.get("ETag")!;

    const secondResponse = await GET(
      createGetRequest(`${URL_BASE}?date=2026-03-28`, { Authorization: "Bearer valid-key", "If-None-Match": etag })
    );

    expect(secondResponse.status).toBe(304);
    expect(await secondResponse.text()).toBe("");
    expect(secondResponse.headers.get("ETag")).toBe(etag);
    expect(secondResponse.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});

describe("input hardening (waist)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiRequest.mockResolvedValue({ userId: "user-123" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 59 });
    mockGetWaistReadings.mockResolvedValue([]);
    mockUpsertWaistReadings.mockResolvedValue(1);
  });

  async function post(readings: unknown[]) {
    return POST(createPostRequest(URL_BASE, { readings }, { Authorization: "Bearer k" }));
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
    expect(mockUpsertWaistReadings).not.toHaveBeenCalled();
  });

  // JSON has no Infinity/NaN — JSON.stringify turns them into null, which must be rejected too.
  it.each([0, -5, 300.1, 301, Infinity, NaN, null, "104.5", true])("rejects valueCm %s", async (valueCm) => {
    const response = await post([{ ...VALID_READING, valueCm }]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/valueCm/);
    expect(mockUpsertWaistReadings).not.toHaveBeenCalled();
  });

  it.each([0.1, 104.55, 300])("accepts valueCm %s", async (valueCm) => {
    const response = await post([{ ...VALID_READING, valueCm }]);
    expect(response.status).toBe(200);
    expect(mockUpsertWaistReadings).toHaveBeenCalledWith("user-123", [expect.objectContaining({ valueCm })]);
  });

  it.each(["+5:30", "0300", "-03:00:00", "Z"])("rejects zoneOffset %s", async (zoneOffset) => {
    const response = await post([{ ...VALID_READING, zoneOffset }]);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toMatch(/zoneOffset/);
  });

  it("GET rejects a range longer than 31 days with 400", async () => {
    const response = await GET(createGetRequest(`${URL_BASE}?from=2026-01-01&to=2026-03-01`, { Authorization: "Bearer k" }));
    expect(response.status).toBe(400);
    expect(mockGetWaistReadings).not.toHaveBeenCalled();
  });

  it("GET accepts a 31-day range", async () => {
    const response = await GET(createGetRequest(`${URL_BASE}?from=2026-03-01&to=2026-03-31`, { Authorization: "Bearer k" }));
    expect(response.status).toBe(200);
  });

  it("GET maps the row-limit error to 400", async () => {
    mockGetWaistReadings.mockRejectedValue(new Error("READINGS_LIMIT_EXCEEDED"));
    const response = await GET(createGetRequest(`${URL_BASE}?date=2026-03-01`, { Authorization: "Bearer k" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
