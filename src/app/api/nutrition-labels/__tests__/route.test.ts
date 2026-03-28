import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, NutritionLabel } from "@/types";

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

const mockGetAllLabels = vi.fn();
vi.mock("@/lib/nutrition-labels", () => ({
  getAllLabels: (...args: unknown[]) => mockGetAllLabels(...args),
}));

const { GET } = await import("@/app/api/nutrition-labels/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

const sampleLabels: NutritionLabel[] = [
  {
    id: 1,
    userId: "user-uuid-123",
    brand: "Acme Foods",
    productName: "Granola Bar",
    variant: "Chocolate Chip",
    servingSizeG: 40,
    servingSizeLabel: "1 bar (40g)",
    calories: 180,
    proteinG: 4,
    carbsG: 28,
    fatG: 6,
    fiberG: 2,
    sodiumMg: 95,
    saturatedFatG: 2.5,
    transFatG: 0,
    sugarsG: 12,
    extraNutrients: null,
    source: "photo_scan",
    notes: null,
    createdAt: new Date("2026-03-01T10:00:00Z"),
    updatedAt: new Date("2026-03-01T10:00:00Z"),
  },
  {
    id: 2,
    userId: "user-uuid-123",
    brand: "Healthy Co",
    productName: "Protein Powder",
    variant: null,
    servingSizeG: 30,
    servingSizeLabel: "1 scoop (30g)",
    calories: 120,
    proteinG: 25,
    carbsG: 3,
    fatG: 1,
    fiberG: 0,
    sodiumMg: 150,
    saturatedFatG: null,
    transFatG: null,
    sugarsG: 1,
    extraNutrients: null,
    source: "photo_scan",
    notes: null,
    createdAt: new Date("2026-03-02T10:00:00Z"),
    updatedAt: new Date("2026-03-02T10:00:00Z"),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/nutrition-labels", () => {
  it("returns 401 for missing session", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost:3000/api/nutrition-labels"));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 200 with list of labels for authenticated user", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetAllLabels.mockResolvedValue(sampleLabels);

    const response = await GET(new Request("http://localhost:3000/api/nutrition-labels"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(mockGetAllLabels).toHaveBeenCalledWith("user-uuid-123", undefined);
  });

  it("returns 200 with empty array when no labels", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetAllLabels.mockResolvedValue([]);

    const response = await GET(new Request("http://localhost:3000/api/nutrition-labels"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it("supports ?q=search_term filtering", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetAllLabels.mockResolvedValue([sampleLabels[0]]);

    const response = await GET(new Request("http://localhost:3000/api/nutrition-labels?q=granola"));

    expect(response.status).toBe(200);
    expect(mockGetAllLabels).toHaveBeenCalledWith("user-uuid-123", "granola");
  });

  it("sets Cache-Control: private, no-cache header", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetAllLabels.mockResolvedValue([]);

    const response = await GET(new Request("http://localhost:3000/api/nutrition-labels"));

    expect(response.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns 500 on unexpected error", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetAllLabels.mockRejectedValue(new Error("DB connection failed"));

    const response = await GET(new Request("http://localhost:3000/api/nutrition-labels"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("passes empty string q as undefined (ignores empty query)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockGetAllLabels.mockResolvedValue([]);

    const response = await GET(new Request("http://localhost:3000/api/nutrition-labels?q="));

    expect(response.status).toBe(200);
    expect(mockGetAllLabels).toHaveBeenCalledWith("user-uuid-123", undefined);
  });
});
