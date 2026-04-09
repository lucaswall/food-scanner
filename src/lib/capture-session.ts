import { getDB, CAPTURE_BLOBS_STORE, _resetDBForTesting } from "@/lib/analysis-session";
import type { CaptureSession } from "@/types";

const SESSION_ID_KEY = "food-scanner-capture-session-id";
const METADATA_KEY_PREFIX = "food-scanner-capture-session:";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isIndexedDBAvailable(): boolean {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

/** @internal Reset DB singleton for test isolation */
export function _resetCaptureDBForTesting(): void {
  _resetDBForTesting();
}

export function getActiveCaptureSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_ID_KEY);
  } catch {
    return null;
  }
}

export function createCaptureSessionId(): string {
  const id = crypto.randomUUID();
  try {
    localStorage.setItem(SESSION_ID_KEY, id);
  } catch {
    // localStorage may be unavailable
  }
  return id;
}

export function saveCaptureMetadata(sessionId: string, session: CaptureSession): void {
  try {
    localStorage.setItem(METADATA_KEY_PREFIX + sessionId, JSON.stringify(session));
  } catch {
    // localStorage may be unavailable
  }
}

function isValidCaptureSession(data: unknown): data is CaptureSession {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "string") return false;
  if (!Array.isArray(d.captures)) return false;
  if (typeof d.createdAt !== "string") return false;
  return true;
}

export function loadCaptureMetadata(sessionId: string): CaptureSession | null {
  try {
    const stored = localStorage.getItem(METADATA_KEY_PREFIX + sessionId);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!isValidCaptureSession(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCaptureBlobs(sessionId: string, captureId: string, blobs: Blob[]): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  try {
    const db = await getDB();
    await db.put(CAPTURE_BLOBS_STORE, blobs, `${sessionId}:${captureId}`);
  } catch {
    // IndexedDB may fail silently
  }
}

export async function loadCaptureBlobs(sessionId: string, captureId: string): Promise<Blob[]> {
  if (!isIndexedDBAvailable()) return [];
  try {
    const db = await getDB();
    const result = await db.get(CAPTURE_BLOBS_STORE, `${sessionId}:${captureId}`);
    return result ?? [];
  } catch {
    return [];
  }
}

export async function deleteCaptureBlobs(sessionId: string, captureId: string): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  try {
    const db = await getDB();
    await db.delete(CAPTURE_BLOBS_STORE, `${sessionId}:${captureId}`);
  } catch {
    // silently fail
  }
}

export async function deleteAllCaptureBlobs(sessionId: string): Promise<void> {
  if (!isIndexedDBAvailable()) return;
  try {
    const db = await getDB();
    const prefix = `${sessionId}:`;
    const range = IDBKeyRange.bound(prefix, prefix + "\uffff");
    const keys = await db.getAllKeys(CAPTURE_BLOBS_STORE, range);
    await Promise.all(keys.map((key) => db.delete(CAPTURE_BLOBS_STORE, key)));
  } catch {
    // silently fail
  }
}

export async function clearCaptureSession(sessionId: string): Promise<void> {
  try {
    localStorage.removeItem(METADATA_KEY_PREFIX + sessionId);
    localStorage.removeItem(SESSION_ID_KEY);
  } catch {
    // localStorage may be unavailable
  }
  await deleteAllCaptureBlobs(sessionId);
}

export function isCaptureSessionExpired(session: CaptureSession): boolean {
  const created = new Date(session.createdAt).getTime();
  return Date.now() - created > TTL_MS;
}

export async function cleanupExpiredCaptures(): Promise<{ expiredCount: number }> {
  const sessionId = getActiveCaptureSessionId();
  if (!sessionId) return { expiredCount: 0 };
  const session = loadCaptureMetadata(sessionId);
  if (!session) return { expiredCount: 0 };
  if (isCaptureSessionExpired(session)) {
    const expiredCount = session.captures.length;
    await clearCaptureSession(sessionId);
    return { expiredCount };
  }
  return { expiredCount: 0 };
}
