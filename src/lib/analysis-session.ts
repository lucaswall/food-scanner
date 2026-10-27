import { openDB } from "idb";
import type { DBSchema, IDBPDatabase } from "idb";
import type { FoodAnalysis, FoodMatch, ServingUnit } from "@/types";
import { coerceServingUnit } from "@/types";

const DB_NAME = "food-scanner";
const STORE_NAME = "session-photos";
export const CAPTURE_BLOBS_STORE = "capture-blobs";
const DB_VERSION = 2;

const STATE_KEY_PREFIX = "food-scanner-analysis-session:";
const SESSION_ID_KEY = "food-scanner-session-id";
// sessionStorage (and the session id with it) dies when the tab closes, but IndexedDB photo
// blobs survive. This localStorage index (sessionId -> first-saved epoch ms) lets a later
// visit find and delete blobs whose tab is gone, without touching another open tab's session.
const PHOTO_INDEX_KEY = "food-scanner-photo-sessions";

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
  matchRatio: number;
  lastLoggedAt: string;
  amount: number;
  unitId: ServingUnit;
}

export interface AnalysisSessionState {
  description: string;
  analysis: FoodAnalysis | null;
  analysisNarrative: string | null;
  mealTypeId: number;
  selectedTime: string | null;
  matches: SerializedFoodMatch[];
  createdAt: string;
}

export interface FoodScannerDB extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: Blob[];
  };
  [CAPTURE_BLOBS_STORE]: {
    key: string;
    value: Blob[];
  };
}

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

let dbPromise: Promise<IDBPDatabase<FoodScannerDB>> | null = null;

/** @internal Reset DB singleton for test isolation */
export function _resetDBForTesting(): void {
  dbPromise = null;
}

export function getDB(): Promise<IDBPDatabase<FoodScannerDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FoodScannerDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(CAPTURE_BLOBS_STORE)) {
          db.createObjectStore(CAPTURE_BLOBS_STORE);
        }
      },
    });
  }
  return dbPromise;
}

function readPhotoIndex(): Record<string, number> {
  try {
    const raw = localStorage.getItem(PHOTO_INDEX_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writePhotoIndex(index: Record<string, number>): void {
  try {
    localStorage.setItem(PHOTO_INDEX_KEY, JSON.stringify(index));
  } catch {
    // localStorage may be unavailable
  }
}

function registerPhotoSession(sessionId: string): void {
  const index = readPhotoIndex();
  if (index[sessionId] === undefined) {
    index[sessionId] = Date.now();
    writePhotoIndex(index);
  }
}

function unregisterPhotoSession(sessionId: string): void {
  const index = readPhotoIndex();
  if (index[sessionId] !== undefined) {
    delete index[sessionId];
    writePhotoIndex(index);
  }
}

export async function saveSessionPhotos(sessionId: string, blobs: Blob[]): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  try {
    const db = await getDB();
    await db.put(STORE_NAME, blobs, sessionId);
    registerPhotoSession(sessionId);
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
  unregisterPhotoSession(sessionId);
}

/**
 * Delete photo blobs whose owning tab is gone: anything not belonging to the active session
 * that is unregistered or older than the TTL. Fresh entries are kept — they may belong to
 * another open tab.
 */
async function sweepOrphanedPhotos(): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  try {
    const activeId = getActiveSessionId();
    const index = readPhotoIndex();
    const now = Date.now();
    const db = await getDB();
    const keys = await db.getAllKeys(STORE_NAME);
    for (const key of keys) {
      const id = String(key);
      if (id === activeId) continue;
      const registeredAt = index[id];
      if (registeredAt === undefined || now - registeredAt > TTL_MS) {
        await db.delete(STORE_NAME, id);
        delete index[id];
      }
    }
    // Drop stale index entries whose blobs are already gone
    for (const [id, registeredAt] of Object.entries(index)) {
      if (id !== activeId && now - registeredAt > TTL_MS) delete index[id];
    }
    writePhotoIndex(index);
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
    typeof d.unitId === "string" && coerceServingUnit(d.unitId) === d.unitId
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
  if (d.selectedTime !== null && typeof d.selectedTime !== "string") return false;
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
  if (sessionId) {
    const state = loadSessionState(sessionId);
    if (state && isSessionExpired(state)) {
      await clearSession(sessionId);
    }
  }
  await sweepOrphanedPhotos();
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
