import { describe, it, expect, vi, beforeEach } from "vitest";

let poolConstructorArgs: unknown[] = [];

vi.mock("pg", () => {
  return {
    Pool: class MockPool {
      constructor(...args: unknown[]) {
        poolConstructorArgs.push(...args);
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
      expect.objectContaining({ connectionTimeoutMillis: 5000 }),
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
