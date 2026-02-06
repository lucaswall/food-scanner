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
const { POST } = await import("@/app/api/auth/logout/route");
const { logger } = await import("@/lib/logger");

const mockGetIronSession = vi.mocked(getIronSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/logout", () => {
  it("destroys session and returns success", async () => {
    const destroyFn = vi.fn();
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      destroy: destroyFn,
    } as never);

    const response = await POST();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(destroyFn).toHaveBeenCalled();
  });

  it("logs info on logout", async () => {
    const destroyFn = vi.fn();
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      destroy: destroyFn,
    } as never);

    await POST();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "logout" }),
      expect.any(String),
    );
  });
});
