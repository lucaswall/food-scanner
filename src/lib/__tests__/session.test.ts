import { describe, it, expect, vi } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const { sessionOptions, validateSession } = await import("@/lib/session");

describe("sessionOptions", () => {
  it("has correct cookie name", () => {
    expect(sessionOptions.cookieName).toBe("food-scanner-session");
  });

  it("has httpOnly, secure, sameSite lax, 30-day maxAge", () => {
    const opts = sessionOptions.cookieOptions!;
    expect(opts.httpOnly).toBe(true);
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("reads password from SESSION_SECRET env var", () => {
    expect(sessionOptions.password).toBe(
      "a-test-secret-that-is-at-least-32-characters-long",
    );
  });
});

describe("validateSession", () => {
  it("returns error response when sessionId is missing", () => {
    const session = {} as never;
    const result = validateSession(session);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns error response when expiresAt is missing", () => {
    const session = { sessionId: "abc" } as never;
    const result = validateSession(session);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns error response when session is expired", () => {
    const session = {
      sessionId: "abc",
      expiresAt: Date.now() - 1000,
    } as never;
    const result = validateSession(session);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns error response when fitbit is missing and requireFitbit is true", () => {
    const session = {
      sessionId: "abc",
      expiresAt: Date.now() + 60000,
    } as never;
    const result = validateSession(session, { requireFitbit: true });
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
  });

  it("returns null when session is valid without fitbit requirement", () => {
    const session = {
      sessionId: "abc",
      expiresAt: Date.now() + 60000,
    } as never;
    const result = validateSession(session);
    expect(result).toBeNull();
  });

  it("returns null when session is valid with fitbit connected", () => {
    const session = {
      sessionId: "abc",
      expiresAt: Date.now() + 60000,
      fitbit: {
        accessToken: "token",
        refreshToken: "refresh",
        userId: "uid",
        expiresAt: Date.now() + 60000,
      },
    } as never;
    const result = validateSession(session, { requireFitbit: true });
    expect(result).toBeNull();
  });
});
