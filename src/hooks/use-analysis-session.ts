"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { FoodAnalysis } from "@/types";
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
} from "@/lib/analysis-session";

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

interface AnalysisSessionHookState {
  description: string;
  analysis: FoodAnalysis | null;
  analysisNarrative: string | null;
  mealTypeId: number;
  selectedTime: string;
  matches: SerializedFoodMatch[];
  photos: Blob[];
}

interface AnalysisSessionActions {
  setDescription: (description: string) => void;
  setAnalysis: (analysis: FoodAnalysis | null) => void;
  setAnalysisNarrative: (narrative: string | null) => void;
  setMealTypeId: (mealTypeId: number) => void;
  setSelectedTime: (time: string) => void;
  setMatches: (matches: SerializedFoodMatch[]) => void;
  setPhotos: (photos: Blob[]) => void;
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
  description: "",
  analysis: null,
  analysisNarrative: null,
  mealTypeId: 7,
  selectedTime: "",
  matches: [],
  photos: [],
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
      const photos = await loadSessionPhotos(existingId);

      if (!cancelled) {
        setState({
          description: savedState.description,
          analysis: savedState.analysis,
          analysisNarrative: savedState.analysisNarrative,
          mealTypeId: savedState.mealTypeId,
          selectedTime: savedState.selectedTime,
          matches: savedState.matches,
          photos,
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
      const sessionState: AnalysisSessionState = {
        description: state.description,
        analysis: state.analysis,
        analysisNarrative: state.analysisNarrative,
        mealTypeId: state.mealTypeId,
        selectedTime: state.selectedTime,
        matches: state.matches,
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

  const setSelectedTime = useCallback((selectedTime: string) => {
    setState((prev) => ({ ...prev, selectedTime }));
  }, []);

  const setMatches = useCallback((matches: SerializedFoodMatch[]) => {
    setState((prev) => ({ ...prev, matches }));
  }, []);

  const setPhotos = useCallback(
    (photos: Blob[]) => {
      const id = ensureSessionId();
      setState((prev) => ({ ...prev, photos }));
      // Immediate save for photos
      saveSessionPhotos(id, photos);
    },
    [ensureSessionId]
  );

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
      setDescription,
      setAnalysis,
      setAnalysisNarrative,
      setMealTypeId,
      setSelectedTime,
      setMatches,
      setPhotos,
      clearSession: clearSessionAction,
      getActiveSessionId: getActiveSessionIdAction,
    },
    isRestoring,
    wasRestored,
  };
}
