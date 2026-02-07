import { describe, it, expect, vi, beforeEach } from "vitest";

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
const mockOnConflictDoUpdate = vi.fn();
const mockReturning = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
    select: mockSelect,
  })),
}));

vi.mock("@/db/schema", () => ({
  users: {
    id: "id",
    email: "email",
    name: "name",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, _type: "eq" })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
});

const fakeUser = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  email: "test@example.com",
  name: "Test User",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

describe("getOrCreateUser", () => {
  it("uses atomic upsert (insert with onConflictDoUpdate) instead of select-then-insert", async () => {
    const { getOrCreateUser } = await import("@/lib/users");
    mockReturning.mockResolvedValue([fakeUser]);

    const result = await getOrCreateUser("test@example.com", "Test User");

    expect(result).toEqual({
      id: fakeUser.id,
      email: fakeUser.email,
      name: fakeUser.name,
    });
    // Must use insert + onConflictDoUpdate (atomic upsert), NOT select-then-insert
    expect(mockInsert).toHaveBeenCalled();
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
    expect(mockReturning).toHaveBeenCalled();
    // Must NOT do a select first (the old race-prone pattern)
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("normalizes email to lowercase before upsert", async () => {
    const { getOrCreateUser } = await import("@/lib/users");
    mockReturning.mockResolvedValue([{ ...fakeUser, email: "test@example.com" }]);

    await getOrCreateUser("Test@Example.COM", "Test User");

    // The values call should receive lowercase email
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ email: "test@example.com" })
    );
  });

  it("returns user for new email (insert path of upsert)", async () => {
    const { getOrCreateUser } = await import("@/lib/users");
    mockReturning.mockResolvedValue([fakeUser]);

    const result = await getOrCreateUser("test@example.com", "Test User");

    expect(result).toEqual({
      id: fakeUser.id,
      email: fakeUser.email,
      name: fakeUser.name,
    });
  });

  it("returns user for existing email (conflict path of upsert)", async () => {
    const { getOrCreateUser } = await import("@/lib/users");
    // onConflictDoUpdate returns the existing row with updatedAt bumped
    mockReturning.mockResolvedValue([{ ...fakeUser, updatedAt: new Date("2025-06-01") }]);

    const result = await getOrCreateUser("test@example.com");

    expect(result).toEqual({
      id: fakeUser.id,
      email: fakeUser.email,
      name: fakeUser.name,
    });
  });

  it("throws when upsert returns no rows", async () => {
    const { getOrCreateUser } = await import("@/lib/users");
    mockReturning.mockResolvedValue([]);

    await expect(getOrCreateUser("test@example.com")).rejects.toThrow(
      "Failed to create user"
    );
  });
});

describe("getUserById", () => {
  it("returns user when found", async () => {
    const { getUserById } = await import("@/lib/users");
    mockWhere.mockResolvedValue([fakeUser]);

    const result = await getUserById(fakeUser.id);

    expect(result).toEqual({
      id: fakeUser.id,
      email: fakeUser.email,
      name: fakeUser.name,
    });
  });

  it("returns null when user not found", async () => {
    const { getUserById } = await import("@/lib/users");
    mockWhere.mockResolvedValue([]);

    const result = await getUserById("nonexistent");

    expect(result).toBeNull();
  });
});
