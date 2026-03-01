import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, FoodLogEntryDetail } from "@/types";

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
  };
});

const mockEditAnalysis = vi.fn();
vi.mock("@/lib/claude", () => ({
  editAnalysis: (...args: unknown[]) => mockEditAnalysis(...args),
}));

const mockGetFoodLogEntryDetail = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getFoodLogEntryDetail: (...args: unknown[]) => mockGetFoodLogEntryDetail(...args),
}));

vi.mock("@/lib/sse", () => ({
  createSSEResponse: vi.fn(() => new Response("data: {}\n\n", { headers: { "Content-Type": "text/event-stream" } })),
}));

const { POST } = await import("@/app/api/edit-chat/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

const existingEntry: FoodLogEntryDetail = {
  id: 42,
  customFoodId: 100,
  foodName: "Empanada de carne",
  description: "Standard Argentine beef empanada",
  notes: "Baked style",
  calories: 320,
  proteinG: 12,
  carbsG: 28,
  fatG: 18,
  fiberG: 2,
  sodiumMg: 450,
  saturatedFatG: null,
  transFatG: null,
  sugarsG: null,
  caloriesFromFat: null,
  amount: 150,
  unitId: 147,
  mealTypeId: 5,
  date: "2026-02-15",
  time: "20:00:00",
  fitbitLogId: 12345,
  fitbitFoodId: null,
  confidence: "high",
  isFavorite: false,
};

function createMockRequest(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
    signal: new AbortController().signal,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(validSession);
  mockGetFoodLogEntryDetail.mockResolvedValue(existingEntry);
  mockEditAnalysis.mockReturnValue((async function* () {
    yield { type: "done" };
  })());
});

describe("POST /api/edit-chat image validation", () => {
  it("accepts messages with valid base64 images", async () => {
    const request = createMockRequest({
      entryId: 42,
      messages: [{ role: "user", content: "Test", images: ["dGVzdA=="] }],
      clientDate: "2026-02-15",
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  it("returns 400 when images is not an array", async () => {
    const request = createMockRequest({
      entryId: 42,
      messages: [{ role: "user", content: "Test", images: "not-an-array" }],
      clientDate: "2026-02-15",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("images must be an array");
  });

  it("returns 400 when image is not valid base64", async () => {
    const request = createMockRequest({
      entryId: 42,
      messages: [{ role: "user", content: "Test", images: ["invalid base64 with @#$%"] }],
      clientDate: "2026-02-15",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("not valid base64");
  });

  it("returns 400 when total images exceed MAX_IMAGES", async () => {
    const request = createMockRequest({
      entryId: 42,
      messages: [
        { role: "user", content: "First", images: Array.from({ length: 5 }, () => "dGVzdA==") },
        { role: "assistant", content: "OK" },
        { role: "user", content: "Second", images: Array.from({ length: 5 }, () => "dGVzdA==") },
      ],
      clientDate: "2026-02-15",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("9");
  });

  it("returns 400 when images appear on assistant messages", async () => {
    const request = createMockRequest({
      entryId: 42,
      messages: [{ role: "assistant", content: "Test", images: ["dGVzdA=="] }],
      clientDate: "2026-02-15",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("only valid on user messages");
  });
});
