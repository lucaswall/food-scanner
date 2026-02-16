import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

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

const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockDelete = vi.fn();
const mockDeleteWhere = vi.fn();
const mockDeleteReturning = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
    delete: mockDelete,
  })),
}));

vi.mock("@/db/schema", () => ({
  sessions: { id: "id", userId: "user_id", createdAt: "created_at", expiresAt: "expires_at" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, _type: "eq" })),
  gt: vi.fn((col, val) => ({ col, val, _type: "gt" })),
  lt: vi.fn((col, val) => ({ col, val, _type: "lt" })),
  and: vi.fn((...args: unknown[]) => ({ args, _type: "and" })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  mockDeleteReturning.mockResolvedValue([]);
  mockDelete.mockReturnValue({ where: mockDeleteWhere });
  mockDeleteWhere.mockImplementation(() => {
    const result = Promise.resolve(undefined);
    (result as unknown as Record<string, unknown>).returning = mockDeleteReturning;
    return result;
  });
});

describe("createSession", () => {
  it("inserts a session row with userId and returns the session ID", async () => {
    const { createSession } = await import("@/lib/session-db");
    const fakeId = "550e8400-e29b-41d4-a716-446655440000";
    mockReturning.mockResolvedValue([{ id: fakeId }]);

    const id = await createSession("user-uuid-123");

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-uuid-123" }),
    );
    expect(id).toBe(fakeId);
  });
});

describe("getSessionById", () => {
  it("returns session data with userId when session exists and is not expired", async () => {
    const { getSessionById } = await import("@/lib/session-db");
    const row = {
      id: "abc-123",
      userId: "user-uuid-123",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    };
    mockWhere.mockResolvedValue([row]);

    const result = await getSessionById("abc-123");

    expect(result).toEqual(row);
  });

  it("returns null when session does not exist", async () => {
    const { getSessionById } = await import("@/lib/session-db");
    mockWhere.mockResolvedValue([]);

    const result = await getSessionById("nonexistent");

    expect(result).toBeNull();
  });
});

describe("touchSession", () => {
  it("extends expiresAt", async () => {
    const { touchSession } = await import("@/lib/session-db");
    await touchSession("abc-123");
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: expect.any(Date) }),
    );
  });
});

describe("deleteSession", () => {
  it("removes the session row", async () => {
    const { deleteSession } = await import("@/lib/session-db");
    await deleteSession("abc-123");
    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteWhere).toHaveBeenCalled();
  });
});

describe("cleanExpiredSessions", () => {
  it("deletes expired sessions and returns count", async () => {
    const { cleanExpiredSessions } = await import("@/lib/session-db");
    mockDeleteReturning.mockResolvedValue([
      { id: "expired-1" },
      { id: "expired-2" },
    ]);

    const count = await cleanExpiredSessions();

    expect(count).toBe(2);
    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteWhere).toHaveBeenCalled();
    expect(mockDeleteReturning).toHaveBeenCalledWith({ id: expect.anything() });
  });

  it("returns 0 when no expired sessions exist", async () => {
    const { cleanExpiredSessions } = await import("@/lib/session-db");
    mockDeleteReturning.mockResolvedValue([]);

    const count = await cleanExpiredSessions();

    expect(count).toBe(0);
  });
});

describe("debug logging", () => {
  let mockDebug: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const mod = await import("@/lib/logger");
    mockDebug = mod.logger.debug as unknown as ReturnType<typeof vi.fn>;
  });

  beforeEach(() => {
    mockDebug.mockClear();
  });

  it("createSession logs debug with session info", async () => {
    const { createSession } = await import("@/lib/session-db");
    mockReturning.mockResolvedValue([{ id: "abc-123-def" }]);

    await createSession("user-123");

    expect(mockDebug).toHaveBeenCalledWith(
      expect.objectContaining({ action: "create_session" }),
      expect.any(String),
    );
  });

  it("deleteSession logs debug", async () => {
    const { deleteSession } = await import("@/lib/session-db");

    await deleteSession("session-id");

    expect(mockDebug).toHaveBeenCalledWith(
      expect.objectContaining({ action: "delete_session" }),
      expect.any(String),
    );
  });
});
