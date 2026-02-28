import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (session: FullSession | null): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      );
    }
    return null;
  },
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const mockToggleFavorite = vi.fn();
vi.mock("@/lib/food-log", () => ({
  toggleFavorite: (...args: unknown[]) => mockToggleFavorite(...args),
}));

const { PATCH } = await import("@/app/api/custom-foods/[id]/favorite/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/custom-foods/[id]/favorite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with {isFavorite: true} when toggled to favorite", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockToggleFavorite.mockResolvedValue({ isFavorite: true });

    const request = new Request("http://localhost/api/custom-foods/42/favorite", { method: "PATCH" });
    const response = await PATCH(request, makeParams("42"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ isFavorite: true });
    expect(mockToggleFavorite).toHaveBeenCalledWith("user-uuid-123", 42);
  });

  it("returns 200 with {isFavorite: false} when toggled off", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockToggleFavorite.mockResolvedValue({ isFavorite: false });

    const request = new Request("http://localhost/api/custom-foods/42/favorite", { method: "PATCH" });
    const response = await PATCH(request, makeParams("42"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ isFavorite: false });
  });

  it("returns 404 when food not found or belongs to another user", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockToggleFavorite.mockResolvedValue(null);

    const request = new Request("http://localhost/api/custom-foods/999/favorite", { method: "PATCH" });
    const response = await PATCH(request, makeParams("999"));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = new Request("http://localhost/api/custom-foods/42/favorite", { method: "PATCH" });
    const response = await PATCH(request, makeParams("42"));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 for non-numeric ID", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = new Request("http://localhost/api/custom-foods/abc/favorite", { method: "PATCH" });
    const response = await PATCH(request, makeParams("abc"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
