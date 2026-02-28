import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "../route";

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

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (session: unknown) => {
    if (!session || !(session as { userId?: string }).userId) {
      return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return null;
  },
}));

const mockGetEarliestEntryDate = vi.fn();
vi.mock("@/lib/food-log", () => ({
  getEarliestEntryDate: (...args: unknown[]) => mockGetEarliestEntryDate(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/earliest-entry", () => {
  it("returns date when entries exist", async () => {
    mockGetSession.mockResolvedValue({ userId: "user-uuid-123" });
    mockGetEarliestEntryDate.mockResolvedValue("2026-01-15");

    const response = await GET(new Request("http://localhost/api/earliest-entry"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");

    const data = await response.json();
    expect(data).toEqual(expect.objectContaining({
      success: true,
      data: { date: "2026-01-15" },
    }));
    expect(data.timestamp).toBeTypeOf("number");
    expect(mockGetEarliestEntryDate).toHaveBeenCalledWith("user-uuid-123", expect.anything());
  });

  it("returns null date when no entries exist", async () => {
    mockGetSession.mockResolvedValue({ userId: "user-uuid-123" });
    mockGetEarliestEntryDate.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/earliest-entry"));

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(expect.objectContaining({
      success: true,
      data: { date: null },
    }));
    expect(data.timestamp).toBeTypeOf("number");
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/api/earliest-entry"));

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 500 when database query fails", async () => {
    mockGetSession.mockResolvedValue({ userId: "user-uuid-123" });
    mockGetEarliestEntryDate.mockRejectedValue(new Error("Database error"));

    const response = await GET(new Request("http://localhost/api/earliest-entry"));

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });

  it("returns ETag header on success response", async () => {
    mockGetSession.mockResolvedValue({ userId: "user-uuid-123" });
    mockGetEarliestEntryDate.mockResolvedValue("2026-01-15");

    const response = await GET(new Request("http://localhost/api/earliest-entry"));

    expect(response.headers.get("ETag")).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches", async () => {
    mockGetSession.mockResolvedValue({ userId: "user-uuid-123" });
    mockGetEarliestEntryDate.mockResolvedValue("2026-01-15");

    const response1 = await GET(new Request("http://localhost/api/earliest-entry"));
    const etag = response1.headers.get("ETag")!;

    mockGetSession.mockResolvedValue({ userId: "user-uuid-123" });
    mockGetEarliestEntryDate.mockResolvedValue("2026-01-15");

    const response2 = await GET(new Request("http://localhost/api/earliest-entry", {
      headers: { "if-none-match": etag },
    }));

    expect(response2.status).toBe(304);
    expect(response2.headers.get("ETag")).toBe(etag);
    expect(response2.headers.get("Cache-Control")).toBe("private, no-cache");
  });
});
