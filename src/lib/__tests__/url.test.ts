import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const { getAppUrl, buildUrl } = await import("@/lib/url");
const { logger } = await import("@/lib/logger");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAppUrl", () => {
  it("returns APP_URL when set", () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    expect(getAppUrl()).toBe("https://food.lucaswall.me");
  });

  it("strips trailing slash from APP_URL", () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me/");
    expect(getAppUrl()).toBe("https://food.lucaswall.me");
  });

  it("throws when APP_URL is not set", () => {
    vi.stubEnv("APP_URL", "");
    expect(() => getAppUrl()).toThrow("APP_URL environment variable is required");
  });

  it("logs error when APP_URL is not set", () => {
    vi.stubEnv("APP_URL", "");
    try {
      getAppUrl();
    } catch {
      // expected
    }
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ action: "missing_app_url" }),
      expect.any(String),
    );
  });
});

describe("buildUrl", () => {
  it("builds full URL from path", () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    expect(buildUrl("/api/auth/google/callback")).toBe(
      "https://food.lucaswall.me/api/auth/google/callback",
    );
  });

  it("handles trailing slash in APP_URL", () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me/");
    expect(buildUrl("/api/auth/google/callback")).toBe(
      "https://food.lucaswall.me/api/auth/google/callback",
    );
  });
});
