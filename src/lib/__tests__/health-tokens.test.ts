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

const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockDelete = vi.fn();
const mockDeleteWhere = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
    select: mockSelect,
    delete: mockDelete,
  })),
}));

vi.mock("@/db/schema", () => ({
  healthTokens: {
    userId: "user_id",
    healthUserId: "health_user_id",
    accessToken: "access_token",
    refreshToken: "refresh_token",
    expiresAt: "expires_at",
    updatedAt: "updated_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, _type: "eq" })),
}));

// Mock token encryption
const mockEncryptToken = vi.fn((val: string) => `encrypted:${val}`);
const mockDecryptToken = vi.fn((val: string) => val.replace("encrypted:", ""));
vi.mock("@/lib/token-encryption", () => ({
  encryptToken: (val: string) => mockEncryptToken(val),
  decryptToken: (val: string) => mockDecryptToken(val),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
  mockOnConflictDoUpdate.mockResolvedValue(undefined);
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockDelete.mockReturnValue({ where: mockDeleteWhere });
  mockDeleteWhere.mockResolvedValue(undefined);
});

describe("getHealthTokens", () => {
  it("returns null when no tokens exist", async () => {
    const { getHealthTokens } = await import("@/lib/health-tokens");
    mockWhere.mockResolvedValue([]);

    const result = await getHealthTokens("user-uuid-123");
    expect(result).toBeNull();
  });

  it("decrypts tokens and exposes healthUserId when reading from DB", async () => {
    const { getHealthTokens } = await import("@/lib/health-tokens");
    mockWhere.mockResolvedValue([{
      id: 1,
      userId: "user-uuid-123",
      healthUserId: "health-uid-123",
      accessToken: "encrypted:my-access-token",
      refreshToken: "encrypted:my-refresh-token",
      expiresAt: new Date("2026-12-01"),
      scope: null,
      updatedAt: new Date(),
    }]);

    const result = await getHealthTokens("user-uuid-123");

    expect(result).not.toBeNull();
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted:my-access-token");
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted:my-refresh-token");
    expect(result!.accessToken).toBe("my-access-token");
    expect(result!.refreshToken).toBe("my-refresh-token");
    expect(result!.healthUserId).toBe("health-uid-123");
  });

  it("throws when decryption fails", async () => {
    const { getHealthTokens } = await import("@/lib/health-tokens");
    mockWhere.mockResolvedValue([{
      id: 1,
      userId: "user-uuid-123",
      healthUserId: "health-uid-123",
      accessToken: "corrupted-data",
      refreshToken: "corrupted-data",
      expiresAt: new Date("2026-12-01"),
      scope: null,
      updatedAt: new Date(),
    }]);

    mockDecryptToken.mockImplementationOnce(() => { throw new Error("Invalid token format"); });

    await expect(getHealthTokens("user-uuid-123")).rejects.toThrow("Invalid token format");
  });

  it("returns scope from DB row", async () => {
    const { getHealthTokens } = await import("@/lib/health-tokens");
    mockWhere.mockResolvedValue([{
      id: 1,
      userId: "user-uuid-123",
      healthUserId: "health-uid-123",
      accessToken: "encrypted:my-access-token",
      refreshToken: "encrypted:my-refresh-token",
      expiresAt: new Date("2026-12-01"),
      scope: "googlehealth.nutrition.writeonly profile.readonly",
      updatedAt: new Date(),
    }]);

    const result = await getHealthTokens("user-uuid-123");
    expect(result!.scope).toBe("googlehealth.nutrition.writeonly profile.readonly");
  });

  it("returns null scope when not set in DB", async () => {
    const { getHealthTokens } = await import("@/lib/health-tokens");
    mockWhere.mockResolvedValue([{
      id: 1,
      userId: "user-uuid-123",
      healthUserId: "health-uid-123",
      accessToken: "encrypted:my-access-token",
      refreshToken: "encrypted:my-refresh-token",
      expiresAt: new Date("2026-12-01"),
      scope: null,
      updatedAt: new Date(),
    }]);

    const result = await getHealthTokens("user-uuid-123");
    expect(result!.scope).toBeNull();
  });
});

describe("upsertHealthTokens", () => {
  it("encrypts both tokens when writing to DB", async () => {
    const { upsertHealthTokens } = await import("@/lib/health-tokens");
    await upsertHealthTokens("user-uuid-123", {
      healthUserId: "health-uid-123",
      accessToken: "my-access-token",
      refreshToken: "my-refresh-token",
      expiresAt: new Date("2026-12-01"),
    });

    expect(mockEncryptToken).toHaveBeenCalledWith("my-access-token");
    expect(mockEncryptToken).toHaveBeenCalledWith("my-refresh-token");

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-uuid-123",
        healthUserId: "health-uid-123",
        accessToken: "encrypted:my-access-token",
        refreshToken: "encrypted:my-refresh-token",
      }),
    );
  });

  it("upserts on conflict targeting userId", async () => {
    const { upsertHealthTokens } = await import("@/lib/health-tokens");
    await upsertHealthTokens("user-uuid-123", {
      healthUserId: "health-uid-123",
      accessToken: "my-access-token",
      refreshToken: "my-refresh-token",
      expiresAt: new Date("2026-12-01"),
    });

    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "user_id",
        set: expect.objectContaining({
          healthUserId: "health-uid-123",
          accessToken: "encrypted:my-access-token",
          refreshToken: "encrypted:my-refresh-token",
        }),
      }),
    );
  });

  it("persists scope when provided", async () => {
    const { upsertHealthTokens } = await import("@/lib/health-tokens");
    await upsertHealthTokens("user-uuid-123", {
      healthUserId: "health-uid-123",
      accessToken: "my-access-token",
      refreshToken: "my-refresh-token",
      expiresAt: new Date("2026-12-01"),
      scope: "googlehealth.nutrition.writeonly",
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "googlehealth.nutrition.writeonly" }),
    );
  });

  it("persists null scope when not provided", async () => {
    const { upsertHealthTokens } = await import("@/lib/health-tokens");
    await upsertHealthTokens("user-uuid-123", {
      healthUserId: "health-uid-123",
      accessToken: "my-access-token",
      refreshToken: "my-refresh-token",
      expiresAt: new Date("2026-12-01"),
    });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ scope: null }),
    );
  });
});

describe("deleteHealthTokens", () => {
  it("deletes filtered by userId", async () => {
    const { deleteHealthTokens } = await import("@/lib/health-tokens");
    await deleteHealthTokens("user-uuid-123");
    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteWhere).toHaveBeenCalled();
  });
});
