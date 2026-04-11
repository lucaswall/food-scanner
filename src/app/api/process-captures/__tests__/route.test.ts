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

  // FOO-919: per-entry field validation
  it("returns 400 when captureId is not a string", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const images = [createMockFile("a.jpg", "image/jpeg")];
    const metadata = [{ captureId: 42, imageCount: 1, note: null, capturedAt: "2026-04-09T12:00:00" }];
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

  it("returns 400 when imageCount is not a non-negative integer", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const images = [createMockFile("a.jpg", "image/jpeg")];
    const metadata = [{ captureId: "cap-1", imageCount: "one", note: null, capturedAt: "2026-04-09T12:00:00" }];
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

  it("returns 400 when imageCount is zero", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const images = [createMockFile("a.jpg", "image/jpeg")];
    const metadata = [{ captureId: "cap-1", imageCount: 0, note: null, capturedAt: "2026-04-09T12:00:00" }];
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

  it("returns 400 when capturedAt exceeds 30 characters", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const images = [createMockFile("a.jpg", "image/jpeg")];
    const longDate = "2026-04-09T12:00:00.000Z-this-is-way-too-long";
    const metadata = [{ captureId: "cap-1", imageCount: 1, note: null, capturedAt: longDate }];
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

  it("returns 400 when note exceeds 500 characters", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const images = [createMockFile("a.jpg", "image/jpeg")];
    const longNote = "x".repeat(501);
    const metadata = [{ captureId: "cap-1", imageCount: 1, note: longNote, capturedAt: "2026-04-09T12:00:00" }];
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

  it("returns 400 when note is not a string or null", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const images = [createMockFile("a.jpg", "image/jpeg")];
    const metadata = [{ captureId: "cap-1", imageCount: 1, note: 123, capturedAt: "2026-04-09T12:00:00" }];
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

  it("returns 400 when captureMetadata array contains null element", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const images = [createMockFile("a.jpg", "image/jpeg")];
    const metadata = [null];
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
    expect(body.error.message).toContain("captureMetadata[0]");
  });

  it("filters out captures with empty imageIndices when all their images fail", async () => {
    mockGetSession.mockResolvedValue(validSession);

    // 2 captures: capture A (1 image, fails), capture B (1 image, succeeds)
    const failingFile = {
      name: "fail.jpg",
      type: "image/jpeg",
      size: 1000,
      arrayBuffer: () => Promise.reject(new Error("disk error")),
    };
    const images = [failingFile, createMockFile("b.jpg", "image/jpeg")];
    const metadata = [
      { captureId: "cap-a", imageCount: 1, note: null, capturedAt: "2026-04-09T12:00:00" },
      { captureId: "cap-b", imageCount: 1, note: null, capturedAt: "2026-04-09T13:00:00" },
    ];

    let capturedMetadata: unknown;
    mockTriageCaptures.mockImplementation(async function* (
      _imageInputs: unknown,
      meta: unknown,
    ) {
      capturedMetadata = meta;
      yield { type: "session_items", items: [] };
      yield { type: "done" };
    });

    const formData = {
      getAll: (key: string) => (key === "images" ? images : []),
      get: (key: string) => {
        if (key === "captureMetadata") return JSON.stringify(metadata);
        if (key === "clientDate") return "2026-04-09";
        return null;
      },
    };

    const response = await POST(createMockRequest(formData));
    expect(response.status).toBe(200);
    await consumeSSEStream(response);

    // capture A should be filtered out (all images failed, empty imageIndices)
    const meta = capturedMetadata as Array<{ captureId: string; imageIndices: number[] }>;
    expect(meta).toHaveLength(1);
    expect(meta[0].captureId).toBe("cap-b");
    expect(meta[0].imageIndices).toEqual([0]);
  });

  // FOO-920: image index remapping when images fail allSettled
  it("remaps imageIndices correctly when one image fails processing", async () => {
    mockGetSession.mockResolvedValue(validSession);

    // 3 images total: capture A (2 images), capture B (1 image)
    // Image at index 1 fails arrayBuffer
    const failingFile = {
      name: "fail.jpg",
      type: "image/jpeg",
      size: 1000,
      arrayBuffer: () => Promise.reject(new Error("disk error")),
    };
    const images = [
      createMockFile("a.jpg", "image/jpeg"),
      failingFile,
      createMockFile("c.jpg", "image/jpeg"),
    ];

    const metadata = [
      { captureId: "cap-a", imageCount: 2, note: null, capturedAt: "2026-04-09T12:00:00" },
      { captureId: "cap-b", imageCount: 1, note: null, capturedAt: "2026-04-09T13:00:00" },
    ];

    let capturedMetadata: unknown;
    mockTriageCaptures.mockImplementation(async function* (
      _imageInputs: unknown,
      meta: unknown,
    ) {
      capturedMetadata = meta;
      yield { type: "session_items", items: [] };
      yield { type: "done" };
    });

    const formData = {
      getAll: (key: string) => (key === "images" ? images : []),
      get: (key: string) => {
        if (key === "captureMetadata") return JSON.stringify(metadata);
        if (key === "clientDate") return "2026-04-09";
        return null;
      },
    };

    const response = await POST(createMockRequest(formData));
    expect(response.status).toBe(200);
    await consumeSSEStream(response);

    // capture A: originally had images 0 and 1 — image 1 failed, so only index 0 survives
    // capture B: originally had image 2 — maps to compressed index 1
    const meta = capturedMetadata as Array<{ captureId: string; imageIndices: number[] }>;
    expect(meta[0].captureId).toBe("cap-a");
    expect(meta[0].imageIndices).toEqual([0]);
    expect(meta[1].captureId).toBe("cap-b");
    expect(meta[1].imageIndices).toEqual([1]);
  });
});
