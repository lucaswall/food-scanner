"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { FoodAnalysis, FoodMatch } from "@/types";
import type { AnalysisSessionState } from "@/lib/analysis-session";
import {
  getActiveSessionId as getStoredSessionId,
  createSessionId,
  loadSessionState,
  saveSessionState,
  loadSessionPhotos,
  saveSessionPhotos,
  clearSession as clearStoredSession,
  isSessionExpired,
  cleanupExpiredSession,
} from "@/lib/analysis-session";
import { getDefaultMealType } from "@/lib/meal-type";

interface AnalysisSessionHookState {
  photos: File[];
  convertedPhotoBlobs: (File | Blob)[];
  compressedImages: Blob[] | null;
  description: string;
  analysis: FoodAnalysis | null;
  analysisNarrative: string | null;
  mealTypeId: number;
  selectedTime: string | null;
  matches: FoodMatch[];
}

interface AnalysisSessionActions {
  setPhotos: (photos: File[], convertedBlobs?: (File | Blob)[]) => void;
  setCompressedImages: (images: Blob[] | null) => void;
  setDescription: (description: string) => void;
  setAnalysis: (analysis: FoodAnalysis | null) => void;
  setAnalysisNarrative: (narrative: string | null) => void;
  setMealTypeId: (mealTypeId: number) => void;
  setSelectedTime: (time: string | null) => void;
  setMatches: (matches: FoodMatch[]) => void;
  clearSession: () => void;
  getActiveSessionId: () => string | null;
}

interface UseAnalysisSessionReturn {
  state: AnalysisSessionHookState;
  actions: AnalysisSessionActions;
  isRestoring: boolean;
  wasRestored: boolean;
}

const DEFAULT_STATE: AnalysisSessionHookState = {
  photos: [],
  convertedPhotoBlobs: [],
  compressedImages: null,
  description: "",
  analysis: null,
  analysisNarrative: null,
  mealTypeId: getDefaultMealType(),
  selectedTime: null,
  matches: [],
};

const DEBOUNCE_MS = 300;

export function useAnalysisSession(): UseAnalysisSessionReturn {
  const [state, setState] = useState<AnalysisSessionHookState>(DEFAULT_STATE);
  const [isRestoring, setIsRestoring] = useState(true);
  const [wasRestored, setWasRestored] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRestoringRef = useRef(true);

  // Restore on mount
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      // Clean up any expired sessions first
      await cleanupExpiredSession();

      const existingId = getStoredSessionId();
      if (!existingId) {
        if (!cancelled) {
          setIsRestoring(false);
          isRestoringRef.current = false;
        }
        return;
      }

      const savedState = loadSessionState(existingId);
      if (!savedState) {
        if (!cancelled) {
          setIsRestoring(false);
          isRestoringRef.current = false;
        }
        return;
      }

      if (isSessionExpired(savedState)) {
        await clearStoredSession(existingId);
        if (!cancelled) {
          setIsRestoring(false);
          isRestoringRef.current = false;
        }
        return;
      }

      sessionIdRef.current = existingId;
      const photoBlobs = await loadSessionPhotos(existingId);

      if (!cancelled) {
        // Convert serialized matches back to FoodMatch (lastLoggedAt string → Date)
        const restoredMatches: FoodMatch[] = (savedState.matches || []).map(
          (m) => ({
            ...m,
            lastLoggedAt: new Date(m.lastLoggedAt as unknown as string),
          })
        ) as unknown as FoodMatch[];

        setState({
          photos: [],
          convertedPhotoBlobs: photoBlobs,
          compressedImages: null,
          description: savedState.description,
          analysis: savedState.analysis,
          analysisNarrative: savedState.analysisNarrative,
          mealTypeId: savedState.mealTypeId,
          selectedTime: savedState.selectedTime,
          matches: restoredMatches,
        });
        setWasRestored(true);
        setIsRestoring(false);
        isRestoringRef.current = false;
      }
    }

    restore();

    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced save of serializable state
  useEffect(() => {
    if (isRestoringRef.current) return;
    if (!sessionIdRef.current) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      if (!sessionIdRef.current) return;
      // Serialize matches (Date → string for lastLoggedAt)
      const serializedMatches = state.matches.map((m) => ({
        ...m,
        lastLoggedAt: m.lastLoggedAt instanceof Date ? m.lastLoggedAt.toISOString() : m.lastLoggedAt,
      }));
      const sessionState: AnalysisSessionState = {
        description: state.description,
        analysis: state.analysis,
        analysisNarrative: state.analysisNarrative,
        mealTypeId: state.mealTypeId,
        selectedTime: state.selectedTime,
        matches: serializedMatches,
        createdAt: new Date().toISOString(),
      };
      saveSessionState(sessionIdRef.current, sessionState);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [state.description, state.analysis, state.analysisNarrative, state.mealTypeId, state.selectedTime, state.matches]);

  const ensureSessionId = useCallback((): string => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const id = createSessionId();
    sessionIdRef.current = id;
    return id;
  }, []);

  const setDescription = useCallback((description: string) => {
    setState((prev) => ({ ...prev, description }));
  }, []);

  const setAnalysis = useCallback((analysis: FoodAnalysis | null) => {
    setState((prev) => ({ ...prev, analysis }));
  }, []);

  const setAnalysisNarrative = useCallback((analysisNarrative: string | null) => {
    setState((prev) => ({ ...prev, analysisNarrative }));
  }, []);

  const setMealTypeId = useCallback((mealTypeId: number) => {
    setState((prev) => ({ ...prev, mealTypeId }));
  }, []);

  const setSelectedTime = useCallback((selectedTime: string | null) => {
    setState((prev) => ({ ...prev, selectedTime }));
  }, []);

  const setMatches = useCallback((matches: FoodMatch[]) => {
    setState((prev) => ({ ...prev, matches }));
  }, []);

  const setPhotos = useCallback(
    (photos: File[], convertedBlobs?: (File | Blob)[]) => {
      const blobs = convertedBlobs || [];
      setState((prev) => ({ ...prev, photos, convertedPhotoBlobs: blobs }));
      // Immediate save for photos — store convertedBlobs (or originals) to IndexedDB
      if (photos.length > 0) {
        const id = ensureSessionId();
        const toStore = blobs.length > 0 ? blobs : photos;
        saveSessionPhotos(id, toStore);
      }
    },
    [ensureSessionId]
  );

  const setCompressedImages = useCallback((compressedImages: Blob[] | null) => {
    setState((prev) => ({ ...prev, compressedImages }));
  }, []);

  const clearSessionAction = useCallback(async () => {
    const id = sessionIdRef.current;
    if (id) {
      await clearStoredSession(id);
    }
    sessionIdRef.current = null;
    setState(DEFAULT_STATE);
    setWasRestored(false);
  }, []);

  const getActiveSessionIdAction = useCallback((): string | null => {
    return sessionIdRef.current;
  }, []);

  return {
    state,
    actions: {
      setPhotos,
      setCompressedImages,
      setDescription,
      setAnalysis,
      setAnalysisNarrative,
      setMealTypeId,
      setSelectedTime,
      setMatches,
      clearSession: clearSessionAction,
      getActiveSessionId: getActiveSessionIdAction,
    },
    isRestoring,
    wasRestored,
  };
}
