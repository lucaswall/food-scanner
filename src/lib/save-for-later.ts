import { safeResponseJson } from "@/lib/safe-json";
import { invalidateSavedAnalysesCaches } from "@/lib/swr";
import type { FoodAnalysis } from "@/types";

export async function saveAnalysisForLater(analysis: FoodAnalysis): Promise<{ id: number }> {
  // Strip transient context fields before saving
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { sourceCustomFoodId: _sourceCustomFoodId, editingEntryId: _editingEntryId, ...foodAnalysis } = analysis as FoodAnalysis & { sourceCustomFoodId?: unknown; editingEntryId?: unknown };

  try {
    const response = await fetch("/api/saved-analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foodAnalysis }),
      signal: AbortSignal.timeout(15000),
    });

    const result = (await safeResponseJson(response)) as {
      success: boolean;
      data?: { id: number };
      error?: { code: string; message: string };
    };

    if (!response.ok || !result.success) {
      throw new Error(result.error?.message || "Failed to save analysis");
    }

    await invalidateSavedAnalysesCaches();
    if (!result.data?.id) {
      throw new Error("Failed to save analysis: no ID returned");
    }
    return { id: result.data.id };
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error("Request timed out. Please try again.");
    }
    throw err;
  }
}
