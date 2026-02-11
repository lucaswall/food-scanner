import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, LumenGoals } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (
    session: FullSession | null,
    options?: { requireFitbit?: boolean },
  ): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      );
    }
    if (options?.requireFitbit && !session.fitbitConnected) {
      return Response.json(
        { success: false, error: { code: "FITBIT_NOT_CONNECTED", message: "Fitbit account not connected" }, timestamp: Date.now() },
        { status: 400 },
      );
    }
    if (options?.requireFitbit && !session.hasFitbitCredentials) {
      return Response.json(
        { success: false, error: { code: "FITBIT_CREDENTIALS_MISSING", message: "Fitbit credentials not configured" }, timestamp: Date.now() },
        { status: 400 },
      );
    }
    return null;
  },
}));

// Mock rate limiter
const mockCheckRateLimit = vi.fn().mockReturnValue({ allowed: true, remaining: 19 });
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Lumen API
const mockParseLumenScreenshot = vi.fn();
const mockUpsertLumenGoals = vi.fn();
const mockGetLumenGoalsByDate = vi.fn();
vi.mock("@/lib/lumen", () => ({
  parseLumenScreenshot: mockParseLumenScreenshot,
  upsertLumenGoals: mockUpsertLumenGoals,
  getLumenGoalsByDate: mockGetLumenGoalsByDate,
  LumenParseError: class LumenParseError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "LUMEN_PARSE_ERROR";
    }
  },
}));

const { GET, POST } = await import("@/app/api/lumen-goals/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: false, // Lumen doesn't need Fitbit
  hasFitbitCredentials: false,
  destroy: vi.fn(),
};

const validLumenGoals: LumenGoals = {
  date: "2026-02-10",
  dayType: "High Carb",
  proteinGoal: 120,
  carbsGoal: 200,
  fatGoal: 60,
};

// Create a mock file that works with jsdom
class MockFile {
  name: string;
  type: string;
  size: number;
  private content: ArrayBuffer;

  constructor(name: string, type: string, sizeInBytes: number) {
    this.name = name;
    this.type = type;
    this.size = sizeInBytes;
    this.content = new ArrayBuffer(Math.min(sizeInBytes, 100));
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this.content);
  }
}

function createMockFile(
  name: string,
  type: string,
  sizeInBytes: number
): MockFile {
  return new MockFile(name, type, sizeInBytes);
}

function createMockPostRequest(
  file: MockFile | null,
  date?: string
): Request {
  const formData = {
    get: (key: string) => {
      if (key === "image") return file;
      if (key === "date") return date ?? null;
      return null;
    },
  };

  return {
    formData: () => Promise.resolve(formData),
  } as unknown as Request;
}

function createMockGetRequest(date?: string): Request {
  const url = date
    ? `http://localhost/api/lumen-goals?date=${date}`
    : "http://localhost/api/lumen-goals";

  return {
    url,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/lumen-goals", () => {
  it("returns 401 without session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createMockGetRequest("2026-02-10");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 for missing date param", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockGetRequest();
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("date");
  });

  it("returns 400 for invalid date format", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockGetRequest("02/10/2026");
    const response = await GET(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("YYYY-MM-DD");
  });

  it("returns { goals: null } when no goals exist", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetLumenGoalsByDate.mockResolvedValue(null);

    const request = createMockGetRequest("2026-02-10");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.goals).toBeNull();
  });

  it("returns goals when they exist", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetLumenGoalsByDate.mockResolvedValue(validLumenGoals);

    const request = createMockGetRequest("2026-02-10");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.goals).toEqual(validLumenGoals);
  });

  it("sets Cache-Control: private, no-cache", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetLumenGoalsByDate.mockResolvedValue(null);

    const request = createMockGetRequest("2026-02-10");
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("does NOT require Fitbit connection", async () => {
    mockGetSession.mockResolvedValue({
      ...validSession,
      fitbitConnected: false,
      hasFitbitCredentials: false,
    });
    mockGetLumenGoalsByDate.mockResolvedValue(validLumenGoals);

    const request = createMockGetRequest("2026-02-10");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });
});

describe("POST /api/lumen-goals", () => {
  it("returns 401 without session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createMockPostRequest(
      createMockFile("lumen.jpg", "image/jpeg", 1000)
    );
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 429 when rate limited", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const request = createMockPostRequest(
      createMockFile("lumen.jpg", "image/jpeg", 1000)
    );
    const response = await POST(request);

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns 400 for invalid/missing FormData", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = {
      formData: () => Promise.reject(new Error("Invalid form data")),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for missing image", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockPostRequest(null);
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("Image is required");
  });

  it("returns 400 for invalid image type", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockPostRequest(
      createMockFile("lumen.bmp", "image/bmp", 1000)
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/JPEG.*PNG.*GIF.*WebP/i);
  });

  it("returns 400 for oversized image", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockPostRequest(
      createMockFile("lumen.jpg", "image/jpeg", 11 * 1024 * 1024)
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("10MB");
  });

  it("returns parsed+saved goals on success", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockParseLumenScreenshot.mockResolvedValue({
      dayType: "High Carb",
      proteinGoal: 120,
      carbsGoal: 200,
      fatGoal: 60,
    });
    mockUpsertLumenGoals.mockResolvedValue(undefined);

    const request = createMockPostRequest(
      createMockFile("lumen.jpg", "image/jpeg", 1000),
      "2026-02-10"
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      date: "2026-02-10",
      dayType: "High Carb",
      proteinGoal: 120,
      carbsGoal: 200,
      fatGoal: 60,
    });

    expect(mockParseLumenScreenshot).toHaveBeenCalledWith({
      base64: expect.any(String),
      mimeType: "image/jpeg",
    });
    expect(mockUpsertLumenGoals).toHaveBeenCalledWith(
      "user-uuid-123",
      "2026-02-10",
      {
        dayType: "High Carb",
        proteinGoal: 120,
        carbsGoal: 200,
        fatGoal: 60,
      }
    );
  });

  it("returns error with LUMEN_PARSE_ERROR when parsing fails", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const { LumenParseError } = await import("@/lib/lumen");
    mockParseLumenScreenshot.mockRejectedValue(
      new LumenParseError("Could not extract goals from image")
    );

    const request = createMockPostRequest(
      createMockFile("lumen.jpg", "image/jpeg", 1000)
    );
    const response = await POST(request);

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe("LUMEN_PARSE_ERROR");
  });

  it("does NOT require Fitbit connection", async () => {
    mockGetSession.mockResolvedValue({
      ...validSession,
      fitbitConnected: false,
      hasFitbitCredentials: false,
    });
    mockParseLumenScreenshot.mockResolvedValue({
      dayType: "High Carb",
      proteinGoal: 120,
      carbsGoal: 200,
      fatGoal: 60,
    });

    const request = createMockPostRequest(
      createMockFile("lumen.jpg", "image/jpeg", 1000)
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("accepts optional date field in FormData (defaults to today)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockParseLumenScreenshot.mockResolvedValue({
      dayType: "Low Carb",
      proteinGoal: 140,
      carbsGoal: 80,
      fatGoal: 90,
    });

    // Mock system time to return a specific date
    vi.setSystemTime(new Date("2026-02-10T12:00:00Z"));

    const request = createMockPostRequest(
      createMockFile("lumen.jpg", "image/jpeg", 1000)
      // No date provided
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.date).toBe("2026-02-10");

    vi.useRealTimers();
  });
});
