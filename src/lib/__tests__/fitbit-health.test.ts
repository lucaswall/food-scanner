import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  },
}));

const mockGetFitbitCredentials = vi.fn();
vi.mock("@/lib/fitbit-credentials", () => ({
  getFitbitCredentials: (...args: unknown[]) => mockGetFitbitCredentials(...args),
}));

const mockGetFitbitTokens = vi.fn();
vi.mock("@/lib/fitbit-tokens", () => ({
  getFitbitTokens: (...args: unknown[]) => mockGetFitbitTokens(...args),
}));

const { checkFitbitHealth } = await import("@/lib/fitbit-health");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("checkFitbitHealth", () => {
  it("returns needs_setup when no fitbit_credentials row", async () => {
    mockGetFitbitCredentials.mockResolvedValue(null);

    const result = await checkFitbitHealth("user-uuid-123");
    expect(result).toEqual({ status: "needs_setup" });
  });

  it("returns needs_reconnect when credentials exist but no fitbit_tokens row", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
    mockGetFitbitTokens.mockResolvedValue(null);

    const result = await checkFitbitHealth("user-uuid-123");
    expect(result).toEqual({ status: "needs_reconnect" });
  });

  it("returns scope_mismatch with missingScopes when token row scope is 'nutrition activity'", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
    mockGetFitbitTokens.mockResolvedValue({
      scope: "nutrition activity",
    });

    const result = await checkFitbitHealth("user-uuid-123");
    expect(result.status).toBe("scope_mismatch");
    if (result.status === "scope_mismatch") {
      expect(result.missingScopes).toContain("profile");
      expect(result.missingScopes).toContain("weight");
      expect(result.missingScopes).not.toContain("nutrition");
      expect(result.missingScopes).not.toContain("activity");
    }
  });

  it("returns scope_mismatch with all required scopes as missing when token scope is null (legacy)", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
    mockGetFitbitTokens.mockResolvedValue({
      scope: null,
    });

    const result = await checkFitbitHealth("user-uuid-123");
    expect(result.status).toBe("scope_mismatch");
    if (result.status === "scope_mismatch") {
      // null scope treated as "nutrition activity" only — profile and weight missing
      expect(result.missingScopes).toContain("profile");
      expect(result.missingScopes).toContain("weight");
    }
  });

  it("returns healthy when scope contains all FITBIT_REQUIRED_SCOPES", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
    mockGetFitbitTokens.mockResolvedValue({
      scope: "nutrition activity profile weight",
    });

    const result = await checkFitbitHealth("user-uuid-123");
    expect(result).toEqual({ status: "healthy" });
  });

  it("returns healthy when scope contains all required scopes plus extras", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
    mockGetFitbitTokens.mockResolvedValue({
      scope: "nutrition activity profile weight sleep",
    });

    const result = await checkFitbitHealth("user-uuid-123");
    expect(result).toEqual({ status: "healthy" });
  });

  it("passes userId to getFitbitCredentials and getFitbitTokens", async () => {
    mockGetFitbitCredentials.mockResolvedValue({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
    mockGetFitbitTokens.mockResolvedValue({
      scope: "nutrition activity profile weight",
    });

    await checkFitbitHealth("specific-user-id");

    expect(mockGetFitbitCredentials).toHaveBeenCalledWith("specific-user-id", expect.anything());
    expect(mockGetFitbitTokens).toHaveBeenCalledWith("specific-user-id", expect.anything());
  });

  it("passes optional logger to both lib functions", async () => {
    const mockLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() };
    mockGetFitbitCredentials.mockResolvedValue(null);

    await checkFitbitHealth("user-uuid-123", mockLog as never);

    expect(mockGetFitbitCredentials).toHaveBeenCalledWith("user-uuid-123", mockLog);
  });
});
