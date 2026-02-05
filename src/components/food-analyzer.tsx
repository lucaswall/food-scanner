"use client";

import { useState, useRef, useEffect } from "react";
import { PhotoCapture } from "./photo-capture";
import { DescriptionInput } from "./description-input";
import { AnalysisResult } from "./analysis-result";
import { MealTypeSelector } from "./meal-type-selector";
import { NutritionEditor } from "./nutrition-editor";
import { FoodLogConfirmation } from "./food-log-confirmation";
import { compressImage } from "@/lib/image";
import { vibrateError } from "@/lib/haptics";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { FoodAnalysis, FoodLogResponse } from "@/types";

function getDefaultMealType(): number {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return 1; // Breakfast
  if (hour >= 10 && hour < 12) return 2; // Morning Snack
  if (hour >= 12 && hour < 14) return 3; // Lunch
  if (hour >= 14 && hour < 17) return 4; // Afternoon Snack
  if (hour >= 17 && hour < 21) return 5; // Dinner
  return 7; // Anytime
}

export function FoodAnalyzer() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [analysis, setAnalysis] = useState<FoodAnalysis | null>(null);

  // Refs for focus management
  const analysisSectionRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const [editedAnalysis, setEditedAnalysis] = useState<FoodAnalysis | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [mealTypeId, setMealTypeId] = useState(getDefaultMealType());
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);

  const currentAnalysis = editedAnalysis || analysis;
  const hasEdits = editedAnalysis !== null;
  const canAnalyze = photos.length > 0 && !compressing && !loading && !logging;
  const canLog = analysis !== null && !loading && !logging;

  const handlePhotosChange = (files: File[]) => {
    setPhotos(files);
    // Clear previous analysis when photos change
    if (files.length === 0) {
      resetAnalysisState();
    }
  };

  const resetAnalysisState = () => {
    setAnalysis(null);
    setEditedAnalysis(null);
    setError(null);
    setEditMode(false);
    setLogError(null);
    setLogResponse(null);
  };

  const handleAnalyze = async () => {
    if (photos.length === 0) return;

    setCompressing(true);
    setLoadingStep("Preparing images...");
    setError(null);
    setLogError(null);

    try {
      // Compress all images
      const compressedBlobs = await Promise.all(photos.map(compressImage));

      setCompressing(false);
      setLoading(true);
      setLoadingStep("Analyzing food...");

      // Create FormData
      const formData = new FormData();
      compressedBlobs.forEach((blob, index) => {
        formData.append("images", blob, `image-${index}.jpg`);
      });
      if (description) {
        formData.append("description", description);
      }

      // Send to API
      const response = await fetch("/api/analyze-food", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setError(result.error?.message || "Failed to analyze food");
        vibrateError();
        return;
      }

      setAnalysis(result.data);
      setEditedAnalysis(null);
      setEditMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      vibrateError();
    } finally {
      setCompressing(false);
      setLoading(false);
      setLoadingStep(undefined);
    }
  };

  const handleRetry = () => {
    handleAnalyze();
  };

  const handleRegenerateClick = () => {
    if (hasEdits) {
      setShowRegenerateConfirm(true);
    } else {
      handleAnalyze();
    }
  };

  const handleConfirmRegenerate = () => {
    setShowRegenerateConfirm(false);
    handleAnalyze();
  };

  const handleLogToFitbit = async () => {
    if (!currentAnalysis) return;

    setLogging(true);
    setLogError(null);

    try {
      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...currentAnalysis,
          mealTypeId,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorCode = result.error?.code;
        if (errorCode === "FITBIT_TOKEN_INVALID") {
          setLogError("Your Fitbit session has expired. Please reconnect your Fitbit account in Settings.");
        } else {
          setLogError(result.error?.message || "Failed to log food to Fitbit");
        }
        vibrateError();
        return;
      }

      setLogResponse(result.data);
      // Note: vibrateSuccess() is called in FoodLogConfirmation on mount
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "An unexpected error occurred");
      vibrateError();
    } finally {
      setLogging(false);
    }
  };

  const handleReset = () => {
    setPhotos([]);
    setDescription("");
    resetAnalysisState();
    setMealTypeId(getDefaultMealType());
  };

  const handleEditToggle = () => {
    if (!editMode && analysis) {
      // Entering edit mode - initialize editedAnalysis
      setEditedAnalysis(analysis);
    }
    setEditMode(!editMode);
  };

  const handleExitEditMode = () => {
    if (editMode) {
      setEditMode(false);
    }
  };

  // Register keyboard shortcuts
  useKeyboardShortcuts({
    onAnalyze: handleAnalyze,
    onLogToFitbit: handleLogToFitbit,
    onExitEditMode: handleExitEditMode,
    canAnalyze,
    canLog,
    isEditing: editMode,
  });

  // Focus management: move focus to analysis section after analysis completes
  useEffect(() => {
    if (analysis && !loading && analysisSectionRef.current) {
      analysisSectionRef.current.focus();
    }
  }, [analysis, loading]);

  // Focus management: move focus to confirmation after log succeeds
  useEffect(() => {
    if (logResponse && confirmationRef.current) {
      confirmationRef.current.focus();
    }
  }, [logResponse]);

  // Show confirmation if logged successfully
  if (logResponse) {
    return (
      <div className="space-y-6">
        <div ref={confirmationRef} tabIndex={-1} className="outline-none">
          <FoodLogConfirmation
            response={logResponse}
            foodName={currentAnalysis?.food_name || "Food"}
            onReset={handleReset}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PhotoCapture onPhotosChange={handlePhotosChange} />

      <DescriptionInput value={description} onChange={setDescription} disabled={loading || logging} />

      {/* First-time user guidance */}
      {photos.length === 0 && !analysis && (
        <div
          data-testid="first-time-guidance"
          className="p-4 rounded-lg bg-muted/50 text-muted-foreground"
        >
          <p className="text-sm font-medium mb-2">How it works:</p>
          <ol className="text-sm space-y-1 list-decimal list-inside">
            <li>Take a photo of your food</li>
            <li>Add description (optional)</li>
            <li>Log to Fitbit</li>
          </ol>
        </div>
      )}

      <Button
        onClick={handleAnalyze}
        disabled={photos.length === 0 || compressing || loading || logging}
        className="w-full min-h-[44px]"
      >
        {compressing ? "Preparing images..." : loading ? "Analyzing..." : "Analyze Food"}
      </Button>

      {/* Analysis result section */}
      <div
        ref={analysisSectionRef}
        data-testid="analysis-section"
        className={analysis ? "animate-fade-in outline-none" : "outline-none"}
        tabIndex={-1}
        key={analysis ? `analysis-${analysis.food_name}-${analysis.calories}` : "no-analysis"}
      >
        {!editMode ? (
          <AnalysisResult
            analysis={analysis}
            loading={loading}
            error={error}
            onRetry={handleRetry}
            loadingStep={loadingStep}
          />
        ) : (
          currentAnalysis && (
            <NutritionEditor
              value={currentAnalysis}
              onChange={setEditedAnalysis}
              disabled={logging}
            />
          )
        )}
      </div>

      {/* Post-analysis controls */}
      {analysis && !loading && (
        <div className="space-y-4">
          {/* Edit/View toggle and Regenerate buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleEditToggle}
              variant="ghost"
              className="flex-1 min-h-[44px]"
              disabled={logging}
            >
              {editMode ? "Done Editing" : "Edit Manually"}
            </Button>
            <Button
              onClick={handleRegenerateClick}
              variant="ghost"
              className="flex-1 min-h-[44px]"
              disabled={logging}
            >
              Regenerate
            </Button>
          </div>

          {/* Meal type selector */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Meal Type</label>
            <MealTypeSelector
              value={mealTypeId}
              onChange={setMealTypeId}
              disabled={logging}
            />
          </div>

          {/* Log error display */}
          {logError && (
            <div
              data-testid="log-error"
              className="p-3 bg-red-50 border border-red-200 rounded-lg"
              aria-live="polite"
            >
              <p className="text-sm text-red-600">{logError}</p>
              {logError.includes("reconnect") && (
                <a
                  href="/settings"
                  className="text-sm text-red-700 underline mt-1 inline-block"
                >
                  Go to Settings
                </a>
              )}
            </div>
          )}

          {/* Log to Fitbit button */}
          <Button
            onClick={handleLogToFitbit}
            disabled={logging}
            className="w-full min-h-[44px]"
          >
            {logging ? "Logging..." : "Log to Fitbit"}
          </Button>
        </div>
      )}

      <AlertDialog open={showRegenerateConfirm} onOpenChange={setShowRegenerateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your edits?</AlertDialogTitle>
            <AlertDialogDescription>
              Regenerating will discard your manual edits and create a new analysis from AI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRegenerate}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
