import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

// Mock session module — getRawSession returns mutable iron-session object
const mockRawSession = {
  save: vi.fn(),
  destroy: vi.fn(),
} as Record<string, unknown>;

vi.mock("@/lib/session", () => ({
  getRawSession: vi.fn().mockResolvedValue(mockRawSession),
  sessionOptions: {
    password: "a-test-secret-that-is-at-least-32-characters-long",
    cookieName: "food-scanner-session",
    cookieOptions: { httpOnly: true, secure: true, sameSite: "lax", maxAge: 2592000, path: "/" },
  },
}));

// Mock session-db
const mockCreateSession = vi.fn();
vi.mock("@/lib/session-db", () => ({
  createSession: mockCreateSession,
}));

// Mock users module
const mockGetOrCreateUser = vi.fn();
vi.mock("@/lib/users", () => ({
  getOrCreateUser: mockGetOrCreateUser,
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const { POST } = await import("@/app/api/auth/test-login/route");
const { logger } = await import("@/lib/logger");

const fakeUser = { id: "user-uuid-123", email: "test@example.com", name: "Test User" };

beforeEach(() => {
  vi.clearAllMocks();
  Object.keys(mockRawSession).forEach((key) => {
    if (key !== "save" && key !== "destroy") delete mockRawSession[key];
  });
  mockRawSession.save = vi.fn();
  mockRawSession.destroy = vi.fn();
  mockCreateSession.mockResolvedValue("new-session-uuid");
  mockGetOrCreateUser.mockResolvedValue(fakeUser);
});

describe("POST /api/auth/test-login", () => {
  it("returns 404 when ENABLE_TEST_AUTH is not set", async () => {
    vi.stubEnv("ENABLE_TEST_AUTH", "");

    const response = await POST();
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when ENABLE_TEST_AUTH is 'false'", async () => {
    vi.stubEnv("ENABLE_TEST_AUTH", "false");

    const response = await POST();
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("creates user record and DB session when ENABLE_TEST_AUTH is 'true'", async () => {
    vi.stubEnv("ENABLE_TEST_AUTH", "true");

    const response = await POST();
    expect(response.status).toBe(200);
    expect(mockGetOrCreateUser).toHaveBeenCalledWith("test@example.com", "Test User");
    expect(mockCreateSession).toHaveBeenCalledWith("user-uuid-123");
    expect(mockRawSession.sessionId).toBe("new-session-uuid");
    expect(mockRawSession.save).toHaveBeenCalled();
  });

  it("returns 200 with user info when successful", async () => {
    vi.stubEnv("ENABLE_TEST_AUTH", "true");

    const response = await POST();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      userId: "user-uuid-123",
      email: "test@example.com",
    });
  });

  it("returns 500 when getOrCreateUser throws", async () => {
    vi.stubEnv("ENABLE_TEST_AUTH", "true");
    mockGetOrCreateUser.mockRejectedValue(new Error("Database error"));

    const response = await POST();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns 500 when createSession throws", async () => {
    vi.stubEnv("ENABLE_TEST_AUTH", "true");
    mockCreateSession.mockRejectedValue(new Error("Session creation failed"));

    const response = await POST();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("logs error when user creation fails", async () => {
    vi.stubEnv("ENABLE_TEST_AUTH", "true");
    mockGetOrCreateUser.mockRejectedValue(new Error("User creation failed"));

    await POST();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "test_login_error",
        error: "User creation failed",
      }),
      expect.any(String),
    );
  });

  it("logs error when session creation fails", async () => {
    vi.stubEnv("ENABLE_TEST_AUTH", "true");
    mockCreateSession.mockRejectedValue(new Error("Session creation failed"));

    await POST();

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "test_login_error",
        error: "Session creation failed",
      }),
      expect.any(String),
    );
  });
});
