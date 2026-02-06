import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("pg", () => {
  const MockPool = vi.fn();
  return { Pool: MockPool };
});

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

describe("getDb", () => {
  beforeEach(() => {
    vi.resetModules();
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
});
