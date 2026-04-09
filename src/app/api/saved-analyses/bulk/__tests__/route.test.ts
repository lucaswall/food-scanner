import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FullSession, FoodAnalysis } from "@/types";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");
vi.stubEnv("ANTHROPIC_API_KEY", "test-api-key");

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

const { mockBulkSaveAnalyses } = vi.hoisted(() => ({
  mockBulkSaveAnalyses: vi.fn(),
}));
vi.mock("@/lib/saved-analyses", () => ({
  bulkSaveAnalyses: mockBulkSaveAnalyses,
}));

const { POST } = await import("@/app/api/saved-analyses/bulk/route");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "user-uuid-123",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

function makeValidAnalysis(overrides: Partial<FoodAnalysis> = {}): FoodAnalysis {
  return {
    food_name: "Empanada de carne",
    amount: 150,
    unit_id: 147,
    calories: 320,
    protein_g: 12,
    carbs_g: 28,
    fat_g: 18,
    fiber_g: 2,
    sodium_mg: 450,
    saturated_fat_g: null,
    trans_fat_g: null,
    sugars_g: null,
    calories_from_fat: null,
    confidence: "high",
    notes: "Standard baked empanada",
    description: "Baked beef empanada",
    keywords: ["empanada", "carne"],
    ...overrides,
  };
}

function createMockRequest(body: unknown): Request {
  return {
    json: () => Promise.resolve(body),
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/saved-analyses/bulk", () => {
  it("returns 401 without session", async () => {
    mockGetSession.mockResolvedValue(null);
    const response = await POST(createMockRequest({ items: [makeValidAnalysis()] }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("AUTH_MISSING_SESSION");
  });

  it("returns 400 with empty array", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const response = await POST(createMockRequest({ items: [] }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with missing items", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const response = await POST(createMockRequest({}));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with invalid items (missing required fields)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const invalidItem = { food_name: "Test", calories: "not-a-number" }; // missing many required fields
    const response = await POST(createMockRequest({ items: [invalidItem] }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 with more than 20 items", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const items = Array.from({ length: 21 }, (_, i) => makeValidAnalysis({ food_name: `Item ${i}` }));
    const response = await POST(createMockRequest({ items }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 201 with valid items, creates all saved analyses", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const items = [makeValidAnalysis(), makeValidAnalysis({ food_name: "Ensalada", calories: 120 })];
    const mockResult = [
      { id: 1, createdAt: new Date("2026-04-09T12:00:00Z") },
      { id: 2, createdAt: new Date("2026-04-09T12:00:01Z") },
    ];
    mockBulkSaveAnalyses.mockResolvedValue(mockResult);

    const response = await POST(createMockRequest({ items }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items[0].id).toBe(1);
    expect(body.data.items[1].id).toBe(2);

    expect(mockBulkSaveAnalyses).toHaveBeenCalledWith("user-uuid-123", items);
  });

  it("returns 400 when items is not an array", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const response = await POST(createMockRequest({ items: "not-an-array" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 500 when bulkSaveAnalyses throws", async () => {
    mockGetSession.mockResolvedValue(validSession);
    mockBulkSaveAnalyses.mockRejectedValue(new Error("DB error"));
    const response = await POST(createMockRequest({ items: [makeValidAnalysis()] }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
