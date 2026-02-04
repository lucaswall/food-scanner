import { describe, it, expect, vi } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const { sessionOptions } = await import("@/lib/session");

describe("sessionOptions", () => {
  it("has correct cookie name", () => {
    expect(sessionOptions.cookieName).toBe("food-scanner-session");
  });

  it("has httpOnly, secure, sameSite strict, 30-day maxAge", () => {
    const opts = sessionOptions.cookieOptions!;
    expect(opts.httpOnly).toBe(true);
    expect(opts.secure).toBe(true);
    expect(opts.sameSite).toBe("strict");
    expect(opts.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("reads password from SESSION_SECRET env var", () => {
    expect(sessionOptions.password).toBe(
      "a-test-secret-that-is-at-least-32-characters-long",
    );
  });
});
