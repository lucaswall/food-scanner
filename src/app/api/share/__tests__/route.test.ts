import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("APP_URL", "http://localhost:3000");

// Mock session module
const mockGetSession = vi.fn();
const mockValidateSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

// Mock food-log module
const mockSetShareToken = vi.fn();
vi.mock("@/lib/food-log", () => ({
  setShareToken: (...args: unknown[]) => mockSetShareToken(...args),
}));

vi.mock("@/lib/logger", () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  return {
    logger: mockLogger,
    createRequestLogger: vi.fn(() => mockLogger),
  };
});

const { POST } = await import("@/app/api/share/route");

const mockSession = {
  userId: "user-uuid-123",
  fitbitConnected: true,
  hasFitbitCredentials: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_URL", "http://localhost:3000");
  mockGetSession.mockResolvedValue(mockSession);
  mockValidateSession.mockReturnValue(null);
});

function makeRequest(body: unknown) {
  return new Request("http://localhost:3000/api/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/share", () => {
  it("returns shareUrl and shareToken for valid customFoodId", async () => {
    mockSetShareToken.mockResolvedValue("abc123xyz456");

    const response = await POST(makeRequest({ customFoodId: 42 }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.shareToken).toBe("abc123xyz456");
    expect(body.data.shareUrl).toBe("http://localhost:3000/app/log-shared/abc123xyz456");
  });

  it("returns 404 when food not found (setShareToken returns null)", async () => {
    mockSetShareToken.mockResolvedValue(null);

    const response = await POST(makeRequest({ customFoodId: 999 }));

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 401 without authentication", async () => {
    mockValidateSession.mockReturnValue(
      Response.json({ success: false, error: { code: "AUTH_MISSING_SESSION" } }, { status: 401 })
    );

    const response = await POST(makeRequest({ customFoodId: 42 }));

    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid body (missing customFoodId)", async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
  });

  it("returns 400 for non-numeric customFoodId", async () => {
    const response = await POST(makeRequest({ customFoodId: "abc" }));

    expect(response.status).toBe(400);
  });

  it("passes userId and customFoodId to setShareToken", async () => {
    mockSetShareToken.mockResolvedValue("tok");

    await POST(makeRequest({ customFoodId: 42 }));

    expect(mockSetShareToken).toHaveBeenCalledWith("user-uuid-123", 42);
  });
});
