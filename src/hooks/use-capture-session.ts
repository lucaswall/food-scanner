"use client";

import type { CaptureItem } from "@/types";

interface CaptureSessionState {
  sessionId: string | null;
  captures: CaptureItem[];
  isActive: boolean;
}

interface CaptureSessionActions {
  startSession(): void;
  addCapture(images: Blob[], note: string | null): void;
  removeCapture(captureId: string): void;
  clearSession(): void;
  getCaptureBlobs(captureId: string): Promise<Blob[]>;
}

interface UseCaptureSessionReturn {
  state: CaptureSessionState;
  actions: CaptureSessionActions;
  isRestoring: boolean;
  expiredCount: number;
}

// Stub — full implementation provided by the capture storage layer (FOO-914).
// This file will be replaced at merge time.
export function useCaptureSession(): UseCaptureSessionReturn {
  throw new Error("useCaptureSession: not yet initialized");
}
