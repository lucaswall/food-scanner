import { describe, it, expect, vi } from "vitest";

vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client-id");
vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-google-client-secret");
vi.stubEnv("ALLOWED_EMAIL", "wall.lucas@gmail.com");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const { POST } = await import("@/app/api/auth/google/route");

describe("POST /api/auth/google", () => {
  it("returns a redirect to Google OAuth URL", async () => {
    const request = new Request("http://localhost:3000/api/auth/google", {
      method: "POST",
    });
    const response = await POST(request);

    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    expect(location).toContain("accounts.google.com");
    expect(location).toContain("client_id=test-google-client-id");
  });

  it("includes a state parameter in the redirect URL", async () => {
    const request = new Request("http://localhost:3000/api/auth/google", {
      method: "POST",
    });
    const response = await POST(request);
    const location = response.headers.get("location")!;
    const url = new URL(location);
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("sets a state cookie for CSRF verification", async () => {
    const request = new Request("http://localhost:3000/api/auth/google", {
      method: "POST",
    });
    const response = await POST(request);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("google-oauth-state");
  });
});
