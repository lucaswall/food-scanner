import { describe, it, expect, vi, beforeEach } from "vitest";
import { Writable } from "stream";

function createCaptureDest(): { dest: Writable; chunks: string[] } {
  const chunks: string[] = [];
  const dest = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { dest, chunks };
}

async function flush(dest: Writable): Promise<void> {
  return new Promise((resolve) => dest.end(() => resolve()));
}

describe("logger", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("createLogger returns a pino logger instance with expected methods", async () => {
    const { logger } = await import("@/lib/logger");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.child).toBe("function");
  });

  it("defaults to debug level in non-production environment", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("LOG_LEVEL", "");
    const { logger } = await import("@/lib/logger");
    expect(logger.level).toBe("debug");
  });

  it("defaults to info level in production environment", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "");
    const { logger } = await import("@/lib/logger");
    expect(logger.level).toBe("info");
  });

  it("LOG_LEVEL env var overrides default level", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "warn");
    const { logger } = await import("@/lib/logger");
    expect(logger.level).toBe("warn");
  });

  it("outputs JSON with message, level, and time fields", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_LEVEL", "");

    const { dest, chunks } = createCaptureDest();
    const { createLoggerWithDestination } = await import("@/lib/logger");
    const testLogger = createLoggerWithDestination(dest);
    testLogger.info("test message");
    await flush(dest);

    expect(chunks.length).toBeGreaterThan(0);
    const parsed = JSON.parse(chunks[0]);
    expect(parsed.message).toBe("test message");
    expect(parsed.level).toBe("info");
    expect(parsed.time).toBeDefined();
  });

  it("child logger inherits parent context and adds request-scoped fields", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { dest, chunks } = createCaptureDest();
    const { createLoggerWithDestination } = await import("@/lib/logger");
    const testLogger = createLoggerWithDestination(dest);
    const child = testLogger.child({ method: "GET", path: "/api/health" });
    child.info("request handled");
    await flush(dest);

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.message).toBe("request handled");
    expect(parsed.method).toBe("GET");
    expect(parsed.path).toBe("/api/health");
  });

  it("createRequestLoggerWithDestination returns child logger with method and path", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const { dest, chunks } = createCaptureDest();
    const { createRequestLoggerWithDestination } = await import(
      "@/lib/logger"
    );
    const reqLogger = createRequestLoggerWithDestination(
      dest,
      "POST",
      "/api/auth/google",
    );
    reqLogger.info("oauth started");
    await flush(dest);

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.message).toBe("oauth started");
    expect(parsed.method).toBe("POST");
    expect(parsed.path).toBe("/api/auth/google");
  });
});
