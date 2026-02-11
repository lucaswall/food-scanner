import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
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
const mockUpdateWhere = vi.fn();
const mockUpdateReturning = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
  })),
}));

vi.mock("@/db/schema", () => ({
  apiKeys: {
    id: "id",
    userId: "user_id",
    name: "name",
    keyHash: "key_hash",
    keyPrefix: "key_prefix",
    lastUsedAt: "last_used_at",
    revokedAt: "revoked_at",
    createdAt: "created_at",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val, _type: "eq" })),
  and: vi.fn((...conditions) => ({ conditions, _type: "and" })),
  isNull: vi.fn((col) => ({ col, _type: "isNull" })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([]);
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockResolvedValue([]);
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  // mockUpdateWhere needs to support both .returning() AND direct await
  const updateWhereResult = {
    returning: mockUpdateReturning,
    then: (resolve: (value: unknown[]) => void) => {
      mockUpdateReturning.mockResolvedValue([]);
      return Promise.resolve([]).then(resolve);
    },
  };
  mockUpdateWhere.mockReturnValue(updateWhereResult);
  mockUpdateReturning.mockResolvedValue([]);
});

describe("generateApiKey", () => {
  it("returns a string starting with fsk_ prefix", async () => {
    const { generateApiKey } = await import("@/lib/api-keys");
    const key = generateApiKey();

    expect(key).toMatch(/^fsk_[a-f0-9]{64}$/);
    expect(key.length).toBeGreaterThanOrEqual(40);
  });

  it("generates unique keys on each call", async () => {
    const { generateApiKey } = await import("@/lib/api-keys");
    const key1 = generateApiKey();
    const key2 = generateApiKey();

    expect(key1).not.toBe(key2);
  });
});

describe("hashApiKey", () => {
  it("returns a consistent hex SHA-256 hash", async () => {
    const { hashApiKey } = await import("@/lib/api-keys");
    const rawKey = "fsk_abc123";

    const hash1 = hashApiKey(rawKey);
    const hash2 = hashApiKey(rawKey);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces different hashes for different keys", async () => {
    const { hashApiKey } = await import("@/lib/api-keys");

    const hash1 = hashApiKey("fsk_key1");
    const hash2 = hashApiKey("fsk_key2");

    expect(hash1).not.toBe(hash2);
  });
});

describe("createApiKey", () => {
  it("inserts a row with hashed key and prefix, returns id + rawKey + metadata", async () => {
    const { createApiKey } = await import("@/lib/api-keys");
    const mockCreatedAt = new Date("2026-01-15T10:00:00Z");

    mockReturning.mockResolvedValue([{
      id: 1,
      name: "My Script",
      keyPrefix: "abc12345",
      createdAt: mockCreatedAt,
    }]);

    const result = await createApiKey("user-uuid-123", "My Script");

    expect(result).toMatchObject({
      id: 1,
      name: "My Script",
      keyPrefix: expect.stringMatching(/^[a-f0-9]{8}$/),
      createdAt: mockCreatedAt,
    });
    expect(result.rawKey).toMatch(/^fsk_[a-f0-9]{64}$/);

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-uuid-123",
        name: "My Script",
        keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        keyPrefix: expect.stringMatching(/^[a-f0-9]{8}$/),
      })
    );
  });

  it("throws if no row is returned", async () => {
    const { createApiKey } = await import("@/lib/api-keys");
    mockReturning.mockResolvedValue([]);

    await expect(createApiKey("user-uuid-123", "My Script")).rejects.toThrow("Failed to insert API key");
  });
});

describe("listApiKeys", () => {
  it("returns all non-revoked keys for the user", async () => {
    const { listApiKeys } = await import("@/lib/api-keys");
    const mockKeys = [
      {
        id: 1,
        name: "Script 1",
        keyPrefix: "abc12345",
        createdAt: new Date("2026-01-15T10:00:00Z"),
        lastUsedAt: null,
      },
      {
        id: 2,
        name: "Script 2",
        keyPrefix: "def67890",
        createdAt: new Date("2026-01-16T11:00:00Z"),
        lastUsedAt: new Date("2026-01-17T12:00:00Z"),
      },
    ];

    mockWhere.mockResolvedValue(mockKeys);

    const result = await listApiKeys("user-uuid-123");

    expect(result).toEqual(mockKeys);
    expect(result).toHaveLength(2);
    expect(result[0]).not.toHaveProperty("keyHash");
  });

  it("returns empty array when no keys exist", async () => {
    const { listApiKeys } = await import("@/lib/api-keys");
    mockWhere.mockResolvedValue([]);

    const result = await listApiKeys("user-uuid-123");

    expect(result).toEqual([]);
  });
});

describe("revokeApiKey", () => {
  it("sets revokedAt timestamp for matching userId and keyId", async () => {
    const { revokeApiKey } = await import("@/lib/api-keys");
    mockUpdateReturning.mockResolvedValue([{ id: 1 }]);

    const result = await revokeApiKey("user-uuid-123", 1);

    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        revokedAt: expect.any(Date),
      })
    );
  });

  it("returns false when userId does not match", async () => {
    const { revokeApiKey } = await import("@/lib/api-keys");
    mockUpdateReturning.mockResolvedValue([]);

    const result = await revokeApiKey("user-uuid-123", 999);

    expect(result).toBe(false);
  });
});

describe("validateApiKey", () => {
  it("returns userId and keyId for valid non-revoked keys", async () => {
    const { validateApiKey } = await import("@/lib/api-keys");
    const rawKey = "fsk_abc123";

    mockWhere.mockResolvedValueOnce([{
      id: 1,
      userId: "user-uuid-123",
      revokedAt: null,
    }]);

    // Mock the update call for lastUsedAt
    mockWhere.mockResolvedValueOnce([]);

    const result = await validateApiKey(rawKey);

    expect(result).toEqual({
      userId: "user-uuid-123",
      keyId: 1,
    });

    // Verify lastUsedAt was updated
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("returns null for revoked keys", async () => {
    const { validateApiKey } = await import("@/lib/api-keys");
    const rawKey = "fsk_abc123";

    mockWhere.mockResolvedValue([{
      id: 1,
      userId: "user-uuid-123",
      revokedAt: new Date("2026-01-15T10:00:00Z"),
    }]);

    const result = await validateApiKey(rawKey);

    expect(result).toBeNull();
  });

  it("returns null for non-existent keys", async () => {
    const { validateApiKey } = await import("@/lib/api-keys");
    mockWhere.mockResolvedValue([]);

    const result = await validateApiKey("fsk_nonexistent");

    expect(result).toBeNull();
  });

  it("updates lastUsedAt on successful validation", async () => {
    const { validateApiKey } = await import("@/lib/api-keys");
    const rawKey = "fsk_abc123";

    mockWhere.mockResolvedValueOnce([{
      id: 1,
      userId: "user-uuid-123",
      revokedAt: null,
    }]);

    mockUpdateReturning.mockResolvedValueOnce([]);

    await validateApiKey(rawKey);

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        lastUsedAt: expect.any(Date),
      })
    );
  });
});
