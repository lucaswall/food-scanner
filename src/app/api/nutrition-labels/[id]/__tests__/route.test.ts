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

const mockDeleteLabel = vi.fn();
vi.mock("@/lib/nutrition-labels", () => ({
  deleteLabel: (...args: unknown[]) => mockDeleteLabel(...args),
}));

const { DELETE } = await import("@/app/api/nutrition-labels/[id]/route");

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
});

describe("DELETE /api/nutrition-labels/[id]", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await DELETE(
      new Request("http://localhost:3000/api/nutrition-labels/1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 200 with deleted: true on successful delete", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockDeleteLabel.mockResolvedValue(true);

    const response = await DELETE(
      new Request("http://localhost:3000/api/nutrition-labels/5", { method: "DELETE" }),
      { params: Promise.resolve({ id: "5" }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(true);
    expect(mockDeleteLabel).toHaveBeenCalledWith("user-uuid-123", 5);
  });

  it("returns 404 when label not found or wrong user", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockDeleteLabel.mockResolvedValue(false);

    const response = await DELETE(
      new Request("http://localhost:3000/api/nutrition-labels/99", { method: "DELETE" }),
      { params: Promise.resolve({ id: "99" }) },
    );

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid id (non-numeric)", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const response = await DELETE(
      new Request("http://localhost:3000/api/nutrition-labels/abc", { method: "DELETE" }),
      { params: Promise.resolve({ id: "abc" }) },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 on unexpected error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockDeleteLabel.mockRejectedValue(new Error("DB error"));

    const response = await DELETE(
      new Request("http://localhost:3000/api/nutrition-labels/1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "1" }) },
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
