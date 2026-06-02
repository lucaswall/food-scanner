// Integration test (FOO-1012): verify the v1/activity-summary route routes
// through getCachedHealthActivitySummary, so two sequential GETs only invoke the
// underlying Google Health fetch once.
//
// Unlike route.test.ts, this file does NOT mock @/lib/health-cache — it mocks
// the lower-level @/lib/google-health primitives so the real cache layer runs and
// dedups.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockValidateApiRequest = vi.fn();
vi.mock("@/lib/api-auth", () => ({
  validateApiRequest: (...args: unknown[]) => mockValidateApiRequest(...args),
  hashForRateLimit: (key: string) => `hashed-${key.slice(0, 8)}`,
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
    startTimer: () => () => 42,
  };
});

const mockCheckRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}));

// Mock the bottom of the stack: ensureFreshToken + getHealthActivitySummary.
const mockEnsureFreshToken = vi.fn();
const mockGetHealthActivitySummary = vi.fn();
vi.mock("@/lib/google-health", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  getHealthActivitySummary: (...args: unknown[]) => mockGetHealthActivitySummary(...args),
}));

function createRequest(url: string, headers?: HeadersInit): Request {
  return new Request(url, { headers });
}

describe("GET /api/v1/activity-summary — cache dedup integration (FOO-1012)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset modules so each test gets a fresh health-cache (its Map state).
    vi.resetModules();
  });

  it("invokes getHealthActivitySummary exactly once across two sequential GETs for the same date", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-int" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    mockEnsureFreshToken.mockResolvedValue("google-health-access-token");
    mockGetHealthActivitySummary.mockResolvedValue({ caloriesOut: 2222 });

    const { GET } = await import("@/app/api/v1/activity-summary/route");

    const url = "http://localhost:3000/api/v1/activity-summary?date=2026-05-04";
    const headers = { Authorization: "Bearer valid-key" };

    const r1 = await GET(createRequest(url, headers));
    expect(r1.status).toBe(200);

    const r2 = await GET(createRequest(url, headers));
    expect(r2.status).toBe(200);

    // The route uses getCachedHealthActivitySummary, which calls the underlying
    // getHealthActivitySummary — and dedups within its 5-min TTL.
    expect(mockGetHealthActivitySummary).toHaveBeenCalledTimes(1);
  });

  it("invokes getHealthActivitySummary twice for different dates (no cross-date dedup)", async () => {
    mockValidateApiRequest.mockResolvedValue({ userId: "user-int" });
    mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 29 });
    mockEnsureFreshToken.mockResolvedValue("google-health-access-token");
    mockGetHealthActivitySummary.mockResolvedValue({ caloriesOut: 2222 });

    const { GET } = await import("@/app/api/v1/activity-summary/route");

    const headers = { Authorization: "Bearer valid-key" };

    await GET(createRequest("http://localhost:3000/api/v1/activity-summary?date=2026-05-04", headers));
    await GET(createRequest("http://localhost:3000/api/v1/activity-summary?date=2026-05-05", headers));

    expect(mockGetHealthActivitySummary).toHaveBeenCalledTimes(2);
  });
});
