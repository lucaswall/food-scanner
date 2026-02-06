import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const mockGetIronSession = vi.fn();
vi.mock("iron-session", () => ({
  getIronSession: (...args: unknown[]) => mockGetIronSession(...args),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve({ mockCookieStore: true })),
}));

const mockGetSessionById = vi.fn();
const mockDeleteSession = vi.fn();
const mockTouchSession = vi.fn();
vi.mock("@/lib/session-db", () => ({
  getSessionById: (...args: unknown[]) => mockGetSessionById(...args),
  deleteSession: (...args: unknown[]) => mockDeleteSession(...args),
  touchSession: (...args: unknown[]) => mockTouchSession(...args),
}));

const mockGetFitbitTokens = vi.fn();
vi.mock("@/lib/fitbit-tokens", () => ({
  getFitbitTokens: (...args: unknown[]) => mockGetFitbitTokens(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteSession.mockResolvedValue(undefined);
  mockTouchSession.mockResolvedValue(undefined);
  mockGetFitbitTokens.mockResolvedValue(null);
});

const { sessionOptions, getSession, getRawSession, validateSession } = await import(
  "@/lib/session"
);

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

describe("getRawSession", () => {
  it("returns the iron-session object", async () => {
    const mockSession = { sessionId: "abc", save: vi.fn(), destroy: vi.fn() };
    mockGetIronSession.mockResolvedValue(mockSession);

    const session = await getRawSession();

    expect(session).toBe(mockSession);
    expect(mockGetIronSession).toHaveBeenCalled();
  });
});

describe("getSession", () => {
  it("returns null when cookie has no sessionId", async () => {
    mockGetIronSession.mockResolvedValue({ save: vi.fn(), destroy: vi.fn() });

    const result = await getSession();

    expect(result).toBeNull();
    expect(mockGetSessionById).not.toHaveBeenCalled();
  });

  it("returns null when DB session is not found", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: vi.fn(),
    });
    mockGetSessionById.mockResolvedValue(null);

    const result = await getSession();

    expect(result).toBeNull();
    expect(mockGetSessionById).toHaveBeenCalledWith("abc-123");
  });

  it("returns full session when cookie and DB session exist", async () => {
    const mockDestroy = vi.fn();
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: mockDestroy,
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      email: "test@example.com",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });
    mockGetFitbitTokens.mockResolvedValue(null);

    const result = await getSession();

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("abc-123");
    expect(result!.email).toBe("test@example.com");
    expect(result!.fitbitConnected).toBe(false);
    expect(typeof result!.expiresAt).toBe("number");
  });

  it("sets fitbitConnected to true when Fitbit tokens exist", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: vi.fn(),
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      email: "test@example.com",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });
    mockGetFitbitTokens.mockResolvedValue({
      accessToken: "tok",
      refreshToken: "ref",
      fitbitUserId: "uid",
      expiresAt: new Date(Date.now() + 86400000),
    });

    const result = await getSession();

    expect(result!.fitbitConnected).toBe(true);
  });

  it("destroy() clears both cookie and DB session", async () => {
    const mockCookieDestroy = vi.fn();
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: mockCookieDestroy,
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      email: "test@example.com",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const result = await getSession();
    await result!.destroy();

    expect(mockDeleteSession).toHaveBeenCalledWith("abc-123");
    expect(mockCookieDestroy).toHaveBeenCalled();
  });

  it("calls touchSession when expiresAt is less than 29 days from now", async () => {
    // Session expires in 20 days — that's less than 29 days, so it should be touched
    const twentyDaysMs = 20 * 24 * 60 * 60 * 1000;
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: vi.fn(),
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      email: "test@example.com",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + twentyDaysMs),
    });

    await getSession();

    expect(mockTouchSession).toHaveBeenCalledWith("abc-123");
  });

  it("does NOT call touchSession when expiresAt is more than 29 days from now", async () => {
    // Session expires in 29.5 days — recently touched, no need to extend
    const twentyNineAndHalfDaysMs = 29.5 * 24 * 60 * 60 * 1000;
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: vi.fn(),
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      email: "test@example.com",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + twentyNineAndHalfDaysMs),
    });

    await getSession();

    expect(mockTouchSession).not.toHaveBeenCalled();
  });
});

describe("validateSession", () => {
  it("returns error response when session is null", () => {
    const result = validateSession(null);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns error response when fitbit is not connected and requireFitbit is true", () => {
    const session = {
      sessionId: "abc",
      email: "test@example.com",
      expiresAt: Date.now() + 60000,
      fitbitConnected: false,
      destroy: vi.fn(),
    };
    const result = validateSession(session, { requireFitbit: true });
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
  });

  it("returns null when session is valid without fitbit requirement", () => {
    const session = {
      sessionId: "abc",
      email: "test@example.com",
      expiresAt: Date.now() + 60000,
      fitbitConnected: false,
      destroy: vi.fn(),
    };
    const result = validateSession(session);
    expect(result).toBeNull();
  });

  it("returns null when session is valid with fitbit connected", () => {
    const session = {
      sessionId: "abc",
      email: "test@example.com",
      expiresAt: Date.now() + 60000,
      fitbitConnected: true,
      destroy: vi.fn(),
    };
    const result = validateSession(session, { requireFitbit: true });
    expect(result).toBeNull();
  });
});
