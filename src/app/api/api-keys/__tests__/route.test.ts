import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (
    session: FullSession | null,
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

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockCreateApiKey = vi.fn();
const mockListApiKeys = vi.fn();
vi.mock("@/lib/api-keys", () => ({
  createApiKey: (...args: unknown[]) => mockCreateApiKey(...args),
  listApiKeys: (...args: unknown[]) => mockListApiKeys(...args),
}));

const { GET, POST } = await import("@/app/api/api-keys/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/api-keys", () => {
  function createRequest(body: unknown): Request {
    return new Request("http://localhost:3000/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("creates an API key and returns metadata including rawKey", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockCreateApiKey.mockResolvedValue({
      id: 1,
      name: "My Script",
      rawKey: "fsk_abc123def456",
      keyPrefix: "abc12345",
      createdAt: new Date("2026-01-15T10:00:00Z"),
    });

    const request = createRequest({ name: "My Script" });
    const response = await POST(request);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      id: 1,
      name: "My Script",
      rawKey: "fsk_abc123def456",
      keyPrefix: "abc12345",
      createdAt: "2026-01-15T10:00:00.000Z",
    });
    expect(mockCreateApiKey).toHaveBeenCalledWith("user-uuid-123", "My Script");
  });

  it("returns 400 VALIDATION_ERROR when name is missing", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createRequest({});
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("name");
  });

  it("returns 400 VALIDATION_ERROR when name is empty string", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createRequest({ name: "" });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR when name is not a string", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createRequest({ name: 123 });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 when session is missing", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createRequest({ name: "My Script" });
    const response = await POST(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 when JSON body is invalid", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = new Request("http://localhost:3000/api/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json",
    });
    const response = await POST(request);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 INTERNAL_ERROR when createApiKey throws (FOO-421)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockCreateApiKey.mockRejectedValue(new Error("Database connection error"));

    const request = createRequest({ name: "My Script" });
    const response = await POST(request);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});

describe("GET /api/api-keys", () => {
  it("returns array of API keys", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockListApiKeys.mockResolvedValue([
      {
        id: 1,
        name: "Script 1",
        keyPrefix: "abc12345",
        createdAt: new Date("2026-01-15T10:00:00Z"),
        lastUsedAt: null,
      },
      {
        id: 2,
        name: "Script 2",
        keyPrefix: "def67890",
        createdAt: new Date("2026-01-16T11:00:00Z"),
        lastUsedAt: new Date("2026-01-17T12:00:00Z"),
      },
    ]);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.keys).toHaveLength(2);
    expect(body.data.keys[0]).toMatchObject({
      id: 1,
      name: "Script 1",
      keyPrefix: "abc12345",
    });
    expect(body.data.keys[0]).not.toHaveProperty("keyHash");
    expect(mockListApiKeys).toHaveBeenCalledWith("user-uuid-123");
  });

  it("returns empty array when no keys exist", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockListApiKeys.mockResolvedValue([]);

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.keys).toEqual([]);
  });

  it("returns 401 when session is missing", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 500 INTERNAL_ERROR when listApiKeys throws (FOO-421)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockListApiKeys.mockRejectedValue(new Error("Database connection error"));

    const response = await GET();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
