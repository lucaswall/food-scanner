import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockMigrate, mockGetDb, mockCloseDb, mockLogger } = vi.hoisted(() => ({
  mockMigrate: vi.fn(),
  mockGetDb: vi.fn(() => ({})),
  mockCloseDb: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("drizzle-orm/node-postgres/migrator", () => ({
  migrate: mockMigrate,
}));
vi.mock("@/db/index", () => ({
  getDb: mockGetDb,
  closeDb: mockCloseDb,
}));
vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
}));

const { runMigrations } = await import("@/db/migrate");

describe("runMigrations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("succeeds on first attempt without retrying", async () => {
    mockMigrate.mockResolvedValueOnce(undefined);

    await runMigrations();

    expect(mockMigrate).toHaveBeenCalledTimes(1);
    expect(mockCloseDb).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "migrations_start" }),
      expect.any(String),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "migrations_success" }),
      expect.any(String),
    );
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("retries on transient error and succeeds", async () => {
    const error = new Error("getaddrinfo ENOTFOUND Postgres.railway.internal");
    mockMigrate
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);

    const promise = runMigrations();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(mockMigrate).toHaveBeenCalledTimes(3);
    expect(mockCloseDb).toHaveBeenCalledTimes(2);
    expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "migrations_success" }),
      expect.any(String),
    );
  });

  it("throws after exhausting all retries", async () => {
    const error = new Error("getaddrinfo ENOTFOUND Postgres.railway.internal");
    mockMigrate.mockRejectedValue(error);

    const promise = runMigrations();
    const rejectPromise = expect(promise).rejects.toThrow("ENOTFOUND");
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(8000);
    await rejectPromise;

    expect(mockMigrate).toHaveBeenCalledTimes(5);
    expect(mockCloseDb).toHaveBeenCalledTimes(4);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "migrations_failed", attempt: 5 }),
      expect.any(String),
    );
  });

  it("logs retry attempts with attempt number and delay", async () => {
    const error = new Error("connection refused");
    mockMigrate
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);

    const promise = runMigrations();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "migrations_retry", attempt: 1, nextDelay: 1000 }),
      expect.any(String),
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "migrations_retry", attempt: 2, nextDelay: 2000 }),
      expect.any(String),
    );
  });

  it("resets db singleton before retrying to get a fresh connection", async () => {
    const error = new Error("connection refused");
    mockMigrate.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);

    const promise = runMigrations();
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(mockCloseDb).toHaveBeenCalledTimes(1);
    // closeDb should be called before the next migrate attempt
    const closeDbOrder = mockCloseDb.mock.invocationCallOrder[0];
    const secondMigrateOrder = mockMigrate.mock.invocationCallOrder[1];
    expect(closeDbOrder).toBeLessThan(secondMigrateOrder);
  });
});
