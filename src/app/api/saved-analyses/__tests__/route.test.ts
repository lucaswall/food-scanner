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

const { POST } = await import("@/app/api/saved-analyses/route");

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

  it("returns 201 when all required fields are present", async () => {
    mockSaveAnalysis.mockResolvedValue({ id: 1, createdAt: new Date().toISOString() });
    const response = await POST(makePostRequest({ foodAnalysis: validFoodAnalysis }));
    expect(response.status).toBe(201);
  });
});
