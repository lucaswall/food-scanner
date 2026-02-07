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
      process.env.ALLOWED_EMAILS = "test@example.com";
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

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
      delete process.env.ALLOWED_EMAILS;

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
      delete process.env.ALLOWED_EMAILS;
      process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

      const { validateRequiredEnvVars } = await import("@/lib/env");
      expect(() => validateRequiredEnvVars()).toThrow(
        "Missing required environment variables: ANTHROPIC_API_KEY, ALLOWED_EMAILS"
      );
    });
  });

  describe("getAllowedEmails", () => {
    it("parses single email", async () => {
      process.env.ALLOWED_EMAILS = "a@b.com";
      const { getAllowedEmails } = await import("@/lib/env");
      expect(getAllowedEmails()).toEqual(["a@b.com"]);
    });

    it("parses multiple comma-separated emails", async () => {
      process.env.ALLOWED_EMAILS = "a@b.com, c@d.com";
      const { getAllowedEmails } = await import("@/lib/env");
      expect(getAllowedEmails()).toEqual(["a@b.com", "c@d.com"]);
    });

    it("trims whitespace", async () => {
      process.env.ALLOWED_EMAILS = "  a@b.com ,  c@d.com  ";
      const { getAllowedEmails } = await import("@/lib/env");
      expect(getAllowedEmails()).toEqual(["a@b.com", "c@d.com"]);
    });

    it("filters empty strings", async () => {
      process.env.ALLOWED_EMAILS = "a@b.com,,c@d.com,";
      const { getAllowedEmails } = await import("@/lib/env");
      expect(getAllowedEmails()).toEqual(["a@b.com", "c@d.com"]);
    });
  });

  describe("isEmailAllowed", () => {
    it("returns true for listed email", async () => {
      process.env.ALLOWED_EMAILS = "a@b.com, c@d.com";
      const { isEmailAllowed } = await import("@/lib/env");
      expect(isEmailAllowed("a@b.com")).toBe(true);
    });

    it("returns false for unlisted email", async () => {
      process.env.ALLOWED_EMAILS = "a@b.com";
      const { isEmailAllowed } = await import("@/lib/env");
      expect(isEmailAllowed("hacker@evil.com")).toBe(false);
    });

    it("performs case-insensitive comparison", async () => {
      process.env.ALLOWED_EMAILS = "Test@Example.COM";
      const { isEmailAllowed } = await import("@/lib/env");
      expect(isEmailAllowed("test@example.com")).toBe(true);
    });
  });
});
