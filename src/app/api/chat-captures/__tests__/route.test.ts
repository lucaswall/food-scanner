import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";
import { parseSSEEvents } from "@/lib/sse";
import type { StreamEvent } from "@/lib/sse";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (session: FullSession | null): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      );
    }
    return null;
  },
}));

const mockCheckRateLimit = vi.fn().mockReturnValue({ allowed: true, remaining: 29 });
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

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
    startTimer: vi.fn(() => () => 0),
  };
});

const { mockTriageRefine } = vi.hoisted(() => ({
  mockTriageRefine: vi.fn(),
}));
vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return {
    ...actual,
    triageRefine: mockTriageRefine,
  };
});

const { POST } = await import("@/app/api/chat-captures/route");

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
    signal: new AbortController().signal,
  } as unknown as Request;
}

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

const validMessage = { role: "user" as const, content: "Remove the salad" };

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
});

describe("POST /api/chat-captures", () => {
  it("returns 401 without session", async () => {
    mockGetSession.mockResolvedValue(null);
    const response = await POST(createMockRequest({ messages: [validMessage] }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 with empty messages", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const response = await POST(createMockRequest({ messages: [] }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with missing messages", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const response = await POST(createMockRequest({}));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns SSE stream with valid messages (mock Claude response)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockTriageRefine.mockImplementation(async function* () {
      yield { type: "text_delta", text: "Updated list:" } as StreamEvent;
      yield { type: "session_items", items: [] } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const response = await POST(createMockRequest({ messages: [validMessage] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const events = await consumeSSEStream(response);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const response = await POST(createMockRequest({ messages: [validMessage] }));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("passes initialItems to triageRefine if provided", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockTriageRefine.mockImplementation(async function* () {
      yield { type: "done" } as StreamEvent;
    });

    const initialItems = [{
      food_name: "Empanada",
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
      confidence: "high" as const,
      notes: "baked",
      description: "Baked beef empanada",
      keywords: ["empanada"],
    }];

    const response = await POST(createMockRequest({ messages: [validMessage], initialItems }));
    await consumeSSEStream(response);

    expect(mockTriageRefine).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining([expect.objectContaining({ food_name: "Empanada" })]),
      expect.anything(),
      expect.anything(),
    );
  });
});
