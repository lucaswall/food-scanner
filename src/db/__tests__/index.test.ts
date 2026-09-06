import { describe, it, expect, vi, beforeEach } from "vitest";

let poolConstructorArgs: unknown[] = [];
let poolInstances: MockPoolShape[] = [];

interface MockPoolShape {
  handlers: Record<string, (err: Error) => void>;
  on(event: string, handler: (err: Error) => void): MockPoolShape;
  emit(event: string, err: Error): boolean;
  end: ReturnType<typeof vi.fn>;
}

const logErrorMock = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    error: (...args: unknown[]) => logErrorMock(...args),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  startTimer: () => () => 0,
}));

vi.mock("pg", () => {
  return {
    Pool: class MockPool {
      handlers: Record<string, (err: Error) => void> = {};
      constructor(...args: unknown[]) {
        poolConstructorArgs.push(...args);
        poolInstances.push(this as unknown as MockPoolShape);
      }
      on(event: string, handler: (err: Error) => void) {
        this.handlers[event] = handler;
        return this;
      }
      emit(event: string, err: Error) {
        const h = this.handlers[event];
        if (!h) return false;
        h(err);
        return true;
      }
      end = vi.fn();
    },
  };
});

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

describe("getDb", () => {
  beforeEach(() => {
    vi.resetModules();
    poolConstructorArgs = [];
    poolInstances = [];
    logErrorMock.mockClear();
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  });

  it("returns a drizzle instance", async () => {
    const { getDb } = await import("@/db/index");
    const db = getDb();
    expect(db).toBeDefined();
    expect(typeof db.select).toBe("function");
  });

  it("returns the same instance on subsequent calls (singleton)", async () => {
    const { getDb } = await import("@/db/index");
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("creates pool with connectionTimeoutMillis set", async () => {
    const { getDb } = await import("@/db/index");
    getDb();

    expect(poolConstructorArgs[0]).toEqual(
      expect.objectContaining({ connectionTimeoutMillis: 10000 }),
    );
  });

  // FOOD-SCANNER-11/12/13/V: cold TLS connects to Railway Postgres raced the 5s
  // checkout deadline and threw "timeout exceeded when trying to connect".
  it("keeps idle sockets alive so the pool never hands out a dead connection", async () => {
    const { getDb } = await import("@/db/index");
    getDb();

    expect(poolConstructorArgs[0]).toEqual(
      expect.objectContaining({ keepAlive: true, keepAliveInitialDelayMillis: 10000 }),
    );
  });

  // FOOD-SCANNER-14: pg.Pool emits "error" on idle clients when the backend drops the
  // connection. With no listener, Node throws it as an uncaught exception and the
  // process dies (level:fatal, mechanism:auto.node.onuncaughtexception).
  it("registers an idle-client error handler on the pool", async () => {
    const { getDb } = await import("@/db/index");
    getDb();

    expect(poolInstances).toHaveLength(1);
    expect(typeof poolInstances[0].handlers.error).toBe("function");
  });

  it("logs an idle-client error instead of letting it become an uncaught exception", async () => {
    const { getDb } = await import("@/db/index");
    getDb();

    const boom = new Error("Connection terminated unexpectedly");
    expect(() => poolInstances[0].emit("error", boom)).not.toThrow();
    expect(logErrorMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ action: "db_pool_idle_client_error", err: boom }),
    );
  });

  it("creates pool with max connections set", async () => {
    const { getDb } = await import("@/db/index");
    getDb();

    expect(poolConstructorArgs[0]).toEqual(
      expect.objectContaining({ max: 5 }),
    );
  });

  it("creates pool with idleTimeoutMillis set", async () => {
    const { getDb } = await import("@/db/index");
    getDb();

    expect(poolConstructorArgs[0]).toEqual(
      expect.objectContaining({ idleTimeoutMillis: 30000 }),
    );
  });
});
