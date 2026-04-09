import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-secret-that-is-at-least-32-characters-long");
vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");

const mockGetSession = vi.fn();
const mockValidateSession = vi.fn();

vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
  validateSession: (...args: unknown[]) => mockValidateSession(...args),
}));

const mockSaveAnalysis = vi.fn();
const mockGetSavedAnalyses = vi.fn();

vi.mock("@/lib/saved-analyses", () => ({
  saveAnalysis: (...args: unknown[]) => mockSaveAnalysis(...args),
  getSavedAnalyses: (...args: unknown[]) => mockGetSavedAnalyses(...args),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockValidateSession.mockReturnValue(null);
  mockGetSession.mockResolvedValue({
    sessionId: "test-session",
    userId: "user-uuid-123",
  });
});

const { GET, POST } = await import("@/app/api/saved-analyses/route");

function makeGetRequest(): Request {
  return new Request("http://localhost:3000/api/saved-analyses", {
    method: "GET",
  });
}

function makePostRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/saved-analyses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validFoodAnalysis = {
  food_name: "Grilled Chicken",
  amount: 150,
  unit_id: 147,
  calories: 250,
  protein_g: 30,
  carbs_g: 5,
  fat_g: 10,
  fiber_g: 2,
  sodium_mg: 400,
  confidence: "high",
  notes: "test",
  description: "grilled chicken breast",
  keywords: ["chicken"],
};

describe("GET /api/saved-analyses", () => {
  it("returns 401 when session is invalid", async () => {
    mockValidateSession.mockReturnValue(
      new Response(JSON.stringify({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } }), { status: 401 })
    );
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(401);
  });

  it("returns saved analyses list on success", async () => {
    const mockItems = [
      { id: 1, description: "Grilled Chicken", calories: 250, createdAt: "2026-04-08T12:00:00Z" },
    ];
    mockGetSavedAnalyses.mockResolvedValue(mockItems);
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.items).toEqual(mockItems);
    expect(mockGetSavedAnalyses).toHaveBeenCalledWith("user-uuid-123");
  });

  it("returns 500 when getSavedAnalyses throws", async () => {
    mockGetSavedAnalyses.mockRejectedValue(new Error("DB connection failed"));
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error.code).toBe("INTERNAL_ERROR");
  });
});

describe("POST /api/saved-analyses validation (FOO-908)", () => {
  it("returns 400 when amount is missing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { amount: _, ...noAmount } = validFoodAnalysis;
    const response = await POST(makePostRequest({ foodAnalysis: noAmount }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when protein_g is not a number", async () => {
    const response = await POST(
      makePostRequest({ foodAnalysis: { ...validFoodAnalysis, protein_g: "thirty" } })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when carbs_g is missing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { carbs_g: _, ...noCarbs } = validFoodAnalysis;
    const response = await POST(makePostRequest({ foodAnalysis: noCarbs }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when fat_g is missing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fat_g: _, ...noFat } = validFoodAnalysis;
    const response = await POST(makePostRequest({ foodAnalysis: noFat }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when unit_id is missing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { unit_id: _, ...noUnitId } = validFoodAnalysis;
    const response = await POST(makePostRequest({ foodAnalysis: noUnitId }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when fiber_g is missing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { fiber_g: _, ...noFiber } = validFoodAnalysis;
    const response = await POST(makePostRequest({ foodAnalysis: noFiber }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when sodium_mg is missing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sodium_mg: _, ...noSodium } = validFoodAnalysis;
    const response = await POST(makePostRequest({ foodAnalysis: noSodium }));
    expect(response.status).toBe(400);
  });

  it("returns 201 when all required fields are present", async () => {
    mockSaveAnalysis.mockResolvedValue({ id: 1, createdAt: new Date().toISOString() });
    const response = await POST(makePostRequest({ foodAnalysis: validFoodAnalysis }));
    expect(response.status).toBe(201);
  });
});
