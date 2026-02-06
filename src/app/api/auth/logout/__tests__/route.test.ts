import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
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

const { POST } = await import("@/app/api/auth/logout/route");
const { logger } = await import("@/lib/logger");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/logout", () => {
  it("destroys session and returns success", async () => {
    const destroyFn = vi.fn();
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: false,
      destroy: destroyFn,
    });

    const response = await POST();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(destroyFn).toHaveBeenCalled();
  });

  it("returns success even when no session exists", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await POST();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  it("logs info on logout", async () => {
    const destroyFn = vi.fn();
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      email: "test@example.com",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: false,
      destroy: destroyFn,
    });

    await POST();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "logout" }),
      expect.any(String),
    );
  });
});
