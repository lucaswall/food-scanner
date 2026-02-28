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

vi.mock("@/lib/claude", () => ({
  CLAUDE_MODEL: "claude-sonnet-4-6",
}));

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

  it("returns fitbitMode as Dry Run when FITBIT_DRY_RUN is true", async () => {
    vi.stubEnv("FITBIT_DRY_RUN", "true");
    const response = await GET();
    const body = await response.json();
    expect(body.data.fitbitMode).toBe("Dry Run");
  });

  it("returns fitbitMode as Live when FITBIT_DRY_RUN is absent", async () => {
    vi.stubEnv("FITBIT_DRY_RUN", "");
    const response = await GET();
    const body = await response.json();
    expect(body.data.fitbitMode).toBe("Live");
  });

  it("returns claudeModel from claude.ts", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.data.claudeModel).toBe("claude-sonnet-4-6");
  });

  it("returns all required about fields", async () => {
    const response = await GET();
    const body = await response.json();
    expect(body.data).toMatchObject({
      status: "ok",
      version: expect.any(String),
      environment: expect.any(String),
      fitbitMode: expect.any(String),
      claudeModel: expect.any(String),
    });
  });

  it("includes commitHash in response when COMMIT_SHA is set", async () => {
    vi.stubEnv("COMMIT_SHA", "abc1234");
    const response = await GET();
    const body = await response.json();
    expect(body.data.commitHash).toBe("abc1234");
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

  it("returns empty commitHash when COMMIT_SHA is empty", async () => {
    vi.stubEnv("COMMIT_SHA", "");
    const response = await GET();
    const body = await response.json();
    expect(body.data.commitHash).toBe("");
  });

});
