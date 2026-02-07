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
const mockReturning = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOnConflictDoNothing = vi.fn();

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
  mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing, returning: mockReturning });
  mockOnConflictDoNothing.mockReturnValue({ returning: mockReturning });
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
  it("creates user when user does not exist", async () => {
    const { getOrCreateUser } = await import("@/lib/users");
    // First select returns empty (user not found)
    mockWhere.mockResolvedValue([]);
    // Insert returns the new user
    mockReturning.mockResolvedValue([fakeUser]);

    const result = await getOrCreateUser("test@example.com", "Test User");

    expect(result).toEqual({
      id: fakeUser.id,
      email: fakeUser.email,
      name: fakeUser.name,
    });
    expect(mockInsert).toHaveBeenCalled();
  });

  it("returns existing user without creating when user exists", async () => {
    const { getOrCreateUser } = await import("@/lib/users");
    // Select returns existing user
    mockWhere.mockResolvedValue([fakeUser]);

    const result = await getOrCreateUser("test@example.com");

    expect(result).toEqual({
      id: fakeUser.id,
      email: fakeUser.email,
      name: fakeUser.name,
    });
    expect(mockInsert).not.toHaveBeenCalled();
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
