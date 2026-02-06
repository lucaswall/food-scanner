import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
const mockGetRawSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  getRawSession: () => mockGetRawSession(),
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

  it("clears stale cookie and returns success when no DB session exists", async () => {
    mockGetSession.mockResolvedValue(null);
    const rawDestroyFn = vi.fn();
    mockGetRawSession.mockResolvedValue({ destroy: rawDestroyFn });

    const response = await POST();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(rawDestroyFn).toHaveBeenCalled();
  });

  it("logs info on logout with valid session", async () => {
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

  it("logs stale session cleanup when no DB session exists", async () => {
    mockGetSession.mockResolvedValue(null);
    mockGetRawSession.mockResolvedValue({ destroy: vi.fn() });

    await POST();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "logout", stale: true }),
      expect.any(String),
    );
  });
});
