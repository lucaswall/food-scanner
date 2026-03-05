// Stub module — full implementation provided by worker-1
// These functions manage analysis session persistence in IndexedDB + sessionStorage

export function getActiveSessionId(): string | null {
  try {
    return sessionStorage.getItem("analysis-session-id");
  } catch {
    return null;
  }
}

export async function loadSessionPhotos(_sessionId: string): Promise<Blob[]> {
  return [];
}

export async function clearSession(_sessionId: string): Promise<void> {
  // no-op stub
}
