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
  fitbitTokens: {
    userId: "user_id",
    fitbitUserId: "fitbit_user_id",
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

describe("getFitbitTokens", () => {
  it("returns null when no tokens exist", async () => {
    const { getFitbitTokens } = await import("@/lib/fitbit-tokens");
    mockWhere.mockResolvedValue([]);

    const result = await getFitbitTokens("user-uuid-123");
    expect(result).toBeNull();
  });

  it("decrypts tokens when reading from DB", async () => {
    const { getFitbitTokens } = await import("@/lib/fitbit-tokens");
    mockWhere.mockResolvedValue([{
      id: 1,
      userId: "user-uuid-123",
      fitbitUserId: "user-123",
      accessToken: "encrypted:my-access-token",
      refreshToken: "encrypted:my-refresh-token",
      expiresAt: new Date("2026-12-01"),
      updatedAt: new Date(),
    }]);

    const result = await getFitbitTokens("user-uuid-123");

    expect(result).not.toBeNull();
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted:my-access-token");
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted:my-refresh-token");
    expect(result!.accessToken).toBe("my-access-token");
    expect(result!.refreshToken).toBe("my-refresh-token");
  });

  it("throws when decryption fails", async () => {
    const { getFitbitTokens } = await import("@/lib/fitbit-tokens");
    mockWhere.mockResolvedValue([{
      id: 1,
      userId: "user-uuid-123",
      fitbitUserId: "user-123",
      accessToken: "corrupted-data",
      refreshToken: "corrupted-data",
      expiresAt: new Date("2026-12-01"),
      updatedAt: new Date(),
    }]);

    mockDecryptToken.mockImplementation(() => { throw new Error("Invalid token format"); });

    await expect(getFitbitTokens("user-uuid-123")).rejects.toThrow("Invalid token format");
  });
});

describe("upsertFitbitTokens", () => {
  it("encrypts tokens when writing to DB", async () => {
    const { upsertFitbitTokens } = await import("@/lib/fitbit-tokens");
    await upsertFitbitTokens("user-uuid-123", {
      fitbitUserId: "user-123",
      accessToken: "my-access-token",
      refreshToken: "my-refresh-token",
      expiresAt: new Date("2026-12-01"),
    });

    expect(mockEncryptToken).toHaveBeenCalledWith("my-access-token");
    expect(mockEncryptToken).toHaveBeenCalledWith("my-refresh-token");

    // Verify that encrypted values were passed to insert
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-uuid-123",
        accessToken: "encrypted:my-access-token",
        refreshToken: "encrypted:my-refresh-token",
      }),
    );
  });
});
