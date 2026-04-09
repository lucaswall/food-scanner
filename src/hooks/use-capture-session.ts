"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { compressImage } from "@/lib/image";
import {
  getActiveCaptureSessionId,
  createCaptureSessionId,
  loadCaptureMetadata,
  saveCaptureMetadata,
  saveCaptureBlobs,
  loadCaptureBlobs,
  deleteCaptureBlobs,
  clearCaptureSession,
  cleanupExpiredCaptures,
} from "@/lib/capture-session";
import type { CaptureItem, CaptureSession } from "@/types";

interface CaptureSessionState {
  sessionId: string | null;
  captures: CaptureItem[];
  isActive: boolean;
}

interface CaptureSessionActions {
  startSession: () => void;
  addCapture: (images: Blob[], note: string | null) => Promise<void>;
  removeCapture: (captureId: string) => void;
  clearSession: () => void;
  getCaptureBlobs: (captureId: string) => Promise<Blob[]>;
}

interface UseCaptureSessionReturn {
  state: CaptureSessionState;
  actions: CaptureSessionActions;
  isRestoring: boolean;
  expiredCount: number;
}

const DEFAULT_STATE: CaptureSessionState = {
  sessionId: null,
  captures: [],
  isActive: false,
};

export function useCaptureSession(): UseCaptureSessionReturn {
  const [state, setState] = useState<CaptureSessionState>(DEFAULT_STATE);
  const [isRestoring, setIsRestoring] = useState(true);
  const [expiredCount, setExpiredCount] = useState(0);
  const stateRef = useRef<CaptureSessionState>(DEFAULT_STATE);

  // Keep ref in sync
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const setStateWithRef = useCallback((newState: CaptureSessionState) => {
    stateRef.current = newState;
    setState(newState);
  }, []);

  // Restore on mount
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const { expiredCount: expired } = await cleanupExpiredCaptures();

      const sessionId = getActiveCaptureSessionId();
      if (!sessionId) {
        if (!cancelled) {
          setExpiredCount(expired);
          setIsRestoring(false);
        }
        return;
      }

      const session = loadCaptureMetadata(sessionId);
      if (!session) {
        if (!cancelled) {
          setExpiredCount(expired);
          setIsRestoring(false);
        }
        return;
      }

      if (!cancelled) {
        setExpiredCount(expired);
        const restored = { sessionId, captures: session.captures, isActive: true };
        stateRef.current = restored;
        setState(restored);
        setIsRestoring(false);
      }
    }

    restore();

    return () => {
      cancelled = true;
    };
  }, []);

  const startSession = useCallback(() => {
    const existingId = getActiveCaptureSessionId();
    if (existingId) {
      const existingSession = loadCaptureMetadata(existingId);
      if (existingSession) {
        const restored = { sessionId: existingId, captures: existingSession.captures, isActive: true };
        setStateWithRef(restored);
        return;
      }
    }
    const sessionId = createCaptureSessionId();
    const session: CaptureSession = {
      id: sessionId,
      captures: [],
      createdAt: new Date().toISOString(),
    };
    saveCaptureMetadata(sessionId, session);
    setStateWithRef({ sessionId, captures: [], isActive: true });
  }, [setStateWithRef]);

  const addCapture = useCallback(async (images: Blob[], note: string | null) => {
    const { sessionId, captures } = stateRef.current;
    if (!sessionId) return;

    // Compress all images
    const compressed = await Promise.all(images.map((img) => compressImage(img)));

    const captureId = crypto.randomUUID();
    const newCapture: CaptureItem = {
      id: captureId,
      imageCount: images.length,
      note,
      capturedAt: new Date().toISOString(),
      order: captures.length === 0 ? 0 : Math.max(...captures.map((c) => c.order)) + 1,
    };

    // Save blobs to IDB
    await saveCaptureBlobs(sessionId, captureId, compressed);

    // Update metadata
    const updatedCaptures = [...captures, newCapture];
    const existingCreatedAt = loadCaptureMetadata(sessionId)?.createdAt ?? new Date().toISOString();
    const session: CaptureSession = {
      id: sessionId,
      captures: updatedCaptures,
      createdAt: existingCreatedAt,
    };
    saveCaptureMetadata(sessionId, session);

    const newState = { ...stateRef.current, captures: updatedCaptures };
    setStateWithRef(newState);
  }, [setStateWithRef]);

  const removeCapture = useCallback((captureId: string) => {
    const { sessionId, captures } = stateRef.current;
    if (!sessionId) return;

    const updatedCaptures = captures.filter((c) => c.id !== captureId);
    const existingCreatedAt = loadCaptureMetadata(sessionId)?.createdAt ?? new Date().toISOString();
    const session: CaptureSession = {
      id: sessionId,
      captures: updatedCaptures,
      createdAt: existingCreatedAt,
    };
    saveCaptureMetadata(sessionId, session);
    deleteCaptureBlobs(sessionId, captureId);

    const newState = { ...stateRef.current, captures: updatedCaptures };
    setStateWithRef(newState);
  }, [setStateWithRef]);

  const clearSession = useCallback(() => {
    const { sessionId } = stateRef.current;
    if (sessionId) {
      clearCaptureSession(sessionId);
    }
    setStateWithRef(DEFAULT_STATE);
  }, [setStateWithRef]);

  const getCaptureBlobs = useCallback(async (captureId: string): Promise<Blob[]> => {
    const sessionId = getActiveCaptureSessionId();
    if (!sessionId) return [];
    return loadCaptureBlobs(sessionId, captureId);
  }, []);

  return {
    state,
    actions: {
      startSession,
      addCapture,
      removeCapture,
      clearSession,
      getCaptureBlobs,
    },
    isRestoring,
    expiredCount,
  };
}
