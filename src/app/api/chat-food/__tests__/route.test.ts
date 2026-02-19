import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FoodAnalysis, FullSession } from "@/types";
import { parseSSEEvents } from "@/lib/sse";
import type { StreamEvent } from "@/lib/sse";

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
vi.mock("@/lib/logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

// Mock conversationalRefine (returns AsyncGenerator<StreamEvent>) but keep real validateFoodAnalysis
const { mockConversationalRefine } = vi.hoisted(() => ({
  mockConversationalRefine: vi.fn(),
}));
vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return {
    ...actual,
    conversationalRefine: mockConversationalRefine,
  };
});

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

/** Consume a Server-Sent Events Response body and parse all events. */
async function consumeSSEStream(response: Response): Promise<StreamEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const allEvents: StreamEvent[] = [];
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const { events, remaining } = parseSSEEvents(chunk, buffer);
      buffer = remaining;
      allEvents.push(...events);
    }
  } finally {
    reader.releaseLock();
  }
  return allEvents;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
});

describe("POST /api/chat-food", () => {
  // ---- Validation errors (still returned as JSON, before streaming) ----

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

  it("returns 400 when messages array exceeds max size (30 messages)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    // Create 31 messages (exceeds limit)
    const messages = Array.from({ length: 31 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
    }));

    const request = createMockRequest({ messages });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("30");
  });

  it("returns 400 when total images across messages exceed MAX_IMAGES (9)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    // 5 images on first message + 5 on second = 10 (exceeds limit of 9)
    const request = createMockRequest({
      messages: [
        { role: "user", content: "First", images: Array.from({ length: 5 }, () => "validbase64data") },
        { role: "assistant", content: "OK" },
        { role: "user", content: "Second", images: Array.from({ length: 5 }, () => "validbase64data") },
      ],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("9");
  });

  it("returns 400 when per-message image string is not valid base64", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test", images: ["invalid base64 with spaces and @#$%"] }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("base64");
  });

  it("returns 400 when decoded per-message image exceeds MAX_IMAGE_SIZE (10MB)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const largeBase64 = "A".repeat(14 * 1024 * 1024);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test", images: [largeBase64] }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("10MB");
  });

  it("returns 400 when per-message images field is not an array", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test", images: "not-an-array" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when per-message images contains non-string entries", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test", images: [123] }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when assistant message has images", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi", images: ["somebase64"] },
      ],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("only valid on user messages");
  });

  it("returns 400 when per-message image is empty string", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test", images: [""] }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("must not be empty");
  });

  it("returns 400 when message content exceeds 2000 characters", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "x".repeat(2001) }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("2000");
  });

  it("accepts message content of exactly 2000 characters", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "x".repeat(2000) }],
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("returns 400 when initialAnalysis has missing required fields", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Refine this" }],
      initialAnalysis: { food_name: "Pizza" }, // missing all numeric fields
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("amount must be a number");
  });

  it("returns 400 when initialAnalysis has wrong field types", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Refine this" }],
      initialAnalysis: {
        ...validAnalysis,
        calories: "not a number", // should be number
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("calories must be a number");
  });

  it("returns 400 when initialAnalysis has negative numbers", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Refine this" }],
      initialAnalysis: {
        ...validAnalysis,
        calories: -100,
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("calories must not be negative");
  });

  it("returns 400 when initialAnalysis has zero amount", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Refine this" }],
      initialAnalysis: {
        ...validAnalysis,
        amount: 0,
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("amount must be positive");
  });

  it("returns 400 when initialAnalysis has invalid confidence value", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Refine this" }],
      initialAnalysis: {
        ...validAnalysis,
        confidence: "very high",
      },
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("confidence must be high, medium, or low");
  });

  // ---- SSE streaming responses (success path) ----

  it("does not require Fitbit connection and returns SSE response", async () => {
    mockGetSession.mockResolvedValue({
      ...validSession,
      fitbitConnected: false,
    });
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "I had pizza" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("returns Content-Type text/event-stream for valid request", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "text_delta", text: "Got it! Anything else?" } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "I had pizza" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("streams text_delta event for text-only response (no analysis)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "text_delta", text: "Got it! Anything else?" } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest({
      messages: [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Logged" },
        { role: "user", content: "Thanks!" },
      ],
    });

    const response = await POST(request);
    const events = await consumeSSEStream(response);

    const textEvents = events.filter((e) => e.type === "text_delta");
    expect(textEvents.length).toBeGreaterThan(0);
    const analysisEvent = events.find((e) => e.type === "analysis");
    expect(analysisEvent).toBeUndefined();
  });

  it("streams analysis event when conversationalRefine yields analysis", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const updatedAnalysis = { ...validAnalysis, amount: 200 };
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "text_delta", text: "Updated the portion to 200g" } as StreamEvent;
      yield { type: "analysis", analysis: updatedAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest({
      messages: [
        { role: "user", content: "I had an empanada" },
        { role: "assistant", content: "Logged" },
        { role: "user", content: "Actually it was 200g" },
      ],
    });

    const response = await POST(request);
    const events = await consumeSSEStream(response);

    const analysisEvent = events.find((e) => e.type === "analysis");
    expect(analysisEvent).toBeDefined();
    expect((analysisEvent as { type: "analysis"; analysis: FoodAnalysis }).analysis.amount).toBe(200);
  });

  it("streams error event when conversationalRefine generator throws", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockImplementation(async function* (): AsyncGenerator<StreamEvent> {
      throw new Error("API failure");
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
    });

    const response = await POST(request);
    // Response is SSE even on generator error
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await consumeSSEStream(response);
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });

  it("passes per-message images through to conversationalRefine", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest({
      messages: [
        { role: "user", content: "What's this?", images: ["base64imagedata1", "base64imagedata2"] },
      ],
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Verify conversationalRefine receives messages with images embedded
    expect(mockConversationalRefine).toHaveBeenCalledWith(
      [{ role: "user", content: "What's this?", images: ["base64imagedata1", "base64imagedata2"] }],
      "user-uuid-123",
      expect.any(String), // currentDate
      undefined,
      undefined, // request.signal (mock request has no signal)
      expect.any(Object), // logger
    );
  });

  it("passes initialAnalysis to conversationalRefine when provided", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "analysis", analysis: { ...validAnalysis, amount: 200 } } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "Actually it was 200g" }],
      initialAnalysis: validAnalysis,
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(mockConversationalRefine).toHaveBeenCalledWith(
      [{ role: "user", content: "Actually it was 200g" }],
      "user-uuid-123",
      expect.any(String), // currentDate
      validAnalysis,
      undefined, // request.signal (mock request has no signal)
      expect.any(Object), // logger
    );
  });

  it("uses clientDate from request body when provided", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "Actually it was 200g" }],
      clientDate: "2026-01-15",
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(mockConversationalRefine).toHaveBeenCalledWith(
      [{ role: "user", content: "Actually it was 200g" }],
      "user-uuid-123",
      "2026-01-15",
      undefined,
      undefined, // request.signal (mock request has no signal)
      expect.any(Object), // logger
    );
  });

  it("ignores invalid clientDate and falls back to server date", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
      clientDate: "bad-date",
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Should fall back to a valid YYYY-MM-DD date, not use "bad-date"
    const calledDate = mockConversationalRefine.mock.calls[0][2];
    expect(calledDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(calledDate).not.toBe("bad-date");
  });

  it("uses rate limit key chat-food:userId", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "done" } as StreamEvent;
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

  it("works in free-form mode (no initialAnalysis, no images)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockConversationalRefine.mockImplementation(async function* () {
      yield { type: "text_delta", text: "You ate about 2000 calories today." } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest({
      messages: [
        { role: "user", content: "How many calories did I eat today?" },
      ],
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const events = await consumeSSEStream(response);
    const textEvent = events.find((e) => e.type === "text_delta");
    expect(textEvent).toBeDefined();

    // Verify conversationalRefine was called with no initialAnalysis
    expect(mockConversationalRefine).toHaveBeenCalledWith(
      [{ role: "user", content: "How many calories did I eat today?" }],
      "user-uuid-123",
      expect.any(String), // currentDate
      undefined, // no initialAnalysis
      undefined, // request.signal (mock request has no signal)
      expect.any(Object), // logger
    );
  });
});
