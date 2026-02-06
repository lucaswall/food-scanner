import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("env", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getRequiredEnv", () => {
    it("returns the value when env var is present", async () => {
      process.env.TEST_VAR = "test-value";
      const { getRequiredEnv } = await import("@/lib/env");
      expect(getRequiredEnv("TEST_VAR")).toBe("test-value");
    });

    it("throws when env var is missing", async () => {
      delete process.env.TEST_VAR;
      const { getRequiredEnv } = await import("@/lib/env");
      expect(() => getRequiredEnv("TEST_VAR")).toThrow(
        "Required environment variable TEST_VAR is not set"
      );
    });

    it("throws when env var is empty string", async () => {
      process.env.TEST_VAR = "";
      const { getRequiredEnv } = await import("@/lib/env");
      expect(() => getRequiredEnv("TEST_VAR")).toThrow(
        "Required environment variable TEST_VAR is not set"
      );
    });
  });

  describe("validateRequiredEnvVars", () => {
    it("does not throw when all required vars are present", async () => {
      process.env.SESSION_SECRET = "test-secret-that-is-at-least-32-chars-long";
      process.env.GOOGLE_CLIENT_ID = "google-id";
      process.env.GOOGLE_CLIENT_SECRET = "google-secret";
      process.env.FITBIT_CLIENT_ID = "fitbit-id";
      process.env.FITBIT_CLIENT_SECRET = "fitbit-secret";
      process.env.ANTHROPIC_API_KEY = "anthropic-key";
      process.env.APP_URL = "https://food.example.com";
      process.env.ALLOWED_EMAIL = "test@example.com";

      const { validateRequiredEnvVars } = await import("@/lib/env");
      expect(() => validateRequiredEnvVars()).not.toThrow();
    });

    it("throws listing all missing vars when multiple are missing", async () => {
      delete process.env.SESSION_SECRET;
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.FITBIT_CLIENT_ID;
      delete process.env.FITBIT_CLIENT_SECRET;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.APP_URL;
      delete process.env.ALLOWED_EMAIL;

      const { validateRequiredEnvVars } = await import("@/lib/env");
      expect(() => validateRequiredEnvVars()).toThrow(
        /Missing required environment variables: SESSION_SECRET, GOOGLE_CLIENT_ID/
      );
    });

    it("throws listing only the missing vars", async () => {
      process.env.SESSION_SECRET = "test-secret-that-is-at-least-32-chars-long";
      process.env.GOOGLE_CLIENT_ID = "google-id";
      process.env.GOOGLE_CLIENT_SECRET = "google-secret";
      process.env.FITBIT_CLIENT_ID = "fitbit-id";
      process.env.FITBIT_CLIENT_SECRET = "fitbit-secret";
      delete process.env.ANTHROPIC_API_KEY;
      process.env.APP_URL = "https://food.example.com";
      delete process.env.ALLOWED_EMAIL;

      const { validateRequiredEnvVars } = await import("@/lib/env");
      expect(() => validateRequiredEnvVars()).toThrow(
        "Missing required environment variables: ANTHROPIC_API_KEY, ALLOWED_EMAIL"
      );
    });
  });
});
