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
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("@/db/index", () => ({
  getDb: vi.fn(() => ({
    insert: mockInsert,
    select: mockSelect,
    delete: mockDelete,
    update: mockUpdate,
  })),
}));

vi.mock("@/db/schema", () => ({
  fitbitCredentials: {
    userId: "user_id",
    fitbitClientId: "fitbit_client_id",
    encryptedClientSecret: "encrypted_client_secret",
    createdAt: "created_at",
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
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
});

describe("saveFitbitCredentials", () => {
  it("stores encrypted client secret", async () => {
    const { saveFitbitCredentials } = await import("@/lib/fitbit-credentials");
    await saveFitbitCredentials("user-uuid-123", "my-client-id", "my-secret");

    expect(mockEncryptToken).toHaveBeenCalledWith("my-secret");
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-uuid-123",
        fitbitClientId: "my-client-id",
        encryptedClientSecret: "encrypted:my-secret",
      }),
    );
  });
});

describe("getFitbitCredentials", () => {
  it("returns credentials with decrypted secret", async () => {
    const { getFitbitCredentials } = await import("@/lib/fitbit-credentials");
    mockWhere.mockResolvedValue([{
      id: 1,
      userId: "user-uuid-123",
      fitbitClientId: "my-client-id",
      encryptedClientSecret: "encrypted:my-secret",
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);

    const result = await getFitbitCredentials("user-uuid-123");

    expect(result).not.toBeNull();
    expect(mockDecryptToken).toHaveBeenCalledWith("encrypted:my-secret");
    expect(result!.clientId).toBe("my-client-id");
    expect(result!.clientSecret).toBe("my-secret");
  });

  it("returns null when no credentials exist", async () => {
    const { getFitbitCredentials } = await import("@/lib/fitbit-credentials");
    mockWhere.mockResolvedValue([]);

    const result = await getFitbitCredentials("user-uuid-123");
    expect(result).toBeNull();
  });
});

describe("updateFitbitClientId", () => {
  it("updates only the client ID", async () => {
    const { updateFitbitClientId } = await import("@/lib/fitbit-credentials");
    await updateFitbitClientId("user-uuid-123", "new-client-id");

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        fitbitClientId: "new-client-id",
      }),
    );
  });
});

describe("replaceFitbitClientSecret", () => {
  it("re-encrypts with new secret", async () => {
    const { replaceFitbitClientSecret } = await import("@/lib/fitbit-credentials");
    await replaceFitbitClientSecret("user-uuid-123", "new-secret");

    expect(mockEncryptToken).toHaveBeenCalledWith("new-secret");
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedClientSecret: "encrypted:new-secret",
      }),
    );
  });
});

describe("hasFitbitCredentials", () => {
  it("returns true when credentials exist", async () => {
    const { hasFitbitCredentials } = await import("@/lib/fitbit-credentials");
    mockWhere.mockResolvedValue([{ id: 1 }]);

    const result = await hasFitbitCredentials("user-uuid-123");
    expect(result).toBe(true);
  });

  it("returns false when no credentials exist", async () => {
    const { hasFitbitCredentials } = await import("@/lib/fitbit-credentials");
    mockWhere.mockResolvedValue([]);

    const result = await hasFitbitCredentials("user-uuid-123");
    expect(result).toBe(false);
  });
});

describe("deleteFitbitCredentials", () => {
  it("removes the row", async () => {
    const { deleteFitbitCredentials } = await import("@/lib/fitbit-credentials");
    await deleteFitbitCredentials("user-uuid-123");

    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteWhere).toHaveBeenCalled();
  });
});
