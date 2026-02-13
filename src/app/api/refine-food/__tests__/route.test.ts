import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FoodAnalysis, FullSession } from "@/types";

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
const mockCheckRateLimit = vi.fn().mockReturnValue({ allowed: true, remaining: 29 });
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

// Mock Claude API
const mockRefineAnalysis = vi.fn();
vi.mock("@/lib/claude", () => ({
  refineAnalysis: mockRefineAnalysis,
}));

const { POST } = await import("@/app/api/refine-food/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

const validAnalysis: FoodAnalysis = {
  food_name: "Empanada de carne",
  amount: 150,
  unit_id: 147,
  calories: 320,
  protein_g: 12,
  carbs_g: 28,
  fat_g: 18,
  fiber_g: 2,
  sodium_mg: 450,
  confidence: "high",
  notes: "Standard Argentine beef empanada, baked style",
  keywords: ["empanada", "carne", "horno"],
  description: "Standard Argentine beef empanada, baked style",
};

// Create a mock file that works with jsdom (which lacks File.arrayBuffer)
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

function createMockRequest(
  files: MockFile[],
  previousAnalysis?: string,
  correction?: string,
): Request {
  const formData = {
    getAll: (key: string) => (key === "images" ? files : []),
    get: (key: string) => {
      if (key === "previousAnalysis") return previousAnalysis ?? null;
      if (key === "correction") return correction ?? null;
      return null;
    },
  };

  return {
    formData: () => Promise.resolve(formData),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/refine-food", () => {
  it("returns 401 for unauthenticated user", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      JSON.stringify(validAnalysis),
      "Make it 500 calories"
    );

    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("allows refinement without images (images are optional)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockRefineAnalysis.mockResolvedValue(validAnalysis);

    const request = createMockRequest(
      [],
      JSON.stringify(validAnalysis),
      "Make it 500 calories"
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("returns 400 when no correction text provided", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      JSON.stringify(validAnalysis),
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("correction");
  });

  it("returns 400 when correction is empty string", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      JSON.stringify(validAnalysis),
      ""
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("correction");
  });

  it("returns 400 when no previousAnalysis provided", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      undefined,
      "Make it 500 calories"
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("previousAnalysis");
  });

  it("returns 400 when previousAnalysis is invalid JSON", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      "not valid json {{{",
      "Make it 500 calories"
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("previousAnalysis");
  });

  it("returns 400 when previousAnalysis is missing required fields", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      JSON.stringify({ food_name: "Test" }), // missing most fields
      "Make it 500 calories"
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("previousAnalysis");
  });

  it("returns 200 with refined analysis for valid request", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const refinedAnalysis = { ...validAnalysis, calories: 500 };
    mockRefineAnalysis.mockResolvedValue(refinedAnalysis);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      JSON.stringify(validAnalysis),
      "Actually this is about 500 calories"
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(refinedAnalysis);
  });

  it("returns 500 when Claude API fails", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const error = new Error("Claude API failed");
    error.name = "CLAUDE_API_ERROR";
    mockRefineAnalysis.mockRejectedValue(error);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      JSON.stringify(validAnalysis),
      "Fix it"
    );

    const response = await POST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("CLAUDE_API_ERROR");
  });

  it("returns 200 for refinement without images", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const refinedAnalysis = { ...validAnalysis, calories: 500 };
    mockRefineAnalysis.mockResolvedValue(refinedAnalysis);

    const request = createMockRequest(
      [],
      JSON.stringify(validAnalysis),
      "Actually this is about 500 calories"
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(refinedAnalysis);
    expect(mockRefineAnalysis).toHaveBeenCalledWith(
      [],
      validAnalysis,
      "Actually this is about 500 calories",
      "user-uuid-123"
    );
  });

  it("returns 400 for unsupported image type", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest(
      [createMockFile("test.bmp", "image/bmp", 1000)],
      JSON.stringify(validAnalysis),
      "Fix it"
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for image over 10MB", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 11 * 1024 * 1024)],
      JSON.stringify(validAnalysis),
      "Fix it"
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("10MB");
  });

  it("returns 400 for more than 9 images", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest(
      [
        createMockFile("test1.jpg", "image/jpeg", 1000),
        createMockFile("test2.jpg", "image/jpeg", 1000),
        createMockFile("test3.jpg", "image/jpeg", 1000),
        createMockFile("test4.jpg", "image/jpeg", 1000),
        createMockFile("test5.jpg", "image/jpeg", 1000),
        createMockFile("test6.jpg", "image/jpeg", 1000),
        createMockFile("test7.jpg", "image/jpeg", 1000),
        createMockFile("test8.jpg", "image/jpeg", 1000),
        createMockFile("test9.jpg", "image/jpeg", 1000),
        createMockFile("test10.jpg", "image/jpeg", 1000),
      ],
      JSON.stringify(validAnalysis),
      "Fix it"
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("9");
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      JSON.stringify(validAnalysis),
      "Make it 500 calories"
    );

    const response = await POST(request);
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("calls checkRateLimit with session userId as key", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockRefineAnalysis.mockResolvedValue(validAnalysis);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      JSON.stringify(validAnalysis),
      "Larger portion"
    );

    await POST(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "refine-food:user-uuid-123",
      30,
      15 * 60 * 1000,
    );
  });

  it("passes correct arguments to refineAnalysis", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockRefineAnalysis.mockResolvedValue(validAnalysis);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      JSON.stringify(validAnalysis),
      "Larger portion"
    );

    await POST(request);

    expect(mockRefineAnalysis).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ mimeType: "image/jpeg" }),
      ]),
      validAnalysis,
      "Larger portion",
      "user-uuid-123"
    );
  });
});
