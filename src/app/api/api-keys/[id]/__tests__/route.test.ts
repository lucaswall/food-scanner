import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (
    session: FullSession | null,
  ): Response | null => {
    if (!session) {
      return Response.json(
        { success: false, error: { code: "AUTH_MISSING_SESSION", message: "No active session" }, timestamp: Date.now() },
        { status: 401 },
      );
    }
    return null;
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockRevokeApiKey = vi.fn();
vi.mock("@/lib/api-keys", () => ({
  revokeApiKey: (...args: unknown[]) => mockRevokeApiKey(...args),
}));

const { DELETE } = await import("@/app/api/api-keys/[id]/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

function createRequest(): Request {
  return new Request("http://localhost:3000/api/api-keys/1", {
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/api-keys/[id]", () => {
  it("revokes an API key and returns success", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockRevokeApiKey.mockResolvedValue(true);

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "1" }) });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.revoked).toBe(true);
    expect(mockRevokeApiKey).toHaveBeenCalledWith("user-uuid-123", 1);
  });

  it("returns 404 when key not found or userId mismatch", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockRevokeApiKey.mockResolvedValue(false);

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "999" }) });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("not found");
  });

  it("returns 400 when id is not a valid number", async () => {
    mockGetSession.mockResolvedValue(validSession);

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "abc" }) });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("Invalid");
  });

  it("returns 401 when session is missing", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = createRequest();
    const response = await DELETE(request, { params: Promise.resolve({ id: "1" }) });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });
});
