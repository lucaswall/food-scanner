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
const { POST } = await import("@/app/api/auth/logout/route");

const mockGetIronSession = vi.mocked(getIronSession);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/auth/logout", () => {
  it("destroys session and returns success", async () => {
    const destroyFn = vi.fn();
    mockGetIronSession.mockResolvedValue({
      sessionId: "test-session",
      email: "wall.lucas@gmail.com",
      destroy: destroyFn,
    } as never);

    const response = await POST();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(destroyFn).toHaveBeenCalled();
  });
});
