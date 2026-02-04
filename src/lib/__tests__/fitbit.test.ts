import { describe, it, expect, vi } from "vitest";

vi.stubEnv("FITBIT_CLIENT_ID", "test-fitbit-client-id");
vi.stubEnv("FITBIT_CLIENT_SECRET", "test-fitbit-client-secret");

const { buildFitbitAuthUrl, ensureFreshToken } = await import("@/lib/fitbit");

describe("buildFitbitAuthUrl", () => {
  it("returns a URL pointing to Fitbit OAuth", () => {
    const url = new URL(
      buildFitbitAuthUrl("test-state", "http://localhost:3000/api/auth/fitbit/callback"),
    );
    expect(url.origin).toBe("https://www.fitbit.com");
    expect(url.pathname).toBe("/oauth2/authorize");
  });

  it("includes correct client_id", () => {
    const url = new URL(
      buildFitbitAuthUrl("test-state", "http://localhost:3000/api/auth/fitbit/callback"),
    );
    expect(url.searchParams.get("client_id")).toBe("test-fitbit-client-id");
  });

  it("includes redirect_uri", () => {
    const url = new URL(
      buildFitbitAuthUrl("test-state", "http://localhost:3000/api/auth/fitbit/callback"),
    );
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/fitbit/callback",
    );
  });

  it("requests nutrition scope", () => {
    const url = new URL(
      buildFitbitAuthUrl("test-state", "http://localhost:3000/api/auth/fitbit/callback"),
    );
    expect(url.searchParams.get("scope")).toContain("nutrition");
  });

  it("uses response_type=code", () => {
    const url = new URL(
      buildFitbitAuthUrl("test-state", "http://localhost:3000/api/auth/fitbit/callback"),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("includes state parameter", () => {
    const url = new URL(
      buildFitbitAuthUrl("my-state", "http://localhost:3000/api/auth/fitbit/callback"),
    );
    expect(url.searchParams.get("state")).toBe("my-state");
  });
});

describe("ensureFreshToken", () => {
  it("returns existing token if not expiring within 1 hour", async () => {
    const session = {
      fitbit: {
        accessToken: "valid-token",
        refreshToken: "refresh-token",
        userId: "user-123",
        expiresAt: Date.now() + 2 * 60 * 60 * 1000, // 2 hours from now
      },
    };

    const token = await ensureFreshToken(session as never);
    expect(token).toBe("valid-token");
  });

  it("throws FITBIT_TOKEN_INVALID if no fitbit tokens exist", async () => {
    const session = {};

    await expect(ensureFreshToken(session as never)).rejects.toThrow(
      "FITBIT_TOKEN_INVALID",
    );
  });
});
