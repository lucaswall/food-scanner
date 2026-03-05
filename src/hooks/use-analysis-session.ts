"use client";

import { useState } from "react";
import { getDefaultMealType } from "@/lib/meal-type";
import type { FoodAnalysis, FoodMatch } from "@/types";

interface AnalysisSessionState {
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
  setMealTypeId: (id: number) => void;
  setSelectedTime: (time: string | null) => void;
  setMatches: (matches: FoodMatch[]) => void;
  clearSession: () => void;
  getActiveSessionId: () => string | null;
}

interface UseAnalysisSessionReturn {
  state: AnalysisSessionState;
  actions: AnalysisSessionActions;
  isRestoring: boolean;
  wasRestored: boolean;
}

// Stub implementation — will be replaced by worker-1's full implementation
export function useAnalysisSession(): UseAnalysisSessionReturn {
  const [photos, setPhotosState] = useState<File[]>([]);
  const [convertedPhotoBlobs, setConvertedPhotoBlobsState] = useState<(File | Blob)[]>([]);
  const [compressedImages, setCompressedImagesState] = useState<Blob[] | null>(null);
  const [description, setDescriptionState] = useState("");
  const [analysis, setAnalysisState] = useState<FoodAnalysis | null>(null);
  const [analysisNarrative, setAnalysisNarrativeState] = useState<string | null>(null);
  const [mealTypeId, setMealTypeIdState] = useState(getDefaultMealType());
  const [selectedTime, setSelectedTimeState] = useState<string | null>(null);
  const [matches, setMatchesState] = useState<FoodMatch[]>([]);

  return {
    state: {
      photos,
      convertedPhotoBlobs,
      compressedImages,
      description,
      analysis,
      analysisNarrative,
      mealTypeId,
      selectedTime,
      matches,
    },
    actions: {
      setPhotos: (newPhotos, convertedBlobs) => {
        setPhotosState(newPhotos);
        setConvertedPhotoBlobsState(convertedBlobs || []);
      },
      setCompressedImages: setCompressedImagesState,
      setDescription: setDescriptionState,
      setAnalysis: setAnalysisState,
      setAnalysisNarrative: setAnalysisNarrativeState,
      setMealTypeId: setMealTypeIdState,
      setSelectedTime: setSelectedTimeState,
      setMatches: setMatchesState,
      clearSession: () => {},
      getActiveSessionId: () => null,
    },
    isRestoring: false,
    wasRestored: false,
  };
}
