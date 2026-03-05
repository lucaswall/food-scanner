import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { FoodAnalysis, FoodMatch } from "@/types";

const DB_NAME = "food-scanner";
const STORE_NAME = "session-photos";
const DB_VERSION = 1;

const STATE_KEY_PREFIX = "food-scanner-analysis-session:";
const SESSION_ID_KEY = "food-scanner-session-id";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface SerializedFoodMatch {
  customFoodId: number;
  foodName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  saturatedFatG?: number | null;
  transFatG?: number | null;
  sugarsG?: number | null;
  caloriesFromFat?: number | null;
  fitbitFoodId: number | null;
  matchRatio: number;
  lastLoggedAt: string;
  amount: number;
  unitId: number;
}

export interface AnalysisSessionState {
  description: string;
  analysis: FoodAnalysis | null;
  analysisNarrative: string | null;
  mealTypeId: number;
  selectedTime: string;
  matches: SerializedFoodMatch[];
  createdAt: string;
}

interface FoodScannerDB extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: Blob[];
  };
}

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

let dbPromise: Promise<IDBPDatabase<FoodScannerDB>> | null = null;

function getDB(): Promise<IDBPDatabase<FoodScannerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FoodScannerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export async function saveSessionPhotos(sessionId: string, blobs: Blob[]): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  try {
    const db = await getDB();
    await db.put(STORE_NAME, blobs, sessionId);
  } catch {
    // IndexedDB may fail silently
  }
}

export async function loadSessionPhotos(sessionId: string): Promise<Blob[]> {
  if (!isIndexedDBAvailable()) return [];
  try {
    const db = await getDB();
    const result = await db.get(STORE_NAME, sessionId);
    return result ?? [];
  } catch {
    return [];
  }
}

async function deleteSessionPhotos(sessionId: string): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  try {
    const db = await getDB();
    await db.delete(STORE_NAME, sessionId);
  } catch {
    // silently fail
  }
}

function isValidSerializedMatch(m: unknown): m is SerializedFoodMatch {
  if (typeof m !== "object" || m === null) return false;
  const d = m as Record<string, unknown>;
  return (
    typeof d.customFoodId === "number" &&
    typeof d.foodName === "string" &&
    typeof d.calories === "number" &&
    typeof d.proteinG === "number" &&
    typeof d.carbsG === "number" &&
    typeof d.fatG === "number" &&
    typeof d.matchRatio === "number" &&
    typeof d.lastLoggedAt === "string" &&
    typeof d.amount === "number" &&
    typeof d.unitId === "number"
  );
}

function isValidAnalysis(analysis: unknown): analysis is FoodAnalysis {
  if (analysis === null) return true;
  if (typeof analysis !== "object" || analysis === undefined) return false;
  const a = analysis as Record<string, unknown>;
  return typeof a.food_name === "string" && typeof a.calories === "number";
}

function isValidSessionState(data: unknown): data is AnalysisSessionState {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (typeof d.description !== "string") return false;
  if (!isValidAnalysis(d.analysis)) return false;
  if (d.analysisNarrative !== null && typeof d.analysisNarrative !== "string") return false;
  if (typeof d.mealTypeId !== "number") return false;
  if (typeof d.selectedTime !== "string") return false;
  if (!Array.isArray(d.matches)) return false;
  if (!d.matches.every(isValidSerializedMatch)) return false;
  if (typeof d.createdAt !== "string") return false;
  return true;
}

export function saveSessionState(sessionId: string, state: AnalysisSessionState): void {
  try {
    sessionStorage.setItem(STATE_KEY_PREFIX + sessionId, JSON.stringify(state));
  } catch {
    // sessionStorage may be unavailable
  }
}

export function loadSessionState(sessionId: string): AnalysisSessionState | null {
  try {
    const stored = sessionStorage.getItem(STATE_KEY_PREFIX + sessionId);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!isValidSessionState(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearSession(sessionId: string): Promise<void> {
  try {
    sessionStorage.removeItem(STATE_KEY_PREFIX + sessionId);
    sessionStorage.removeItem(SESSION_ID_KEY);
  } catch {
    // sessionStorage may be unavailable
  }
  await deleteSessionPhotos(sessionId);
}

export function getActiveSessionId(): string | null {
  try {
    return sessionStorage.getItem(SESSION_ID_KEY);
  } catch {
    return null;
  }
}

export function createSessionId(): string {
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(SESSION_ID_KEY, id);
  } catch {
    // sessionStorage may be unavailable
  }
  return id;
}

export function isSessionExpired(state: AnalysisSessionState): boolean {
  const created = new Date(state.createdAt).getTime();
  return Date.now() - created > TTL_MS;
}

export async function cleanupExpiredSession(): Promise<void> {
  const sessionId = getActiveSessionId();
  if (!sessionId) return;
  const state = loadSessionState(sessionId);
  if (!state) return;
  if (isSessionExpired(state)) {
    await clearSession(sessionId);
  }
}

export function serializeFoodMatch(match: FoodMatch): SerializedFoodMatch {
  return {
    customFoodId: match.customFoodId,
    foodName: match.foodName,
    calories: match.calories,
    proteinG: match.proteinG,
    carbsG: match.carbsG,
    fatG: match.fatG,
    saturatedFatG: match.saturatedFatG,
    transFatG: match.transFatG,
    sugarsG: match.sugarsG,
    caloriesFromFat: match.caloriesFromFat,
    fitbitFoodId: match.fitbitFoodId,
    matchRatio: match.matchRatio,
    lastLoggedAt: match.lastLoggedAt instanceof Date ? match.lastLoggedAt.toISOString() : String(match.lastLoggedAt),
    amount: match.amount,
    unitId: match.unitId,
  };
}

export function deserializeFoodMatch(match: SerializedFoodMatch): FoodMatch {
  return {
    ...match,
    lastLoggedAt: new Date(match.lastLoggedAt),
  };
}
