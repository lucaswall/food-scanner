import { describe, it, expect, vi } from "vitest";

vi.stubEnv("FITBIT_CLIENT_ID", "test-fitbit-client-id");
vi.stubEnv("FITBIT_CLIENT_SECRET", "test-fitbit-client-secret");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

// Mock iron-session
vi.mock("iron-session", () => ({
  getIronSession: vi.fn().mockResolvedValue({
    email: "test@example.com",
    sessionId: "test-session",
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const { POST } = await import("@/app/api/auth/fitbit/route");
const { logger } = await import("@/lib/logger");

describe("POST /api/auth/fitbit", () => {
  it("returns a redirect to Fitbit OAuth URL", async () => {
    const response = await POST();

    expect(response.status).toBe(302);
    const location = response.headers.get("location")!;
    expect(location).toContain("fitbit.com");
    expect(location).toContain("client_id=test-fitbit-client-id");
  });

  it("uses APP_URL for redirect URI", async () => {
    vi.stubEnv("APP_URL", "https://food.lucaswall.me");
    const response = await POST();
    const location = response.headers.get("location")!;
    expect(location).toContain(
      encodeURIComponent("https://food.lucaswall.me/api/auth/fitbit/callback"),
    );
  });

  it("sets a state cookie for CSRF verification", async () => {
    const response = await POST();
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("fitbit-oauth-state");
  });

  it("logs info on OAuth initiation", async () => {
    await POST();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ action: "fitbit_oauth_start" }),
      expect.any(String),
    );
  });
});
