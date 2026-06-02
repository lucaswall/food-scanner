import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockMigrate, mockGetDb, mockCloseDb, mockExecute, mockLogger } = vi.hoisted(() => {
  const mockExecute = vi.fn(async () => ({
    rows: [
      { table_name: "custom_foods", data_type: "text" },
      { table_name: "food_log_entries", data_type: "text" },
    ],
  }));
  return {
    mockMigrate: vi.fn(),
    mockGetDb: vi.fn(() => ({ execute: mockExecute })),
    mockCloseDb: vi.fn(),
    mockExecute,
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    },
  };
});

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

  describe("0027 unit_id boot guard", () => {
    it("passes when unit_id columns are text after migration", async () => {
      mockMigrate.mockResolvedValueOnce(undefined);

      await runMigrations();

      expect(mockExecute).toHaveBeenCalled();
      expect(mockLogger.fatal).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ action: "migrations_success" }),
        expect.any(String),
      );
    });

    it("refuses to boot (FATAL) when 0027 is applied but unit_id is still integer", async () => {
      mockMigrate.mockResolvedValueOnce(undefined);
      mockExecute.mockResolvedValueOnce({
        rows: [
          { table_name: "custom_foods", data_type: "integer" },
          { table_name: "food_log_entries", data_type: "text" },
        ],
      });

      await expect(runMigrations()).rejects.toThrow(/unit_id/i);

      expect(mockLogger.fatal).toHaveBeenCalledWith(
        expect.objectContaining({ action: "migration_guard_failed" }),
        expect.any(String),
      );
      // Guard failure must not retry — migrate runs exactly once.
      expect(mockMigrate).toHaveBeenCalledTimes(1);
    });

    it("does not log migrations_success when the guard fails", async () => {
      mockMigrate.mockResolvedValueOnce(undefined);
      mockExecute.mockResolvedValueOnce({
        rows: [{ table_name: "food_log_entries", data_type: "integer" }],
      });

      await expect(runMigrations()).rejects.toThrow();

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: "migrations_success" }),
        expect.any(String),
      );
    });
  });
});
