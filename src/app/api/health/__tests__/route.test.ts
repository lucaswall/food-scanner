import { describe, it, expect, vi, beforeEach } from "vitest";
import packageJson from "../../../../../package.json";

vi.mock("@/lib/logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const { GET } = await import("@/app/api/health/route");
const { logger } = await import("@/lib/logger");

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("GET /api/health", () => {
  it("returns success with status ok", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ok");
  });

  it("logs debug on health check", async () => {
    await GET();
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ action: "health_check" }),
      expect.any(String),
    );
  });

  it("returns version from package.json", async () => {
    vi.stubEnv("COMMIT_SHA", "");
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    const response = await GET();
    const body = await response.json();
    expect(body.data.version).toBe(packageJson.version);
  });

  it("returns environment as Staging when APP_URL contains food-test", async () => {
    vi.stubEnv("APP_URL", "https://food-test.lucaswall.me");
    const response = await GET();
    const body = await response.json();
    expect(body.data.environment).toBe("Staging");
  });

  it("returns environment as Production when APP_URL does not contain food-test", async () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    const response = await GET();
    const body = await response.json();
    expect(body.data.environment).toBe("Production");
  });

  it("returns environment as Production when APP_URL is not set", async () => {
    vi.stubEnv("APP_URL", "");
    const response = await GET();
    const body = await response.json();
    expect(body.data.environment).toBe("Production");
  });

  it("returns all required liveness fields", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.data).toMatchObject({
      status: "ok",
      version: expect.any(String),
      environment: expect.any(String),
    });
  });

  it("does not include commitHash in response even when COMMIT_SHA is set", async () => {
    vi.stubEnv("COMMIT_SHA", "abc1234");
    const response = await GET();
    const body = await response.json();
    expect(body.data).not.toHaveProperty("commitHash");
  });

  it("formats version with commit hash for staging when COMMIT_SHA is set", async () => {
    vi.stubEnv("COMMIT_SHA", "abc1234");
    vi.stubEnv("APP_URL", "https://food-test.lucaswall.me");
    const response = await GET();
    const body = await response.json();
    expect(body.data.version).toBe(`${packageJson.version}+abc1234`);
  });

  it("does not append commit hash to version for production when COMMIT_SHA is set", async () => {
    vi.stubEnv("COMMIT_SHA", "abc1234");
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    const response = await GET();
    const body = await response.json();
    expect(body.data.version).toBe(packageJson.version);
  });

  it("does not include commitHash in response when COMMIT_SHA is empty", async () => {
    vi.stubEnv("COMMIT_SHA", "");
    const response = await GET();
    const body = await response.json();
    expect(body.data).not.toHaveProperty("commitHash");
  });

  // FOO-1151: deployment config must not be disclosed on the public health endpoint
  it("does not include healthMode in response", async () => {
    vi.stubEnv("HEALTH_DRY_RUN", "true");
    const response = await GET();
    const body = await response.json();
    expect(body.data).not.toHaveProperty("healthMode");
  });

  it("does not include claudeModel in response", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.data).not.toHaveProperty("claudeModel");
  });

  // FOO-1163: commitHash must not appear as a standalone field — it leaks deploy commit on production
  it("does not include commitHash in production response even when COMMIT_SHA is set", async () => {
    vi.stubEnv("COMMIT_SHA", "abc1234");
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    const response = await GET();
    const body = await response.json();
    expect(body.data).not.toHaveProperty("commitHash");
  });

  it("does not include commitHash in staging response (hash is already embedded in version)", async () => {
    vi.stubEnv("COMMIT_SHA", "abc1234");
    vi.stubEnv("APP_URL", "https://food-test.lucaswall.me");
    const response = await GET();
    const body = await response.json();
    expect(body.data).not.toHaveProperty("commitHash");
  });

});
