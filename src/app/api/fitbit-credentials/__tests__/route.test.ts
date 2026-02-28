import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

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

const mockGetFitbitCredentials = vi.fn();
const mockSaveFitbitCredentials = vi.fn();
const mockUpdateFitbitClientId = vi.fn();
const mockReplaceFitbitClientSecret = vi.fn();

vi.mock("@/lib/fitbit-credentials", () => ({
  getFitbitCredentials: (...args: unknown[]) => mockGetFitbitCredentials(...args),
  saveFitbitCredentials: (...args: unknown[]) => mockSaveFitbitCredentials(...args),
  updateFitbitClientId: (...args: unknown[]) => mockUpdateFitbitClientId(...args),
  replaceFitbitClientSecret: (...args: unknown[]) => mockReplaceFitbitClientSecret(...args),
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const { GET, POST, PATCH } = await import("@/app/api/fitbit-credentials/route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/fitbit-credentials", () => {
  it("returns credentials data when credentials exist", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client-id-123",
      clientSecret: "test-client-secret-456",
    });

    const response = await GET(new Request("http://localhost/api/fitbit-credentials"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.hasCredentials).toBe(true);
    expect(body.data.clientId).toBe("test-client-id-123");
    expect(body.data.clientSecret).toBeUndefined(); // never return secret
  });

  it("returns hasCredentials false when no credentials exist", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    mockGetFitbitCredentials.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/fitbit-credentials"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.hasCredentials).toBe(false);
    expect(body.data.clientId).toBeUndefined();
  });

  it("returns 401 when no session", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/fitbit-credentials"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("sets Cache-Control header to private no-cache", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    mockGetFitbitCredentials.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/fitbit-credentials"));
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns ETag header on success response", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });
    mockGetFitbitCredentials.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/fitbit-credentials"));

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });
    mockGetFitbitCredentials.mockResolvedValue(null);

    const response1 = await GET(new Request("http://localhost/api/fitbit-credentials"));
    const etag = response1.headers.get("ETag")!;

    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });
    mockGetFitbitCredentials.mockResolvedValue(null);

    const response2 = await GET(new Request("http://localhost/api/fitbit-credentials", {
      headers: { "if-none-match": etag },
    }));

    expect(response2.status).toBe(304);
    expect(response2.headers.get("ETag")).toBe(etag);
    expect(response2.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});

describe("POST /api/fitbit-credentials", () => {
  it("saves credentials and returns success", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    mockSaveFitbitCredentials.mockResolvedValue(undefined);

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "new-client-id",
        clientSecret: "new-client-secret",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(mockSaveFitbitCredentials).toHaveBeenCalledWith(
      "user-uuid-123",
      "new-client-id",
      "new-client-secret",
      expect.anything(),
    );
  });

  it("returns 400 for missing clientId", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientSecret: "new-client-secret",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for missing clientSecret", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "new-client-id",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for empty clientId", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "",
        clientSecret: "new-client-secret",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for empty clientSecret", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "new-client-id",
        clientSecret: "",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 when no session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "new-client-id",
        clientSecret: "new-client-secret",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 for invalid JSON", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "invalid json{",
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("PATCH /api/fitbit-credentials", () => {
  it("updates client ID when only clientId provided", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "old-client-id",
      clientSecret: "old-secret",
    });
    mockUpdateFitbitClientId.mockResolvedValue(undefined);

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "updated-client-id",
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(mockUpdateFitbitClientId).toHaveBeenCalledWith("user-uuid-123", "updated-client-id", expect.anything());
    expect(mockReplaceFitbitClientSecret).not.toHaveBeenCalled();
  });

  it("replaces client secret when only clientSecret provided", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "old-client-id",
      clientSecret: "old-secret",
    });
    mockReplaceFitbitClientSecret.mockResolvedValue(undefined);

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientSecret: "new-secret",
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(mockReplaceFitbitClientSecret).toHaveBeenCalledWith("user-uuid-123", "new-secret", expect.anything());
    expect(mockUpdateFitbitClientId).not.toHaveBeenCalled();
  });

  it("updates both when both provided", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "old-client-id",
      clientSecret: "old-secret",
    });
    mockUpdateFitbitClientId.mockResolvedValue(undefined);
    mockReplaceFitbitClientSecret.mockResolvedValue(undefined);

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "updated-client-id",
        clientSecret: "new-secret",
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(mockUpdateFitbitClientId).toHaveBeenCalledWith("user-uuid-123", "updated-client-id", expect.anything());
    expect(mockReplaceFitbitClientSecret).toHaveBeenCalledWith("user-uuid-123", "new-secret", expect.anything());
  });

  it("returns 400 when neither provided", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when no existing credentials to update (clientId)", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    mockGetFitbitCredentials.mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "updated-client-id",
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when no existing credentials to update (clientSecret)", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    mockGetFitbitCredentials.mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientSecret: "new-secret",
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 401 when no session", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "updated-client-id",
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 for empty clientId", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "",
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for empty clientSecret", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: true,
      destroy: vi.fn(),
    });

    const request = new Request("http://localhost:3000/api/fitbit-credentials", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientSecret: "",
      }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
