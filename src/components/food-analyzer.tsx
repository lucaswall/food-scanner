"use client";

import { useState } from "react";
import { PhotoCapture } from "./photo-capture";
import { DescriptionInput } from "./description-input";
import { AnalysisResult } from "./analysis-result";
import { MealTypeSelector } from "./meal-type-selector";
import { NutritionEditor } from "./nutrition-editor";
import { FoodLogConfirmation } from "./food-log-confirmation";
import { compressImage } from "@/lib/image";
import { Button } from "@/components/ui/button";
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
  const [editedAnalysis, setEditedAnalysis] = useState<FoodAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [mealTypeId, setMealTypeId] = useState(getDefaultMealType());
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);

  const currentAnalysis = editedAnalysis || analysis;

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

    setLoading(true);
    setError(null);
    setLogError(null);

    try {
      // Compress all images
      const compressedBlobs = await Promise.all(photos.map(compressImage));

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
        return;
      }

      setAnalysis(result.data);
      setEditedAnalysis(null);
      setEditMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = () => {
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
        return;
      }

      setLogResponse(result.data);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "An unexpected error occurred");
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

  // Show confirmation if logged successfully
  if (logResponse) {
    return (
      <div className="space-y-6">
        <FoodLogConfirmation
          response={logResponse}
          foodName={currentAnalysis?.food_name || "Food"}
          onReset={handleReset}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PhotoCapture onPhotosChange={handlePhotosChange} />

      <DescriptionInput value={description} onChange={setDescription} disabled={loading || logging} />

      <Button
        onClick={handleAnalyze}
        disabled={photos.length === 0 || loading || logging}
        className="w-full min-h-[44px]"
      >
        {loading ? "Analyzing..." : "Analyze Food"}
      </Button>

      {/* Analysis result section */}
      {!editMode ? (
        <AnalysisResult
          analysis={analysis}
          loading={loading}
          error={error}
          onRetry={handleRetry}
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

      {/* Post-analysis controls */}
      {analysis && !loading && (
        <div className="space-y-4">
          {/* Edit/View toggle and Regenerate buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleEditToggle}
              variant="outline"
              className="flex-1 min-h-[44px]"
              disabled={logging}
            >
              {editMode ? "Done Editing" : "Edit Manually"}
            </Button>
            <Button
              onClick={handleAnalyze}
              variant="outline"
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
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
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
    </div>
  );
}
