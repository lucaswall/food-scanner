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

const mockGetHealthTokens = vi.fn();
vi.mock("@/lib/health-tokens", () => ({
  getHealthTokens: (...args: unknown[]) => mockGetHealthTokens(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteSession.mockResolvedValue(undefined);
  mockTouchSession.mockResolvedValue(undefined);
  mockGetHealthTokens.mockResolvedValue(null);
});

const { getSession, getRawSession, validateSession } = await import(
  "@/lib/session"
);

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

  it("returns full session with healthConnected=false when no health tokens exist", async () => {
    const mockDestroy = vi.fn();
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: mockDestroy,
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      userId: "user-uuid-123",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });
    mockGetHealthTokens.mockResolvedValue(null);

    const result = await getSession();

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("abc-123");
    expect(result!.userId).toBe("user-uuid-123");
    expect(result!.healthConnected).toBe(false);
    expect(typeof result!.expiresAt).toBe("number");
    expect(mockGetHealthTokens).toHaveBeenCalledWith("user-uuid-123");
  });

  it("does not expose legacy fitbit session keys", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: vi.fn(),
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      userId: "user-uuid-123",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const result = await getSession();

    expect(result).not.toHaveProperty("fitbitConnected");
    expect(result).not.toHaveProperty("hasFitbitCredentials");
  });

  it("sets healthConnected to true when health tokens exist", async () => {
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: vi.fn(),
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      userId: "user-uuid-123",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });
    mockGetHealthTokens.mockResolvedValue({
      accessToken: "tok",
      refreshToken: "ref",
      healthUserId: "uid",
      expiresAt: new Date(Date.now() + 86400000),
    });

    const result = await getSession();

    expect(result!.healthConnected).toBe(true);
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
      userId: "user-uuid-123",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const result = await getSession();
    await result!.destroy();

    expect(mockDeleteSession).toHaveBeenCalledWith("abc-123");
    expect(mockCookieDestroy).toHaveBeenCalled();
  });

  it("calls touchSession when expiresAt is less than 29 days from now", async () => {
    const twentyDaysMs = 20 * 24 * 60 * 60 * 1000;
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: vi.fn(),
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      userId: "user-uuid-123",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + twentyDaysMs),
    });

    await getSession();

    expect(mockTouchSession).toHaveBeenCalledWith("abc-123");
  });

  it("does NOT call touchSession when expiresAt is more than 29 days from now", async () => {
    const twentyNineAndHalfDaysMs = 29.5 * 24 * 60 * 60 * 1000;
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: vi.fn(),
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      userId: "user-uuid-123",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + twentyNineAndHalfDaysMs),
    });

    await getSession();

    expect(mockTouchSession).not.toHaveBeenCalled();
  });

  it("escalates touchSession failures from warn to error after threshold", async () => {
    const { logger } = await import("@/lib/logger");
    const twentyDaysMs = 20 * 24 * 60 * 60 * 1000;

    mockTouchSession.mockResolvedValueOnce(undefined);
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: vi.fn(),
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      userId: "user-uuid-123",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + twentyDaysMs),
    });
    await getSession();
    await new Promise((r) => setTimeout(r, 10));
    vi.clearAllMocks();

    const dbError = new Error("DB connection lost");
    mockTouchSession.mockRejectedValue(dbError);

    for (let i = 0; i < 3; i++) {
      mockGetIronSession.mockResolvedValue({
        sessionId: "abc-123",
        save: vi.fn(),
        destroy: vi.fn(),
      });
      mockGetSessionById.mockResolvedValue({
        id: "abc-123",
        userId: "user-uuid-123",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + twentyDaysMs),
      });
      await getSession();
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "touch_session_error", consecutiveFailures: 3 }),
      "persistent session touch failures detected",
    );
  });

  it("resets failure counter on successful touchSession", async () => {
    const { logger } = await import("@/lib/logger");
    const twentyDaysMs = 20 * 24 * 60 * 60 * 1000;
    const dbError = new Error("DB connection lost");

    mockTouchSession.mockRejectedValue(dbError);
    for (let i = 0; i < 2; i++) {
      mockGetIronSession.mockResolvedValue({
        sessionId: "abc-123",
        save: vi.fn(),
        destroy: vi.fn(),
      });
      mockGetSessionById.mockResolvedValue({
        id: "abc-123",
        userId: "user-uuid-123",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + twentyDaysMs),
      });
      await getSession();
      await new Promise((r) => setTimeout(r, 10));
    }

    vi.clearAllMocks();
    mockTouchSession.mockResolvedValue(undefined);
    mockGetIronSession.mockResolvedValue({
      sessionId: "abc-123",
      save: vi.fn(),
      destroy: vi.fn(),
    });
    mockGetSessionById.mockResolvedValue({
      id: "abc-123",
      userId: "user-uuid-123",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + twentyDaysMs),
    });
    mockGetHealthTokens.mockResolvedValue(null);
    await getSession();
    await new Promise((r) => setTimeout(r, 10));

    vi.clearAllMocks();
    mockTouchSession.mockRejectedValue(dbError);
    for (let i = 0; i < 2; i++) {
      mockGetIronSession.mockResolvedValue({
        sessionId: "abc-123",
        save: vi.fn(),
        destroy: vi.fn(),
      });
      mockGetSessionById.mockResolvedValue({
        id: "abc-123",
        userId: "user-uuid-123",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + twentyDaysMs),
      });
      await getSession();
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("validateSession", () => {
  const baseSession = {
    sessionId: "abc",
    userId: "user-uuid-123",
    expiresAt: Date.now() + 60000,
    destroy: vi.fn(),
  };

  it("returns error response when session is null", () => {
    const result = validateSession(null);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("returns HEALTH_NOT_CONNECTED (400) when health is not connected and requireHealth is true", async () => {
    const session = { ...baseSession, healthConnected: false };
    const result = validateSession(session, { requireHealth: true });
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    const body = await result!.json();
    expect(body.error.code).toBe("HEALTH_NOT_CONNECTED");
  });

  it("returns null when session is valid without health requirement", () => {
    const session = { ...baseSession, healthConnected: false };
    const result = validateSession(session);
    expect(result).toBeNull();
  });

  it("returns null when session is valid with health connected", () => {
    const session = { ...baseSession, healthConnected: true };
    const result = validateSession(session, { requireHealth: true });
    expect(result).toBeNull();
  });
});
