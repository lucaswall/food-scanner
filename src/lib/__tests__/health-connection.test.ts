import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const mockGetHealthTokens = vi.fn();
vi.mock("@/lib/health-tokens", () => ({
  getHealthTokens: (...args: unknown[]) => mockGetHealthTokens(...args),
}));

// GOOGLE_HEALTH_SCOPES from auth.ts — real export, no mock needed
// health-connection imports it from @/lib/auth

const { checkHealthConnection } = await import("@/lib/health-connection");

describe("checkHealthConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns needs_reconnect when no token row found", async () => {
    mockGetHealthTokens.mockResolvedValue(null);
    const result = await checkHealthConnection("user-1");
    expect(result.status).toBe("needs_reconnect");
  });

  it("returns scope_mismatch with missingScopes when required scopes are absent", async () => {
    mockGetHealthTokens.mockResolvedValue({
      id: 1,
      userId: "user-1",
      healthUserId: "gh-1",
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(),
      // Only one scope granted — rest are missing
      scope: "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
      updatedAt: new Date(),
    });

    const result = await checkHealthConnection("user-1");
    expect(result.status).toBe("scope_mismatch");
    if (result.status === "scope_mismatch") {
      expect(result.missingScopes.length).toBeGreaterThan(0);
    }
  });

  it("returns healthy when all GOOGLE_HEALTH_SCOPES are granted", async () => {
    const fullScope = [
      "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
      "https://www.googleapis.com/auth/googlehealth.profile.readonly",
      "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
      "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    ].join(" ");

    mockGetHealthTokens.mockResolvedValue({
      id: 1,
      userId: "user-1",
      healthUserId: "gh-1",
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(),
      scope: fullScope,
      updatedAt: new Date(),
    });

    const result = await checkHealthConnection("user-1");
    expect(result.status).toBe("healthy");
  });

  it("has no needs_setup/credentials branch (credentials concept removed)", async () => {
    // Only possible statuses: needs_reconnect | scope_mismatch | healthy
    // (no needs_setup — Google Health has no separate credentials step)
    mockGetHealthTokens.mockResolvedValue(null);
    const result = await checkHealthConnection("user-1");
    expect(["needs_reconnect", "scope_mismatch", "healthy"]).toContain(result.status);
    expect(result.status).not.toBe("needs_setup");
  });

  it("returns needs_reconnect when scope is null (corrupt/legacy row — Google always returns scope) (P2-3)", async () => {
    mockGetHealthTokens.mockResolvedValue({
      id: 1,
      userId: "user-1",
      healthUserId: "gh-1",
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(),
      // Google always returns `scope` for restricted Google Health scopes, so a null
      // stored scope is a corrupt/legacy row, not an RFC 6749 §3.3 omitted-scope grant.
      scope: null,
      updatedAt: new Date(),
    });

    const result = await checkHealthConnection("user-1");
    expect(result.status).toBe("needs_reconnect");
  });

  it("still returns scope_mismatch for a non-null partial scope string", async () => {
    mockGetHealthTokens.mockResolvedValue({
      id: 1,
      userId: "user-1",
      healthUserId: "gh-1",
      accessToken: "tok",
      refreshToken: "ref",
      expiresAt: new Date(),
      // Only one scope explicitly granted
      scope: "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
      updatedAt: new Date(),
    });

    const result = await checkHealthConnection("user-1");
    expect(result.status).toBe("scope_mismatch");
    if (result.status === "scope_mismatch") {
      expect(result.missingScopes.length).toBeGreaterThan(0);
    }
  });
});
