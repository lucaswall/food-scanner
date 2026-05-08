import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (session: FullSession | null): Response | null => {
    if (!session) {
      return Response.json(
        {
          success: false,
          error: { code: "AUTH_MISSING_SESSION", message: "No active session" },
          timestamp: Date.now(),
        },
        { status: 401 },
      );
    }
    return null;
  },
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const mockGetUserGoalSettings = vi.fn();
const mockUpdateUserGoalSettings = vi.fn();
vi.mock("@/lib/users", () => ({
  getUserGoalSettings: (...args: unknown[]) => mockGetUserGoalSettings(...args),
  updateUserGoalSettings: (...args: unknown[]) => mockUpdateUserGoalSettings(...args),
}));

const mockInvalidateUserDailyGoalsForSettingsChange = vi.fn();
vi.mock("@/lib/daily-goals", () => ({
  invalidateUserDailyGoalsForSettingsChange: (...args: unknown[]) =>
    mockInvalidateUserDailyGoalsForSettingsChange(...args),
}));

vi.mock("@/lib/date-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date-utils")>();
  return { ...actual, getTodayDate: () => "2026-05-08" };
});

const { GET, PATCH } = await import("@/app/api/daily-goals-settings/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(validSession);
});

describe("GET /api/daily-goals-settings", () => {
  it("returns goal settings with numeric values for authenticated user", async () => {
    mockGetUserGoalSettings.mockResolvedValue({
      activityLevel: "light",
      goalWeightKg: 75.0,
      goalRateKgPerWeek: 0.5,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      activityLevel: "light",
      goalWeightKg: 75.0,
      goalRateKgPerWeek: 0.5,
    });
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(mockGetUserGoalSettings).toHaveBeenCalledWith("user-uuid-123");
  });

  it("returns null for unset goal settings fields", async () => {
    mockGetUserGoalSettings.mockResolvedValue({
      activityLevel: null,
      goalWeightKg: null,
      goalRateKgPerWeek: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      activityLevel: null,
      goalWeightKg: null,
      goalRateKgPerWeek: null,
    });
  });

  it("casts numeric columns from strings to numbers in the response", async () => {
    // Drizzle returns numeric columns as strings — route must cast them
    mockGetUserGoalSettings.mockResolvedValue({
      activityLevel: "moderate",
      goalWeightKg: "80.50",
      goalRateKgPerWeek: "0.25",
    });

    const response = await GET();

    const body = await response.json();
    expect(typeof body.data.goalWeightKg).toBe("number");
    expect(typeof body.data.goalRateKgPerWeek).toBe("number");
    expect(body.data.goalWeightKg).toBe(80.5);
    expect(body.data.goalRateKgPerWeek).toBe(0.25);
  });

  it("returns 401 for unauthenticated request", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/daily-goals-settings", () => {
  it("accepts a full valid update and persists all three fields", async () => {
    mockUpdateUserGoalSettings.mockResolvedValue({
      activityLevel: "light",
      goalWeightKg: 75.0,
      goalRateKgPerWeek: 0.5,
    });

    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityLevel: "light", goalWeightKg: 75.0, goalRateKgPerWeek: 0.5 }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      activityLevel: "light",
      goalWeightKg: 75.0,
      goalRateKgPerWeek: 0.5,
    });
    expect(mockUpdateUserGoalSettings).toHaveBeenCalledWith("user-uuid-123", {
      activityLevel: "light",
      goalWeightKg: 75.0,
      goalRateKgPerWeek: 0.5,
    });
    expect(mockInvalidateUserDailyGoalsForSettingsChange).toHaveBeenCalledWith(
      "user-uuid-123",
      "2026-05-08",
    );
  });

  it("accepts a partial update — only provided fields are updated", async () => {
    mockUpdateUserGoalSettings.mockResolvedValue({
      activityLevel: "moderate",
      goalWeightKg: null,
      goalRateKgPerWeek: null,
    });

    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityLevel: "moderate" }),
      }),
    );

    expect(response.status).toBe(200);
    // Only activityLevel should be in the update call
    expect(mockUpdateUserGoalSettings).toHaveBeenCalledWith("user-uuid-123", {
      activityLevel: "moderate",
    });
    // The other fields are NOT passed — retains prior values
    const callArg = mockUpdateUserGoalSettings.mock.calls[0][1] as Record<string, unknown>;
    expect("goalWeightKg" in callArg).toBe(false);
    expect("goalRateKgPerWeek" in callArg).toBe(false);
  });

  it("returns 400 VALIDATION_ERROR for invalid activityLevel", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityLevel: "super_active" }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for goalWeightKg <= 0", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalWeightKg: -5 }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // FOO-1061: boundary value — goalRateKgPerWeek = 0 must be ACCEPTED (impl uses v < 0)
  // This represents the MAINTAIN direction reachable via the API.
  it("accepts goalRateKgPerWeek = 0 (boundary — MAINTAIN direction)", async () => {
    mockUpdateUserGoalSettings.mockResolvedValue({
      activityLevel: null,
      goalWeightKg: null,
      goalRateKgPerWeek: 0,
    });

    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalRateKgPerWeek: 0 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdateUserGoalSettings).toHaveBeenCalledWith("user-uuid-123", {
      goalRateKgPerWeek: 0,
    });
    const body = await response.json();
    expect(body.data.goalRateKgPerWeek).toBe(0);
  });

  // FOO-1057: boundary value — goalWeightKg = 0 must be rejected (impl uses v <= 0)
  it("returns 400 VALIDATION_ERROR for goalWeightKg = 0 (boundary)", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalWeightKg: 0 }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // FOO-1050: typeof [] === "object" — array body must be rejected
  it("returns 400 VALIDATION_ERROR for JSON array body", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ activityLevel: "light" }]),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for goalRateKgPerWeek < 0", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalRateKgPerWeek: -0.5 }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  // FOO-1059: empty body `{}` should short-circuit — no invalidation, no DB write
  it("short-circuits empty body without invalidating daily goals", async () => {
    mockGetUserGoalSettings.mockResolvedValue({
      activityLevel: "light",
      goalWeightKg: 75.0,
      goalRateKgPerWeek: 0.5,
    });

    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      activityLevel: "light",
      goalWeightKg: 75.0,
      goalRateKgPerWeek: 0.5,
    });
    expect(mockUpdateUserGoalSettings).not.toHaveBeenCalled();
    expect(mockInvalidateUserDailyGoalsForSettingsChange).not.toHaveBeenCalled();
  });

  // FOO-1058: upper-bound validation — extreme finite values must be rejected
  it("returns 400 VALIDATION_ERROR for goalWeightKg > 500", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalWeightKg: 501 }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 VALIDATION_ERROR for goalRateKgPerWeek > 5", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalRateKgPerWeek: 5.1 }),
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts goalWeightKg = 500 (upper boundary)", async () => {
    mockUpdateUserGoalSettings.mockResolvedValue({
      activityLevel: null,
      goalWeightKg: 500,
      goalRateKgPerWeek: null,
    });

    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalWeightKg: 500 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdateUserGoalSettings).toHaveBeenCalledWith("user-uuid-123", { goalWeightKg: 500 });
  });

  it("accepts goalRateKgPerWeek = 5 (upper boundary)", async () => {
    mockUpdateUserGoalSettings.mockResolvedValue({
      activityLevel: null,
      goalWeightKg: null,
      goalRateKgPerWeek: 5,
    });

    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalRateKgPerWeek: 5 }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockUpdateUserGoalSettings).toHaveBeenCalledWith("user-uuid-123", {
      goalRateKgPerWeek: 5,
    });
  });

  it("returns 400 VALIDATION_ERROR for invalid JSON body", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not valid json {{{",
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 for unauthenticated request", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await PATCH(
      new Request("http://localhost/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityLevel: "light" }),
      }),
    );

    expect(response.status).toBe(401);
  });
});
