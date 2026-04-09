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

const mockCheckRateLimit = vi.fn().mockReturnValue({ allowed: true, remaining: 9 });
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

const { mockTriageCaptures } = vi.hoisted(() => ({
  mockTriageCaptures: vi.fn(),
}));
vi.mock("@/lib/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/claude")>();
  return {
    ...actual,
    triageCaptures: mockTriageCaptures,
  };
});

const { POST } = await import("@/app/api/process-captures/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

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

function createMockFile(name: string, type: string, sizeInBytes = 1000): MockFile {
  return new MockFile(name, type, sizeInBytes);
}

function createValidFormData(imageCount = 1, metadataOverride?: unknown) {
  const images = Array.from({ length: imageCount }, (_, i) =>
    createMockFile(`image${i}.jpg`, "image/jpeg")
  );

  const defaultMetadata = [{ captureId: "cap-1", imageCount, note: null, capturedAt: "2026-04-09T12:00:00" }];
  const metadata = metadataOverride !== undefined ? metadataOverride : defaultMetadata;

  const formData = {
    getAll: (key: string) => (key === "images" ? images : []),
    get: (key: string) => {
      if (key === "captureMetadata") return JSON.stringify(metadata);
      if (key === "clientDate") return "2026-04-09";
      return null;
    },
  };

  return { formData, images };
}

function createMockRequest(formDataObj: unknown): Request {
  return {
    formData: () => Promise.resolve(formDataObj),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 9 });
});

describe("POST /api/process-captures", () => {
  it("returns 401 without session", async () => {
    mockGetSession.mockResolvedValue(null);
    const { formData } = createValidFormData();
    const response = await POST(createMockRequest(formData));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 with no images", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const formData = {
      getAll: (key: string) => (key === "images" ? [] : []),
      get: (key: string) => {
        if (key === "captureMetadata") return JSON.stringify([]);
        if (key === "clientDate") return "2026-04-09";
        return null;
      },
    };
    const response = await POST(createMockRequest(formData));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when captureMetadata imageCount doesn't match images count", async () => {
    mockGetSession.mockResolvedValue(validSession);
    // 2 images but metadata says imageCount=1
    const images = [createMockFile("a.jpg", "image/jpeg"), createMockFile("b.jpg", "image/jpeg")];
    const metadata = [{ captureId: "cap-1", imageCount: 1, note: null, capturedAt: "2026-04-09T12:00:00" }];
    const formData = {
      getAll: (key: string) => (key === "images" ? images : []),
      get: (key: string) => {
        if (key === "captureMetadata") return JSON.stringify(metadata);
        if (key === "clientDate") return "2026-04-09";
        return null;
      },
    };
    const response = await POST(createMockRequest(formData));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with invalid captureMetadata JSON", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const images = [createMockFile("a.jpg", "image/jpeg")];
    const formData = {
      getAll: (key: string) => (key === "images" ? images : []),
      get: (key: string) => {
        if (key === "captureMetadata") return "not-valid-json";
        if (key === "clientDate") return "2026-04-09";
        return null;
      },
    };
    const response = await POST(createMockRequest(formData));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns SSE stream with valid input (mock Claude response)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockTriageCaptures.mockImplementation(async function* () {
      yield { type: "session_items", items: [] } as StreamEvent;
      yield { type: "done" } as StreamEvent;
    });

    const { formData } = createValidFormData(1);
    const response = await POST(createMockRequest(formData));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const events = await consumeSSEStream(response);
    expect(events.some((e) => e.type === "session_items")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("rate limits at 10 requests per 15 minutes", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockCheckRateLimit.mockReturnValueOnce({ allowed: false, remaining: 0 });

    const { formData } = createValidFormData();
    const response = await POST(createMockRequest(formData));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");

    // Verify rate limit is called with the right params (10 max, 15 min window)
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      expect.stringContaining("user-uuid-123"),
      10,
      15 * 60 * 1000,
    );
  });

  it("rejects invalid image type", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const images = [createMockFile("a.bmp", "image/bmp")];
    const metadata = [{ captureId: "cap-1", imageCount: 1, note: null, capturedAt: "2026-04-09T12:00:00" }];
    const formData = {
      getAll: (key: string) => (key === "images" ? images : []),
      get: (key: string) => {
        if (key === "captureMetadata") return JSON.stringify(metadata);
        if (key === "clientDate") return "2026-04-09";
        return null;
      },
    };
    const response = await POST(createMockRequest(formData));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
