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

const mockHasFitbitCredentials = vi.fn();
vi.mock("@/lib/fitbit-credentials", () => ({
  hasFitbitCredentials: (...args: unknown[]) => mockHasFitbitCredentials(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteSession.mockResolvedValue(undefined);
  mockTouchSession.mockResolvedValue(undefined);
  mockGetFitbitTokens.mockResolvedValue(null);
  mockHasFitbitCredentials.mockResolvedValue(false);
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

  it("returns full session with userId when cookie and DB session exist", async () => {
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
    mockGetFitbitTokens.mockResolvedValue(null);

    const result = await getSession();

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe("abc-123");
    expect(result!.userId).toBe("user-uuid-123");
    expect(result!.fitbitConnected).toBe(false);
    expect(result!.hasFitbitCredentials).toBe(false);
    expect(typeof result!.expiresAt).toBe("number");
    expect(mockGetFitbitTokens).toHaveBeenCalledWith("user-uuid-123");
    expect(mockHasFitbitCredentials).toHaveBeenCalledWith("user-uuid-123");
  });

  it("sets hasFitbitCredentials to true when credentials exist", async () => {
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
    mockGetFitbitTokens.mockResolvedValue(null);
    mockHasFitbitCredentials.mockResolvedValue(true);

    const result = await getSession();

    expect(result!.hasFitbitCredentials).toBe(true);
  });

  it("sets fitbitConnected to true when Fitbit tokens exist", async () => {
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
    // Session expires in 20 days — that's less than 29 days, so it should be touched
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
    // Session expires in 29.5 days — recently touched, no need to extend
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

    // Reset the internal counter by calling with a successful touch first
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
    // Wait for the fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 10));
    vi.clearAllMocks();

    // Now trigger 3 consecutive failures (threshold)
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

    // First two failures should log at warn, third at error
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

    // Trigger 2 failures
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

    // Now succeed — should reset counter
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
    mockGetFitbitTokens.mockResolvedValue(null);
    await getSession();
    await new Promise((r) => setTimeout(r, 10));

    // Now trigger 2 more failures — should be back to warn (counter was reset)
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

    // Should only see warn, no error (counter was reset by success)
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
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
      userId: "user-uuid-123",
      expiresAt: Date.now() + 60000,
      fitbitConnected: false,
      hasFitbitCredentials: false,
      destroy: vi.fn(),
    };
    const result = validateSession(session, { requireFitbit: true });
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
  });

  it("returns null when session is valid without fitbit requirement", () => {
    const session = {
      sessionId: "abc",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 60000,
      fitbitConnected: false,
      hasFitbitCredentials: false,
      destroy: vi.fn(),
    };
    const result = validateSession(session);
    expect(result).toBeNull();
  });

  it("returns null when session is valid with fitbit connected", () => {
    const session = {
      sessionId: "abc",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 60000,
      fitbitConnected: true,
      hasFitbitCredentials: true,
      destroy: vi.fn(),
    };
    const result = validateSession(session, { requireFitbit: true });
    expect(result).toBeNull();
  });

  it("returns FITBIT_CREDENTIALS_MISSING when fitbit connected but no credentials", async () => {
    const session = {
      sessionId: "abc",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 60000,
      fitbitConnected: true,
      hasFitbitCredentials: false,
      destroy: vi.fn(),
    };
    const result = validateSession(session, { requireFitbit: true });
    expect(result).not.toBeNull();
    expect(result!.status).toBe(400);
    const body = await result!.json();
    expect(body.error.code).toBe("FITBIT_CREDENTIALS_MISSING");
  });
});
