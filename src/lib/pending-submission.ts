import type { FoodAnalysis } from "@/types";

const STORAGE_KEY = "food-scanner-pending-submission";

export interface PendingSubmission {
  analysis: FoodAnalysis | null;
  mealTypeId: number;
  foodName: string;
  reuseCustomFoodId?: number;
  date?: string;
  time?: string;
}

function isValidAnalysis(analysis: unknown): analysis is FoodAnalysis {
  if (analysis === null) return true;
  if (typeof analysis !== "object" || analysis === undefined) return false;
  const a = analysis as Record<string, unknown>;
  return typeof a.food_name === "string" && typeof a.calories === "number";
}

function isValidPendingSubmission(data: unknown): data is PendingSubmission {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (typeof d.mealTypeId !== "number") return false;
  if (typeof d.foodName !== "string") return false;
  if (!isValidAnalysis(d.analysis)) return false;
  if (d.reuseCustomFoodId !== undefined && typeof d.reuseCustomFoodId !== "number") return false;
  if (d.date !== undefined && typeof d.date !== "string") return false;
  if (d.time !== undefined && typeof d.time !== "string") return false;
  return true;
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
    const parsed: unknown = JSON.parse(stored);
    if (!isValidPendingSubmission(parsed)) return null;
    return parsed;
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
