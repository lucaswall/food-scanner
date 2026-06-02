import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("APP_URL", "http://localhost:3000");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");

// Mock session module
const mockRawSession = {
  save: vi.fn(),
  destroy: vi.fn(),
} as Record<string, unknown>;

const mockGetSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (session: FullSession | null): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: 0 },
        { status: 401 },
      );
    }
    return null;
  },
  getRawSession: vi.fn().mockResolvedValue(mockRawSession),
}));

// Mock auth module
const mockBuildGoogleHealthAuthUrl = vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?sentinel=health-connect");

vi.mock("@/lib/auth", () => ({
  buildGoogleHealthAuthUrl: (...args: unknown[]) => mockBuildGoogleHealthAuthUrl(...args),
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

const { GET, POST } = await import("@/app/api/auth/google-health/route");

const validSession: FullSession = {
  sessionId: "test-session-id",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  healthConnected: false,
  destroy: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockRawSession).forEach((key) => {
    if (key !== "save" && key !== "destroy") delete mockRawSession[key];
  });
  mockRawSession.save = vi.fn();
  mockRawSession.destroy = vi.fn();
  mockBuildGoogleHealthAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?sentinel=health-connect");
});

function makeRequest(method = "POST") {
  return new Request("http://localhost:3000/api/auth/google-health", { method });
}

describe("POST /api/auth/google-health", () => {
  it("returns 401 when no session", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await POST(makeRequest("POST"));
    expect(response.status).toBe(401);
  });

  it("does not redirect when no session", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await POST(makeRequest("POST"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("returns 302 redirect to auth URL when session exists", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const response = await POST(makeRequest("POST"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?sentinel=health-connect",
    );
  });

  it("stores oauthState as JSON with flow='health-connect' and a nonce", async () => {
    mockGetSession.mockResolvedValue(validSession);

    await POST(makeRequest("POST"));

    expect(typeof mockRawSession.oauthState).toBe("string");
    const parsed = JSON.parse(mockRawSession.oauthState as string);
    expect(parsed.flow).toBe("health-connect");
    expect(typeof parsed.nonce).toBe("string");
    expect(parsed.nonce.length).toBeGreaterThan(0);
  });

  it("calls rawSession.save() after setting oauthState", async () => {
    mockGetSession.mockResolvedValue(validSession);

    await POST(makeRequest("POST"));

    expect(mockRawSession.save).toHaveBeenCalled();
  });

  it("calls buildGoogleHealthAuthUrl with redirectUri ending in /api/auth/google/callback", async () => {
    mockGetSession.mockResolvedValue(validSession);

    await POST(makeRequest("POST"));

    expect(mockBuildGoogleHealthAuthUrl).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("/api/auth/google/callback"),
    );
  });

  it("stores userId from the current session in the oauthState JSON", async () => {
    mockGetSession.mockResolvedValue(validSession); // validSession.userId = "user-uuid-123"

    await POST(makeRequest("POST"));

    const parsed = JSON.parse(mockRawSession.oauthState as string);
    expect(parsed.userId).toBe("user-uuid-123");
  });
});

describe("GET /api/auth/google-health", () => {
  it("returns 401 when no session", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET(makeRequest("GET"));
    expect(response.status).toBe(401);
  });

  it("returns 302 redirect to auth URL when session exists", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const response = await GET(makeRequest("GET"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?sentinel=health-connect",
    );
  });

  it("stores oauthState as JSON with flow='health-connect' and a nonce", async () => {
    mockGetSession.mockResolvedValue(validSession);

    await GET(makeRequest("GET"));

    expect(typeof mockRawSession.oauthState).toBe("string");
    const parsed = JSON.parse(mockRawSession.oauthState as string);
    expect(parsed.flow).toBe("health-connect");
    expect(typeof parsed.nonce).toBe("string");
  });

  it("calls buildGoogleHealthAuthUrl with redirectUri ending in /api/auth/google/callback", async () => {
    mockGetSession.mockResolvedValue(validSession);

    await GET(makeRequest("GET"));

    expect(mockBuildGoogleHealthAuthUrl).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining("/api/auth/google/callback"),
    );
  });

  it("stores userId from the current session in the oauthState JSON", async () => {
    mockGetSession.mockResolvedValue(validSession);

    await GET(makeRequest("GET"));

    const parsed = JSON.parse(mockRawSession.oauthState as string);
    expect(parsed.userId).toBe("user-uuid-123");
  });
});
