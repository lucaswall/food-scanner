import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (
    session: FullSession | null,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: { requireFitbit?: boolean },
  ): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
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

// Mock freeChat
const mockFreeChat = vi.fn();
vi.mock("@/lib/claude", () => ({
  freeChat: mockFreeChat,
}));

const { POST } = await import("@/app/api/chat/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
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

describe("POST /api/chat", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createMockRequest({
      messages: [{ role: "user", content: "How many calories did I eat today?" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("does not require Fitbit connection", async () => {
    mockGetSession.mockResolvedValue({
      ...validSession,
      fitbitConnected: false,
    });
    mockFreeChat.mockResolvedValue({
      message: "You haven't logged any food yet.",
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "What did I eat?" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockCheckRateLimit.mockReturnValue({ allowed: false, remaining: 0 });

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
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
    expect(body.error.message).toContain("messages must be an array");
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
    expect(body.error.message).toContain("cannot be empty");
  });

  it("returns 400 when messages array exceeds maximum of 30", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const messages = Array(31).fill({ role: "user", content: "Test" });

    const request = createMockRequest({ messages });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("exceeds maximum of 30");
  });

  it("returns 400 when message role is invalid", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "system", content: "Test" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("role must be");
  });

  it("returns 400 when message content is not a string", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest({
      messages: [{ role: "user", content: 123 }],
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("content must be a string");
  });

  it("calls freeChat with correct parameters", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFreeChat.mockResolvedValue({
      message: "You ate 1800 calories today.",
    });

    const messages = [
      { role: "user" as const, content: "How many calories did I eat today?" },
    ];

    const request = createMockRequest({ messages });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(mockFreeChat).toHaveBeenCalledWith(
      messages,
      "user-uuid-123",
      expect.any(String) // currentDate
    );
  });

  it("returns success response with message", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFreeChat.mockResolvedValue({
      message: "You ate 1800 calories today, which is 90% of your 2000 cal goal.",
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      message: "You ate 1800 calories today, which is 90% of your 2000 cal goal.",
    });
  });

  it("handles CLAUDE_API_ERROR from freeChat", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const error = new Error("API connection failed");
    error.name = "CLAUDE_API_ERROR";
    mockFreeChat.mockRejectedValue(error);

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("CLAUDE_API_ERROR");
  });

  it("handles unexpected errors from freeChat", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFreeChat.mockRejectedValue(new Error("Unknown error"));

    const request = createMockRequest({
      messages: [{ role: "user", content: "Test" }],
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("CLAUDE_API_ERROR");
  });

  it("uses clientDate from request body when provided", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFreeChat.mockResolvedValue({
      message: "Here's your data.",
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "What did I eat?" }],
      clientDate: "2026-01-15",
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(mockFreeChat).toHaveBeenCalledWith(
      [{ role: "user", content: "What did I eat?" }],
      "user-uuid-123",
      "2026-01-15"
    );
  });

  it("ignores invalid clientDate and falls back to server date", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFreeChat.mockResolvedValue({
      message: "Here's your data.",
    });

    const request = createMockRequest({
      messages: [{ role: "user", content: "What did I eat?" }],
      clientDate: "not-a-date",
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Should NOT pass "not-a-date" — should fall back to a valid date
    expect(mockFreeChat).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    );
  });

  it("supports multi-turn conversations", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockFreeChat.mockResolvedValue({
      message: "Today you had pizza for lunch and a salad for dinner.",
    });

    const messages = [
      { role: "user" as const, content: "What did I eat today?" },
      { role: "assistant" as const, content: "You had pizza and salad." },
      { role: "user" as const, content: "What meal was the pizza?" },
    ];

    const request = createMockRequest({ messages });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(mockFreeChat).toHaveBeenCalledWith(
      messages,
      "user-uuid-123",
      expect.any(String)
    );
  });
});
