import { describe, it, expect, vi } from "vitest";

const { getAppUrl, buildUrl } = await import("@/lib/url");

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
