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

// Mock conversationalRefine
const mockConversationalRefine = vi.fn();
vi.mock("@/lib/claude", () => ({
  conversationalRefine: mockConversationalRefine,
}));

const { POST } = await import("@/app/api/chat-food/route");

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
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high",
  notes: "Standard Argentine beef empanada, baked style",
  keywords: ["empanada", "carne", "horno"],
  description: "Standard Argentine beef empanada, baked style",
};

function createMockRequest(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
});

describe("POST /api/chat-food", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createMockRequest({
      messages: [{ role: "user", content: "I had pizza" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 when session is invalid (no Fitbit)", async () => {
    mockGetSession.mockResolvedValue({
      ...validSession,
      fitbitConnected: false,
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "I had pizza" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_NOT_CONNECTED");
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const request = createMockRequest({
      messages: [{ role: "user", content: "I had pizza" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns 400 when messages array is missing", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({});

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("messages");
  });

  it("returns 400 when messages array is empty", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("messages");
  });

  it("returns 400 when messages contain invalid shape (missing role)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ content: "test" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when messages contain invalid shape (missing content)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns success with assistant message when Claude returns text-only response", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockResolvedValue({
      message: "Got it! Anything else?",
    });

    const request = createMockRequest({
      messages: [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Logged", analysis: validAnalysis },
        { role: "user", content: "Thanks!" },
      ],
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toBe("Got it! Anything else?");
    expect(body.data.analysis).toBeUndefined();
  });

  it("returns success with assistant message AND analysis when Claude returns text + tool_use", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockResolvedValue({
      message: "Updated the portion to 200g",
      analysis: { ...validAnalysis, amount: 200 },
    });

    const request = createMockRequest({
      messages: [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Logged", analysis: validAnalysis },
        { role: "user", content: "Actually it was 200g" },
      ],
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toBe("Updated the portion to 200g");
    expect(body.data.analysis).toBeDefined();
    expect(body.data.analysis.amount).toBe(200);
  });

  it("passes images to Claude when provided in request", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockResolvedValue({
      message: "I see the food",
      analysis: validAnalysis,
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "What's this?" }],
      images: ["base64imagedata1", "base64imagedata2"],
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Verify conversationalRefine was called with images converted to ImageInput[]
    expect(mockConversationalRefine).toHaveBeenCalledWith(
      [{ role: "user", content: "What's this?" }],
      [
        { base64: "base64imagedata1", mimeType: "image/jpeg" },
        { base64: "base64imagedata2", mimeType: "image/jpeg" },
      ],
      "user-uuid-123",
      expect.any(String), // currentDate
      undefined
    );
  });

  it("passes initialAnalysis to conversationalRefine when provided", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockResolvedValue({
      message: "Updated to 200g",
      analysis: { ...validAnalysis, amount: 200 },
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "Actually it was 200g" }],
      initialAnalysis: validAnalysis,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(mockConversationalRefine).toHaveBeenCalledWith(
      [{ role: "user", content: "Actually it was 200g" }],
      [],
      "user-uuid-123",
      expect.any(String), // currentDate
      validAnalysis
    );
  });

  it("returns 500 on Claude API error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const error = new Error("API failure");
    error.name = "CLAUDE_API_ERROR";
    mockConversationalRefine.mockRejectedValue(error);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("CLAUDE_API_ERROR");
  });

  it("uses rate limit key chat-food:userId", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockResolvedValue({
      message: "Done",
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
    });

    await POST(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "chat-food:user-uuid-123",
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("returns 400 when messages array exceeds max size (20 messages)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    // Create 21 messages (exceeds limit)
    const messages = Array.from({ length: 21 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    }));

    const request = createMockRequest({ messages });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("20");
  });

  it("returns 400 when images array exceeds MAX_IMAGES (9)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    // Create 10 images (exceeds limit of 9)
    const images = Array.from({ length: 10 }, () => "validbase64data");

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
      images,
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("9");
  });

  it("returns 400 when image string is not valid base64", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
      images: ["invalid base64 with spaces and @#$%"],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("base64");
  });

  it("returns 400 when decoded image exceeds MAX_IMAGE_SIZE (10MB)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    // Create a base64 string that decodes to >10MB
    // 10MB * 1.34 (base64 overhead) ≈ 13.4MB base64
    const largeBase64 = "A".repeat(14 * 1024 * 1024); // 14MB of 'A' characters

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
      images: [largeBase64],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("10MB");
  });
});
