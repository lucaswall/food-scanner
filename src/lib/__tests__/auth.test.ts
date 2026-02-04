import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "wall.lucas@gmail.com");

const { buildGoogleAuthUrl } = await import("@/lib/auth");

describe("buildGoogleAuthUrl", () => {
  it("returns a URL pointing to Google OAuth", () => {
    const url = new URL(buildGoogleAuthUrl("test-state", "http://localhost:3000/api/auth/google/callback"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
  });

  it("includes correct client_id", () => {
    const url = new URL(buildGoogleAuthUrl("test-state", "http://localhost:3000/api/auth/google/callback"));
    expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
  });

  it("includes redirect_uri", () => {
    const url = new URL(buildGoogleAuthUrl("test-state", "http://localhost:3000/api/auth/google/callback"));
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/auth/google/callback",
    );
  });

  it("requests email and profile scopes", () => {
    const url = new URL(buildGoogleAuthUrl("test-state", "http://localhost:3000/api/auth/google/callback"));
    const scope = url.searchParams.get("scope")!;
    expect(scope).toContain("email");
    expect(scope).toContain("profile");
  });

  it("uses response_type=code", () => {
    const url = new URL(buildGoogleAuthUrl("test-state", "http://localhost:3000/api/auth/google/callback"));
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("includes state parameter for CSRF protection", () => {
    const url = new URL(buildGoogleAuthUrl("my-csrf-state", "http://localhost:3000/api/auth/google/callback"));
    expect(url.searchParams.get("state")).toBe("my-csrf-state");
  });
});
