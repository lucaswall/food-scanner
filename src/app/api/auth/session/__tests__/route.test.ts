import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

// Mock iron-session (used internally by getSession)
vi.mock("iron-session", () => ({
  getIronSession: vi.fn(),
}));

// Mock next/headers (used by getSession)
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const { getIronSession } = await import("iron-session");
const { GET } = await import("@/app/api/auth/session/route");
const { logger } = await import("@/lib/logger");

const mockGetIronSession = vi.mocked(getIronSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/session", () => {
  it("returns session info for valid session", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      fitbit: {
        accessToken: "token",
        refreshToken: "refresh",
        userId: "user-123",
        expiresAt: Date.now() + 28800000,
      },
    } as never);

    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.email).toBe("test@example.com");
    expect(body.data.fitbitConnected).toBe(true);
  });

  it("returns 401 for expired session", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      createdAt: Date.now() - 86400000 * 31,
      expiresAt: Date.now() - 1000,
    } as never);

    const response = await GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_SESSION_EXPIRED");
  });

  it("returns 401 for missing session", async () => {
    mockGetIronSession.mockResolvedValue({} as never);

    const response = await GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  // Logging tests
  it("logs debug on session check", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      createdAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    } as never);

    await GET();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: "session_check" }),
      expect.any(String),
    );
  });

  it("logs warn on missing session", async () => {
    mockGetIronSession.mockResolvedValue({} as never);

    await GET();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "session_invalid",
        reason: "missing",
      }),
      expect.any(String),
    );
  });

  it("logs warn on expired session", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      createdAt: Date.now() - 86400000 * 31,
      expiresAt: Date.now() - 1000,
    } as never);

    await GET();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "session_invalid",
        reason: "expired",
      }),
      expect.any(String),
    );
  });
});
