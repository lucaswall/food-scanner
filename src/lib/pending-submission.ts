import type { FoodAnalysis } from "@/types";

const STORAGE_KEY = "food-scanner-pending-submission";

export interface PendingSubmission {
  analysis: FoodAnalysis | null;
  mealTypeId: number;
  foodName: string;
  reuseCustomFoodId?: number;
}

export function savePendingSubmission(data: PendingSubmission): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // sessionStorage may be unavailable in SSR or private browsing
  }
}

export function getPendingSubmission(): PendingSubmission | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as PendingSubmission;
  } catch {
    return null;
  }
}

export function clearPendingSubmission(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage may be unavailable
  }
}
