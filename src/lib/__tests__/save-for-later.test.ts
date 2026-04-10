import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSafeResponseJson = vi.fn();
vi.mock("@/lib/safe-json", () => ({
  safeResponseJson: (...args: unknown[]) => mockSafeResponseJson(...args),
}));

const mockInvalidateSavedAnalysesCaches = vi.fn();
vi.mock("@/lib/swr", () => ({
  invalidateSavedAnalysesCaches: () => mockInvalidateSavedAnalysesCaches(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { saveAnalysisForLater } = await import("@/lib/save-for-later");

import type { FoodAnalysis } from "@/types";

const baseAnalysis: FoodAnalysis = {
  food_name: "Test Food",
  amount: 1,
  unit_id: 304,
  calories: 200,
  protein_g: 10,
  carbs_g: 20,
  fat_g: 5,
  fiber_g: 2,
  sodium_mg: 100,
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high",
  notes: "",
  description: "A test food",
  keywords: ["test"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockInvalidateSavedAnalysesCaches.mockResolvedValue(undefined);
});

describe("saveAnalysisForLater", () => {
  it("strips sourceCustomFoodId and editingEntryId before sending", async () => {
    const analysis = { ...baseAnalysis, sourceCustomFoodId: 42, editingEntryId: 99 };
    const mockResponse = { ok: true } as Response;
    mockFetch.mockResolvedValue(mockResponse);
    mockSafeResponseJson.mockResolvedValue({ success: true, data: { id: 1 } });

    await saveAnalysisForLater(analysis);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { foodAnalysis: Partial<FoodAnalysis> };
    expect(body.foodAnalysis).not.toHaveProperty("sourceCustomFoodId");
    expect(body.foodAnalysis).not.toHaveProperty("editingEntryId");
  });

  it("POSTs to /api/saved-analyses with correct body", async () => {
    const mockResponse = { ok: true } as Response;
    mockFetch.mockResolvedValue(mockResponse);
    mockSafeResponseJson.mockResolvedValue({ success: true, data: { id: 5 } });

    await saveAnalysisForLater(baseAnalysis);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/saved-analyses",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foodAnalysis: baseAnalysis }),
      }),
    );
  });

  it("uses AbortSignal.timeout(15000)", async () => {
    const mockResponse = { ok: true } as Response;
    mockFetch.mockResolvedValue(mockResponse);
    mockSafeResponseJson.mockResolvedValue({ success: true, data: { id: 1 } });

    await saveAnalysisForLater(baseAnalysis);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(options.signal).toBeDefined();
  });

  it("uses safeResponseJson to parse the response", async () => {
    const mockResponse = { ok: true } as Response;
    mockFetch.mockResolvedValue(mockResponse);
    mockSafeResponseJson.mockResolvedValue({ success: true, data: { id: 7 } });

    await saveAnalysisForLater(baseAnalysis);

    expect(mockSafeResponseJson).toHaveBeenCalledWith(mockResponse);
  });

  it("returns { id: number } on success", async () => {
    const mockResponse = { ok: true } as Response;
    mockFetch.mockResolvedValue(mockResponse);
    mockSafeResponseJson.mockResolvedValue({ success: true, data: { id: 42 } });

    const result = await saveAnalysisForLater(baseAnalysis);

    expect(result).toEqual({ id: 42 });
  });

  it("throws descriptive error on API failure using response error message", async () => {
    const mockResponse = { ok: false } as Response;
    mockFetch.mockResolvedValue(mockResponse);
    mockSafeResponseJson.mockResolvedValue({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Invalid food analysis data" },
    });

    await expect(saveAnalysisForLater(baseAnalysis)).rejects.toThrow(
      "Invalid food analysis data",
    );
  });

  it("throws fallback error message when API fails without error message", async () => {
    const mockResponse = { ok: false } as Response;
    mockFetch.mockResolvedValue(mockResponse);
    mockSafeResponseJson.mockResolvedValue({ success: false });

    await expect(saveAnalysisForLater(baseAnalysis)).rejects.toThrow(
      "Failed to save analysis",
    );
  });

  it("throws 'Request timed out' on timeout", async () => {
    const timeoutError = new DOMException("signal timed out", "TimeoutError");
    mockFetch.mockRejectedValue(timeoutError);

    await expect(saveAnalysisForLater(baseAnalysis)).rejects.toThrow(
      "Request timed out",
    );
  });

  it("calls invalidateSavedAnalysesCaches on success", async () => {
    const mockResponse = { ok: true } as Response;
    mockFetch.mockResolvedValue(mockResponse);
    mockSafeResponseJson.mockResolvedValue({ success: true, data: { id: 3 } });

    await saveAnalysisForLater(baseAnalysis);

    expect(mockInvalidateSavedAnalysesCaches).toHaveBeenCalledOnce();
  });

  it("does NOT call invalidateSavedAnalysesCaches on failure", async () => {
    const mockResponse = { ok: false } as Response;
    mockFetch.mockResolvedValue(mockResponse);
    mockSafeResponseJson.mockResolvedValue({
      success: false,
      error: { code: "ERROR", message: "Some error" },
    });

    await expect(saveAnalysisForLater(baseAnalysis)).rejects.toThrow();
    expect(mockInvalidateSavedAnalysesCaches).not.toHaveBeenCalled();
  });
});
