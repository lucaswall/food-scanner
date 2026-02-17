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

// Mock Claude API — analyzeFood now returns AsyncGenerator<StreamEvent>
const mockAnalyzeFood = vi.fn();
vi.mock("@/lib/claude", () => ({
  analyzeFood: mockAnalyzeFood,
}));

const { POST } = await import("@/app/api/analyze-food/route");
const { logger } = await import("@/lib/logger");

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
    // Create small content for actual buffer operations
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
  description?: string,
  clientDate?: string
): Request {
  const formData = {
    getAll: (key: string) => (key === "images" ? files : []),
    get: (key: string) => {
      if (key === "description") return description ?? null;
      if (key === "clientDate") return clientDate ?? null;
      return null;
    },
  };

  return {
    formData: () => Promise.resolve(formData),
    signal: new AbortController().signal,
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
});

describe("POST /api/analyze-food", () => {
  // ---- Validation errors (still returned as JSON, before streaming) ----

  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createMockRequest([
      createMockFile("test.jpg", "image/jpeg", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 FITBIT_NOT_CONNECTED when fitbit is not connected", async () => {
    mockGetSession.mockResolvedValue({
      ...validSession,
      fitbitConnected: false,
    });

    const request = createMockRequest([
      createMockFile("test.jpg", "image/jpeg", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("FITBIT_NOT_CONNECTED");
  });

  it("returns 400 VALIDATION_ERROR for malformed request body", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = {
      formData: () => Promise.reject(new Error("Invalid form data")),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("Invalid form data");
  });

  it("returns 400 VALIDATION_ERROR when no images and no description", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest([]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("At least one image or a description is required");
  });

  it("returns 400 VALIDATION_ERROR for more than 9 images", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest([
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
    ]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("9");
  });

  it("returns 400 VALIDATION_ERROR for unsupported image type", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest([
      createMockFile("test.bmp", "image/bmp", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toMatch(/JPEG.*PNG.*GIF.*WebP/i);
  });

  it("returns 400 VALIDATION_ERROR for image over 10MB", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest([
      createMockFile("test.jpg", "image/jpeg", 11 * 1024 * 1024),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("10MB");
  });

  it("returns 400 VALIDATION_ERROR when images contains non-File values", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockFile = createMockFile("test.jpg", "image/jpeg", 1000);
    const formData = {
      getAll: (key: string) =>
        key === "images" ? [mockFile, "not-a-file"] : [],
      get: (key: string) => (key === "description" ? null : null),
    };

    const request = {
      formData: () => Promise.resolve(formData),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 429 when rate limit exceeded", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const request = createMockRequest([
      createMockFile("test.jpg", "image/jpeg", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns 400 when neither images nor description provided", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest([]);

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR when description is a File", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const mockFile = createMockFile("test.jpg", "image/jpeg", 1000);
    const descriptionFile = createMockFile("desc.txt", "text/plain", 100);
    const formData = {
      getAll: (key: string) => (key === "images" ? [mockFile] : []),
      get: (key: string) => (key === "description" ? descriptionFile : null),
    };

    const request = {
      formData: () => Promise.resolve(formData),
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("text");
  });

  it("returns 400 when description exceeds 2000 characters", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      "x".repeat(2001)
    );

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("2000");
  });

  it("accepts description of exactly 2000 characters", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      "x".repeat(2000)
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
  });

  // ---- SSE streaming responses (success path) ----

  it("returns Content-Type text/event-stream for valid request", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      "Test empanada"
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("response body is a ReadableStream for valid request", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest([createMockFile("test.jpg", "image/jpeg", 1000)]);
    const response = await POST(request);

    expect(response.body).toBeTruthy();
    expect(response.body).toBeInstanceOf(ReadableStream);
  });

  it("streams analysis event for valid request", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      "Test empanada"
    );

    const response = await POST(request);
    const events = await consumeSSEStream(response);

    const analysisEvent = events.find((e) => e.type === "analysis");
    expect(analysisEvent).toBeDefined();
    expect((analysisEvent as { type: "analysis"; analysis: FoodAnalysis }).analysis).toEqual(validAnalysis);
  });

  it("streams needs_chat event when generator yields needs_chat", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const message = "Let me check what you had yesterday...";
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "needs_chat", message } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest([], "same as yesterday");
    const response = await POST(request);

    const events = await consumeSSEStream(response);
    const needsChatEvent = events.find((e) => e.type === "needs_chat");
    expect(needsChatEvent).toBeDefined();
    expect((needsChatEvent as { type: "needs_chat"; message: string }).message).toBe(message);
  });

  it("streams error event when analyzeFood generator throws", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* (): AsyncGenerator<StreamEvent> {
      throw new Error("Claude API failed");
    });

    const request = createMockRequest([createMockFile("test.jpg", "image/jpeg", 1000)]);
    const response = await POST(request);

    // Response is still SSE (error emitted as stream event, not HTTP 500)
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await consumeSSEStream(response);
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });

  it("accepts GIF images (image/gif)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest([
      createMockFile("test.gif", "image/gif", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("accepts WebP images (image/webp)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest([
      createMockFile("test.webp", "image/webp", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("supports PNG images", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest([
      createMockFile("test.png", "image/png", 1000),
    ]);

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
  });

  it("supports multiple images", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

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
      undefined,
      "user-uuid-123",
      expect.any(String),
      expect.any(Object),
      expect.anything(),
    );
  });

  it("passes description to analyzeFood", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      "250g pollo asado"
    );

    await POST(request);

    expect(mockAnalyzeFood).toHaveBeenCalledWith(
      expect.any(Array),
      "250g pollo asado",
      "user-uuid-123",
      expect.any(String),
      expect.any(Object),
      expect.anything(),
    );
  });

  it("returns 200 SSE response for description-only request (no images)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest([], "2 medialunas");

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(mockAnalyzeFood).toHaveBeenCalledWith(
      [],
      "2 medialunas",
      "user-uuid-123",
      expect.any(String),
      expect.any(Object),
      expect.anything(),
    );
  });

  it("calls checkRateLimit with session userId as key", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest([
      createMockFile("test.jpg", "image/jpeg", 1000),
    ]);

    await POST(request);

    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      "analyze-food:user-uuid-123",
      30,
      15 * 60 * 1000,
    );
  });

  it("logs appropriate actions", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

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

  it("processes remaining images when one image arrayBuffer fails", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    // Create a failing file mock
    class FailingMockFile extends MockFile {
      arrayBuffer(): Promise<ArrayBuffer> {
        return Promise.reject(new Error("Failed to read image"));
      }
    }

    const goodFile = createMockFile("good.jpg", "image/jpeg", 1000);
    const failingFile = new FailingMockFile("bad.jpg", "image/jpeg", 1000);
    const anotherGoodFile = createMockFile("good2.jpg", "image/jpeg", 1000);

    const formData = {
      getAll: (key: string) => (key === "images" ? [goodFile, failingFile, anotherGoodFile] : []),
      get: (key: string) => (key === "description" ? null : null),
    };

    const request = {
      formData: () => Promise.resolve(formData),
      signal: new AbortController().signal,
    } as unknown as Request;

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    // Consume stream to trigger generator
    const events = await consumeSSEStream(response);
    expect(events.some((e) => e.type === "analysis")).toBe(true);

    // Verify only successful images were passed to analyzeFood (2 images, not 3)
    expect(mockAnalyzeFood).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ mimeType: "image/jpeg" }),
        expect.objectContaining({ mimeType: "image/jpeg" }),
      ]),
      undefined,
      "user-uuid-123",
      expect.any(String),
      expect.any(Object),
      expect.anything(),
    );
    expect(mockAnalyzeFood.mock.calls[0][0]).toHaveLength(2);

    // Verify a warning was logged for the failed image
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "analyze_food_image_processing" }),
      expect.stringContaining("Failed to process image")
    );
  });

  it("passes clientDate from FormData to analyzeFood", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "analysis", analysis: validAnalysis } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const request = createMockRequest(
      [createMockFile("test.jpg", "image/jpeg", 1000)],
      "Test food",
      "2026-02-15"
    );

    await POST(request);

    expect(mockAnalyzeFood).toHaveBeenCalledWith(
      expect.any(Array),
      "Test food",
      "user-uuid-123",
      "2026-02-15",
      expect.any(Object),
      expect.anything(),
    );
  });

  it("passes request signal to analyzeFood generator", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const abortController = new AbortController();
    mockAnalyzeFood.mockImplementation(async function* () {
      yield { type: "done" } as StreamEvent;
    });

    const formData = {
      getAll: (key: string) => (key === "images" ? [createMockFile("test.jpg", "image/jpeg", 1000)] : []),
      get: () => null,
    };
    const request = {
      formData: () => Promise.resolve(formData),
      signal: abortController.signal,
    } as unknown as Request;

    const response = await POST(request);
    await consumeSSEStream(response);

    expect(mockAnalyzeFood).toHaveBeenCalledWith(
      expect.any(Array),
      undefined,
      "user-uuid-123",
      expect.any(String),
      expect.any(Object),
      abortController.signal,
    );
  });
});
