"use client";

import { useState, useRef, useEffect } from "react";
import { PhotoCapture } from "./photo-capture";
import { DescriptionInput } from "./description-input";
import { AnalysisResult } from "./analysis-result";
import { MealTypeSelector } from "./meal-type-selector";
import { FoodLogConfirmation } from "./food-log-confirmation";
import { FoodMatchCard } from "./food-match-card";
import { compressImage } from "@/lib/image";
import { vibrateError } from "@/lib/haptics";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2 } from "lucide-react";
import {
  savePendingSubmission,
  getPendingSubmission,
  clearPendingSubmission,
} from "@/lib/pending-submission";
import { getDefaultMealType, getLocalDateTime } from "@/lib/meal-type";
import type { FoodAnalysis, FoodLogResponse, FoodMatch } from "@/types";

export function FoodAnalyzer() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [analysis, setAnalysis] = useState<FoodAnalysis | null>(null);

  // Refs for focus management
  const analysisSectionRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const [compressing, setCompressing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [mealTypeId, setMealTypeId] = useState(getDefaultMealType());
  const [logging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);
  const [matches, setMatches] = useState<FoodMatch[]>([]);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitFoodName, setResubmitFoodName] = useState<string | null>(null);
  const [correction, setCorrection] = useState("");
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [compressedImages, setCompressedImages] = useState<Blob[] | null>(null);

  const canAnalyze = (photos.length > 0 || description.trim().length > 0) && !compressing && !loading && !logging;
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
    setError(null);
    setLogError(null);
    setLogResponse(null);
    setMatches([]);
    setCorrection("");
    setRefineError(null);
    setCompressedImages(null);
  };

  const handleAnalyze = async () => {
    if (photos.length === 0 && !description.trim()) return;

    setError(null);
    setLogError(null);
    setRefineError(null);

    let compressedBlobs: Blob[] = [];

    if (photos.length > 0) {
      setCompressing(true);
      setLoadingStep("Preparing images...");

      try {
        compressedBlobs = await Promise.all(photos.map(compressImage));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to compress images");
        vibrateError();
        setCompressing(false);
        setLoadingStep(undefined);
        return;
      }

      setCompressing(false);
    }

    setCompressedImages(compressedBlobs);
    setLoading(true);
    setLoadingStep("Analyzing food...");

    try {
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

      // Fire async match search (non-blocking)
      fetch("/api/find-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      })
        .then((r) => r.json())
        .then((matchResult) => {
          if (matchResult.success && matchResult.data?.matches) {
            setMatches(matchResult.data.matches);
          }
        })
        .catch(() => {
          // Silently ignore match errors — matching is optional
        });
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

  const handleRefine = async () => {
    if (!analysis || !correction.trim()) return;

    setRefining(true);
    setRefineError(null);

    try {
      const formData = new FormData();
      if (compressedImages) {
        compressedImages.forEach((blob, index) => {
          formData.append("images", blob, `image-${index}.jpg`);
        });
      }
      formData.append("previousAnalysis", JSON.stringify(analysis));
      formData.append("correction", correction.trim());

      const response = await fetch("/api/refine-food", {
        method: "POST",
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setRefineError(result.error?.message || "Failed to refine analysis");
        return;
      }

      setAnalysis(result.data);
      setCorrection("");
      setRefineError(null);

      // Re-fetch food matches since keywords may change
      fetch("/api/find-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      })
        .then((r) => r.json())
        .then((matchResult) => {
          if (matchResult.success && matchResult.data?.matches) {
            setMatches(matchResult.data.matches);
          }
        })
        .catch(() => {
          // Silently ignore match errors — matching is optional
        });
    } catch (err) {
      setRefineError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      setRefining(false);
    }
  };

  const handleLogToFitbit = async () => {
    if (!analysis) return;

    setLogError(null);

    // Optimistic: show confirmation immediately
    const optimisticResponse: FoodLogResponse = {
      success: true,
      reusedFood: false,
      foodLogId: 0,
    };
    setLogResponse(optimisticResponse);

    try {
      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...analysis,
          mealTypeId,
          ...getLocalDateTime(),
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorCode = result.error?.code;
        // Revert optimistic update
        setLogResponse(null);
        if (errorCode === "FITBIT_TOKEN_INVALID") {
          savePendingSubmission({
            analysis: analysis,
            mealTypeId,
            foodName: analysis.food_name,
            ...getLocalDateTime(),
          });
          window.location.href = "/api/auth/fitbit";
          return;
        } else {
          setLogError(result.error?.message || "Failed to log food to Fitbit");
        }
        vibrateError();
        return;
      }

      // Replace optimistic response with real data
      setLogResponse(result.data);
    } catch (err) {
      // Revert optimistic update
      setLogResponse(null);
      setLogError(err instanceof Error ? err.message : "An unexpected error occurred");
      vibrateError();
    }
  };

  const handleUseExisting = async (match: FoodMatch) => {
    setLogError(null);

    // Optimistic: show confirmation immediately
    const optimisticResponse: FoodLogResponse = {
      success: true,
      reusedFood: true,
      foodLogId: 0,
    };
    setLogResponse(optimisticResponse);

    try {
      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reuseCustomFoodId: match.customFoodId,
          mealTypeId,
          ...getLocalDateTime(),
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorCode = result.error?.code;
        // Revert optimistic update
        setLogResponse(null);
        if (errorCode === "FITBIT_TOKEN_INVALID") {
          savePendingSubmission({
            analysis: null,
            mealTypeId,
            foodName: match.foodName,
            reuseCustomFoodId: match.customFoodId,
            ...getLocalDateTime(),
          });
          window.location.href = "/api/auth/fitbit";
          return;
        } else {
          setLogError(result.error?.message || "Failed to log food to Fitbit");
        }
        vibrateError();
        return;
      }

      // Replace optimistic response with real data
      setLogResponse(result.data);
    } catch (err) {
      // Revert optimistic update
      setLogResponse(null);
      setLogError(err instanceof Error ? err.message : "An unexpected error occurred");
      vibrateError();
    }
  };

  // Register keyboard shortcuts
  useKeyboardShortcuts({
    onAnalyze: handleAnalyze,
    onLogToFitbit: handleLogToFitbit,
    canAnalyze,
    canLog,
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

  // Auto-resubmit pending submission after Fitbit reconnect
  useEffect(() => {
    const pending = getPendingSubmission();
    if (!pending) return;

    setResubmitting(true);
    setResubmitFoodName(pending.foodName);
    setMealTypeId(pending.mealTypeId);

    const dateTime = pending.date && pending.time
      ? { date: pending.date, time: pending.time }
      : getLocalDateTime();
    const body: Record<string, unknown> = { mealTypeId: pending.mealTypeId, ...dateTime };
    if (pending.reuseCustomFoodId) {
      body.reuseCustomFoodId = pending.reuseCustomFoodId;
    } else if (pending.analysis) {
      Object.assign(body, pending.analysis);
    }

    fetch("/api/log-food", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((result) => {
        clearPendingSubmission();
        if (result.success) {
          setLogResponse(result.data);
        } else {
          setLogError(result.error?.message || "Failed to resubmit food log");
        }
      })
      .catch(() => {
        clearPendingSubmission();
        setLogError("Failed to resubmit food log");
      })
      .finally(() => {
        setResubmitting(false);
      });
  }, []);

  // Show resubmitting state
  if (resubmitting) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <p className="text-sm text-muted-foreground">
          Reconnected! Resubmitting {resubmitFoodName ?? "food"}...
        </p>
      </div>
    );
  }

  // Show confirmation if logged successfully
  if (logResponse) {
    return (
      <div className="space-y-6">
        <div ref={confirmationRef} tabIndex={-1} className="outline-none">
          <FoodLogConfirmation
            response={logResponse}
            foodName={analysis?.food_name || "Food"}
            analysis={analysis ?? undefined}
            mealTypeId={mealTypeId}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Resubmit error (shown when no analysis context) */}
      {logError && !analysis && (
        <div
          data-testid="log-error"
          className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
          aria-live="polite"
        >
          <p className="text-sm text-destructive">{logError}</p>
        </div>
      )}

      <PhotoCapture onPhotosChange={handlePhotosChange} />

      <DescriptionInput value={description} onChange={setDescription} disabled={loading || logging} />

      {/* First-time user guidance */}
      {photos.length === 0 && !description.trim() && !analysis && (
        <div
          data-testid="first-time-guidance"
          className="p-4 rounded-lg bg-muted/50 text-muted-foreground"
        >
          <p className="text-sm font-medium mb-2">How it works:</p>
          <ol className="text-sm space-y-1 list-decimal list-inside">
            <li>Take a photo or describe your food</li>
            <li>Add details (optional)</li>
            <li>Log to Fitbit</li>
          </ol>
        </div>
      )}

      <Button
        onClick={handleAnalyze}
        disabled={!canAnalyze}
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
        <AnalysisResult
          analysis={analysis}
          loading={loading}
          error={error}
          onRetry={handleRetry}
          loadingStep={loadingStep}
        />
      </div>

      {/* Food matches section */}
      {analysis && !loading && matches.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Similar foods you&apos;ve logged before</p>
          {matches.slice(0, 3).map((match) => (
            <FoodMatchCard
              key={match.customFoodId}
              match={match}
              onSelect={handleUseExisting}
              disabled={logging}
            />
          ))}
        </div>
      )}

      {/* Post-analysis controls */}
      {analysis && !loading && (
        <div className="space-y-4">
          {/* Refining indicator */}
          {refining && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Refining analysis...</span>
            </div>
          )}

          {/* Correction input */}
          <div className="flex gap-2">
            <Input
              placeholder="Correct something..."
              value={correction}
              onChange={(e) => setCorrection(e.target.value)}
              disabled={logging || refining}
              onKeyDown={(e) =>
                e.key === "Enter" && correction.trim() && !refining && !logging && handleRefine()
              }
              className="flex-1 min-h-[44px]"
            />
            <Button
              onClick={handleRefine}
              disabled={!correction.trim() || logging || refining}
              variant="outline"
              className="min-h-[44px]"
              aria-label="Send correction"
            >
              {refining ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Refine error display */}
          {refineError && (
            <div
              className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
              aria-live="polite"
            >
              <p className="text-sm text-destructive">{refineError}</p>
            </div>
          )}

          {/* Re-analyze button */}
          <Button
            onClick={handleAnalyze}
            variant="ghost"
            className="w-full min-h-[44px]"
            disabled={logging || refining}
          >
            Re-analyze
          </Button>

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
              className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
              aria-live="polite"
            >
              <p className="text-sm text-destructive">{logError}</p>
              {logError.includes("reconnect") && (
                <a
                  href="/settings"
                  className="text-sm text-destructive underline mt-1 inline-block"
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
            {logging ? "Logging..." : matches.length > 0 ? "Log as new" : "Log to Fitbit"}
          </Button>
        </div>
      )}
    </div>
  );
}
