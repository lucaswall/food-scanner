import { describe, it, expect, vi } from "vitest";

vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "wall.lucas@gmail.com");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const { POST } = await import("@/app/api/auth/google/route");
const { logger } = await import("@/lib/logger");

describe("POST /api/auth/google", () => {
  it("returns a redirect to Google OAuth URL", async () => {
    const response = await POST();

    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    expect(location).toContain("accounts.google.com");
    expect(location).toContain("client_id=test-google-client-id");
  });

  it("includes a state parameter in the redirect URL", async () => {
    const response = await POST();
    const location = response.headers.get("location")!;
    const url = new URL(location);
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("uses APP_URL for redirect URI", async () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    const response = await POST();
    const location = response.headers.get("location")!;
    expect(location).toContain(
      encodeURIComponent("https://food.lucaswall.me/api/auth/google/callback"),
    );
  });

  it("sets a state cookie for CSRF verification", async () => {
    const response = await POST();
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("google-oauth-state");
  });

  it("logs info on OAuth initiation", async () => {
    await POST();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "google_oauth_start" }),
      expect.any(String),
    );
  });
});
