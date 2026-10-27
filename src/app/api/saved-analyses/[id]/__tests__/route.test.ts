import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

const mockGetSession = vi.fn();
const mockValidateSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

const mockGetSavedAnalysis = vi.fn();
const mockDeleteSavedAnalysis = vi.fn();

vi.mock("@/lib/saved-analyses", () => ({
  getSavedAnalysis: (...args: unknown[]) => mockGetSavedAnalysis(...args),
  deleteSavedAnalysis: (...args: unknown[]) => mockDeleteSavedAnalysis(...args),
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

const { GET, DELETE } = await import("@/app/api/saved-analyses/[id]/route");

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function getRequest(id = "7"): Request {
  return new Request(`http://localhost:3000/api/saved-analyses/${id}`);
}

function deleteRequest(id = "7"): Request {
  return new Request(`http://localhost:3000/api/saved-analyses/${id}`, { method: "DELETE" });
}

const savedAnalysis = {
  id: 7,
  description: "Grilled chicken",
  calories: 350,
  createdAt: "2026-02-10T12:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateSession.mockReturnValue(null);
  mockGetSession.mockResolvedValue({ sessionId: "test-session", userId: "user-uuid-123" });
});

describe("GET /api/saved-analyses/[id]", () => {
  it("returns the session's auth error and never queries when unauthenticated", async () => {
    mockValidateSession.mockReturnValue(Response.json({ success: false, error: { code: "AUTH_MISSING_SESSION" } }, { status: 401 }));

    const response = await GET(getRequest(), context("7"));

    expect(response.status).toBe(401);
    expect(mockGetSavedAnalysis).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-3", "1.5", "0x10", "1e3", "12abc", "99999999999", ""])(
    "returns 400 for invalid id %j without querying",
    async (id) => {
      const response = await GET(getRequest(id), context(id));

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
      expect(mockGetSavedAnalysis).not.toHaveBeenCalled();
    },
  );

  it("scopes the lookup to the session user and returns the analysis with no-cache headers", async () => {
    mockGetSavedAnalysis.mockResolvedValue(savedAnalysis);

    const response = await GET(getRequest("7"), context("7"));

    expect(response.status).toBe(200);
    expect(mockGetSavedAnalysis).toHaveBeenCalledWith("user-uuid-123", 7);
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(response.headers.get("ETag")).toBeTruthy();
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(savedAnalysis);
  });

  it("returns 304 when If-None-Match matches the ETag", async () => {
    mockGetSavedAnalysis.mockResolvedValue(savedAnalysis);
    const first = await GET(getRequest("7"), context("7"));
    const etag = first.headers.get("ETag")!;

    const second = await GET(
      new Request("http://localhost:3000/api/saved-analyses/7", { headers: { "If-None-Match": etag } }),
      context("7"),
    );

    expect(second.status).toBe(304);
  });

  it("returns 404 when the analysis does not exist or belongs to another user", async () => {
    mockGetSavedAnalysis.mockResolvedValue(null);

    const response = await GET(getRequest("7"), context("7"));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  it("returns 500 when the lookup throws", async () => {
    mockGetSavedAnalysis.mockRejectedValue(new Error("db down"));

    const response = await GET(getRequest("7"), context("7"));

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
  });
});

describe("DELETE /api/saved-analyses/[id]", () => {
  it("returns the session's auth error and never deletes when unauthenticated", async () => {
    mockValidateSession.mockReturnValue(Response.json({ success: false, error: { code: "AUTH_MISSING_SESSION" } }, { status: 401 }));

    const response = await DELETE(deleteRequest(), context("7"));

    expect(response.status).toBe(401);
    expect(mockDeleteSavedAnalysis).not.toHaveBeenCalled();
  });

  it.each(["abc", "0", "-3", "1.5", "0x10", "1e3", "12abc", "99999999999", ""])(
    "returns 400 for invalid id %j without deleting",
    async (id) => {
      const response = await DELETE(deleteRequest(id), context(id));

      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
      expect(mockDeleteSavedAnalysis).not.toHaveBeenCalled();
    },
  );

  it("deletes scoped to the session user and returns { deleted: true }", async () => {
    mockDeleteSavedAnalysis.mockResolvedValue(true);

    const response = await DELETE(deleteRequest("7"), context("7"));

    expect(response.status).toBe(200);
    expect(mockDeleteSavedAnalysis).toHaveBeenCalledWith("user-uuid-123", 7);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ deleted: true });
  });

  it("returns 404 when nothing was deleted (missing or another user's analysis)", async () => {
    mockDeleteSavedAnalysis.mockResolvedValue(false);

    const response = await DELETE(deleteRequest("7"), context("7"));

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  it("returns 500 when the delete throws", async () => {
    mockDeleteSavedAnalysis.mockRejectedValue(new Error("db down"));

    const response = await DELETE(deleteRequest("7"), context("7"));

    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("INTERNAL_ERROR");
  });
});
