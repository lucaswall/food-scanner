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

const { getIronSession } = await import("iron-session");
const { GET } = await import("@/app/api/auth/session/route");

const mockGetIronSession = vi.mocked(getIronSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/session", () => {
  it("returns session info for valid session", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "wall.lucas@gmail.com",
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
    expect(body.data.email).toBe("wall.lucas@gmail.com");
    expect(body.data.fitbitConnected).toBe(true);
  });

  it("returns 401 for expired session", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "wall.lucas@gmail.com",
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
});
