import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, HealthConnectionStatus } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

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

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: mockLogger, createRequestLogger: vi.fn(() => mockLogger) };
});

const mockCheckHealthConnection = vi.fn();
vi.mock("@/lib/health-connection", () => ({
  checkHealthConnection: (...args: unknown[]) => mockCheckHealthConnection(...args),
}));

const { GET } = await import("@/app/api/health-status/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  healthConnected: true,
  destroy: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(validSession);
});

describe("GET /api/health-status", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns healthy status payload with Cache-Control", async () => {
    const status: HealthConnectionStatus = { status: "healthy" };
    mockCheckHealthConnection.mockResolvedValue(status);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("healthy");
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns needs_reconnect status", async () => {
    const status: HealthConnectionStatus = { status: "needs_reconnect" };
    mockCheckHealthConnection.mockResolvedValue(status);

    const response = await GET();
    const body = await response.json();
    expect(body.data.status).toBe("needs_reconnect");
  });

  it("returns scope_mismatch status with missingScopes", async () => {
    const status: HealthConnectionStatus = {
      status: "scope_mismatch",
      missingScopes: ["https://www.googleapis.com/auth/googlehealth.profile.readonly"],
    };
    mockCheckHealthConnection.mockResolvedValue(status);

    const response = await GET();
    const body = await response.json();
    expect(body.data.status).toBe("scope_mismatch");
    expect(body.data.missingScopes).toHaveLength(1);
  });

  it("returns 500 on unexpected error", async () => {
    mockCheckHealthConnection.mockRejectedValue(new Error("DB connection failed"));
    const response = await GET();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
