import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FoodAnalysis } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");

// Mock iron-session
vi.mock("iron-session", () => ({
  getIronSession: vi.fn(),
}));

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
  }),
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
const mockAnalyzeFood = vi.fn();
vi.mock("@/lib/claude", () => ({
  analyzeFood: mockAnalyzeFood,
}));

const { getIronSession } = await import("iron-session");
const { POST } = await import("@/app/api/analyze-food/route");
const { logger } = await import("@/lib/logger");

const mockGetIronSession = vi.mocked(getIronSession);

const validSession = {
  sessionId: "test-session",
  email: "wall.lucas@gmail.com",
  createdAt: Date.now(),
  expiresAt: Date.now() + 86400000,
  fitbit: {
    accessToken: "token",
    refreshToken: "refresh",
    userId: "user-123",
    expiresAt: Date.now() + 28800000,
  },
};

const validAnalysis: FoodAnalysis = {
  food_name: "Empanada de carne",
  portion_size_g: 150,
  calories: 320,
  protein_g: 12,
  carbs_g: 28,
  fat_g: 18,
  fiber_g: 2,
  sodium_mg: 450,
  confidence: "high",
  notes: "Standard Argentine beef empanada, baked style",
};

interface MockFile {
  name: string;
  type: string;
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

function createMockFile(
  name: string,
  type: string,
  sizeInBytes: number
): MockFile {
  const buffer = new ArrayBuffer(Math.min(sizeInBytes, 100));
  return {
    name,
    type,
    size: sizeInBytes,
    arrayBuffer: () => Promise.resolve(buffer),
  };
}

function createMockRequest(
  files: MockFile[],
  description?: string
): Request {
  const formData = {
    getAll: (key: string) => (key === "images" ? files : []),
    get: (key: string) => (key === "description" ? description : null),
  };

  return {
    formData: () => Promise.resolve(formData),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/analyze-food", () => {
  it("returns 401 for missing session", async () => {
    mockGetIronSession.mockResolvedValue({} as never);

    const request = createMockRequest([
      createMockFile("test.jpg", "image/jpeg", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 FITBIT_NOT_CONNECTED when session.fitbit is missing", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "wall.lucas@gmail.com",
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    } as never);

    const request = createMockRequest([
      createMockFile("test.jpg", "image/jpeg", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_NOT_CONNECTED");
  });

  it("returns 400 VALIDATION_ERROR for no images", async () => {
    mockGetIronSession.mockResolvedValue(validSession as never);

    const request = createMockRequest([]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("image");
  });

  it("returns 400 VALIDATION_ERROR for more than 3 images", async () => {
    mockGetIronSession.mockResolvedValue(validSession as never);

    const request = createMockRequest([
      createMockFile("test1.jpg", "image/jpeg", 1000),
      createMockFile("test2.jpg", "image/jpeg", 1000),
      createMockFile("test3.jpg", "image/jpeg", 1000),
      createMockFile("test4.jpg", "image/jpeg", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("3");
  });

  it("returns 400 VALIDATION_ERROR for invalid image type", async () => {
    mockGetIronSession.mockResolvedValue(validSession as never);

    const request = createMockRequest([
      createMockFile("test.gif", "image/gif", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("JPEG");
  });

  it("returns 400 VALIDATION_ERROR for image over 10MB", async () => {
    mockGetIronSession.mockResolvedValue(validSession as never);

    const request = createMockRequest([
      createMockFile("test.jpg", "image/jpeg", 11 * 1024 * 1024),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("10MB");
  });

  it("returns 200 with FoodAnalysis for valid request", async () => {
    mockGetIronSession.mockResolvedValue(validSession as never);
    mockAnalyzeFood.mockResolvedValue(validAnalysis);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      "Test empanada"
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(validAnalysis);
  });

  it("returns 500 CLAUDE_API_ERROR on Claude failure", async () => {
    mockGetIronSession.mockResolvedValue(validSession as never);
    const error = new Error("Claude API failed");
    error.name = "CLAUDE_API_ERROR";
    mockAnalyzeFood.mockRejectedValue(error);

    const request = createMockRequest([
      createMockFile("test.jpg", "image/jpeg", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("CLAUDE_API_ERROR");
  });

  it("logs appropriate actions", async () => {
    mockGetIronSession.mockResolvedValue(validSession as never);
    mockAnalyzeFood.mockResolvedValue(validAnalysis);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      "Test food"
    );

    await POST(request);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "analyze_food_request" }),
      expect.any(String)
    );
  });

  it("supports PNG images", async () => {
    mockGetIronSession.mockResolvedValue(validSession as never);
    mockAnalyzeFood.mockResolvedValue(validAnalysis);

    const request = createMockRequest([
      createMockFile("test.png", "image/png", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("supports multiple images", async () => {
    mockGetIronSession.mockResolvedValue(validSession as never);
    mockAnalyzeFood.mockResolvedValue(validAnalysis);

    const request = createMockRequest([
      createMockFile("test1.jpg", "image/jpeg", 1000),
      createMockFile("test2.png", "image/png", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(mockAnalyzeFood).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ mimeType: "image/jpeg" }),
        expect.objectContaining({ mimeType: "image/png" }),
      ]),
      undefined
    );
  });

  it("passes description to analyzeFood", async () => {
    mockGetIronSession.mockResolvedValue(validSession as never);
    mockAnalyzeFood.mockResolvedValue(validAnalysis);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      "250g pollo asado"
    );

    await POST(request);

    expect(mockAnalyzeFood).toHaveBeenCalledWith(
      expect.any(Array),
      "250g pollo asado"
    );
  });
});
