"use client";

import { useState, useRef, useEffect } from "react";
import { PhotoCapture } from "./photo-capture";
import { DescriptionInput } from "./description-input";
import { AnalysisResult } from "./analysis-result";
import { MealTypeSelector } from "./meal-type-selector";
import { FoodLogConfirmation } from "./food-log-confirmation";
import { FoodMatchCard } from "./food-match-card";
import { FoodChat } from "./food-chat";
import { compressImage } from "@/lib/image";
import { vibrateError } from "@/lib/haptics";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MessageSquare } from "lucide-react";
import {
  savePendingSubmission,
  getPendingSubmission,
  clearPendingSubmission,
} from "@/lib/pending-submission";
import { getDefaultMealType, getLocalDateTime } from "@/lib/meal-type";
import { safeResponseJson } from "@/lib/safe-json";
import { getTodayDate } from "@/lib/date-utils";
import { parseSSEEvents } from "@/lib/sse";
import type { FoodAnalysis, FoodLogResponse, FoodMatch, ConversationMessage } from "@/types";

const TOOL_DESCRIPTIONS: Record<string, string> = {
  web_search: "Searching the web...",
  search_food_log: "Checking your food log...",
  get_nutrition_summary: "Looking up your nutrition data...",
  get_fasting_info: "Checking your fasting patterns...",
  report_nutrition: "Preparing nutrition report...",
};

interface FoodAnalyzerProps {
  autoCapture?: boolean;
}

export function FoodAnalyzer({ autoCapture }: FoodAnalyzerProps) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [convertedPhotoBlobs, setConvertedPhotoBlobs] = useState<(File | Blob)[]>([]);
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
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);
  const [matches, setMatches] = useState<FoodMatch[]>([]);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitFoodName, setResubmitFoodName] = useState<string | null>(null);
  const [compressedImages, setCompressedImages] = useState<Blob[] | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [seedMessages, setSeedMessages] = useState<ConversationMessage[] | null>(null);
  const autoCaptureUsedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const compressionWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const findMatchesGenerationRef = useRef(0);
  const textDeltaBufferRef = useRef("");

  const canAnalyze = (photos.length > 0 || description.trim().length > 0) && !compressing && !loading && !logging;
  const canLog = analysis !== null && !loading && !logging;

  const handlePhotosChange = (files: File[], convertedBlobs?: (File | Blob)[]) => {
    setPhotos(files);
    setConvertedPhotoBlobs(convertedBlobs || []);
    if (files.length > 0) {
      autoCaptureUsedRef.current = true;
    }
    // Clear previous analysis when photos change
    if (files.length === 0) {
      resetAnalysisState();
    }
  };

  const resetAnalysisState = () => {
    // Abort any in-flight analysis fetches
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Clear stale compression warning timeout to prevent it from wiping future errors
    if (compressionWarningTimeoutRef.current) {
      clearTimeout(compressionWarningTimeoutRef.current);
      compressionWarningTimeoutRef.current = null;
    }
    // Invalidate any in-flight find-matches fetch
    findMatchesGenerationRef.current += 1;
    setAnalysis(null);
    setError(null);
    setLogError(null);
    setLogResponse(null);
    setMatches([]);
    setCompressedImages(null);
    setChatOpen(false);
    setSeedMessages(null);
  };

  const handleAnalyze = async () => {
    if (photos.length === 0 && !description.trim()) return;

    setError(null);
    setLogError(null);

    let compressedBlobs: Blob[] = [];

    if (photos.length > 0) {
      setCompressing(true);
      setLoadingStep("Preparing images...");

      try {
        // Use converted blobs if available (already converted from HEIC in PhotoCapture)
        // Otherwise use original photo files
        const filesToCompress = convertedPhotoBlobs.length > 0 ? convertedPhotoBlobs : photos;
        const compressionResults = await Promise.allSettled(filesToCompress.map(compressImage));
        compressedBlobs = compressionResults
          .filter((result): result is PromiseFulfilledResult<Blob> => result.status === "fulfilled")
          .map((result) => result.value);

        const failedCount = compressionResults.filter((result) => result.status === "rejected").length;

        if (compressedBlobs.length === 0) {
          setError("All images failed to process. Please try different photos.");
          vibrateError();
          setCompressing(false);
          setLoadingStep(undefined);
          return;
        }

        if (failedCount > 0) {
          const warningMessage = failedCount === 1
            ? "1 image could not be processed and was skipped"
            : `${failedCount} images could not be processed and were skipped`;
          console.warn(warningMessage);
          // Show warning to user but continue with successful images
          setError(warningMessage);
          // Clear the warning after analysis starts
          compressionWarningTimeoutRef.current = setTimeout(() => setError(null), 3000);
        }
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
    analysisSectionRef.current?.scrollIntoView({ behavior: "smooth" });
    textDeltaBufferRef.current = "";

    // Create AbortController for this analysis
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Create FormData
      const formData = new FormData();
      compressedBlobs.forEach((blob, index) => {
        formData.append("images", blob, `image-${index}.jpg`);
      });
      if (description) {
        formData.append("description", description);
      }
      formData.append("clientDate", getTodayDate());

      // Send to API
      const response = await fetch("/api/analyze-food", {
        method: "POST",
        body: formData,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
      });

      // Validation errors return JSON; successful analysis returns SSE stream
      const contentType = response.headers?.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("text/event-stream")) {
        const result = (await safeResponseJson(response)) as {
          success: boolean;
          error?: { code: string; message: string };
        };
        // Clear compression warning timeout before setting real error
        if (compressionWarningTimeoutRef.current) {
          clearTimeout(compressionWarningTimeoutRef.current);
          compressionWarningTimeoutRef.current = null;
        }
        setError(result.error?.message || "Failed to analyze food");
        vibrateError();
        return;
      }

      // Consume SSE stream and handle events
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const { events, remaining } = parseSSEEvents(chunk, buffer);
          buffer = remaining;
          for (const event of events) {
            if (event.type === "text_delta") {
              textDeltaBufferRef.current += event.text;
              setLoadingStep(textDeltaBufferRef.current);
            } else if (event.type === "tool_start") {
              textDeltaBufferRef.current = "";
              setLoadingStep(TOOL_DESCRIPTIONS[event.tool] ?? "Processing...");
            } else if (event.type === "analysis") {
              setAnalysis(event.analysis);
              setSeedMessages(null);
              // Fire async match search (non-blocking) — skip if Claude already identified the reused food
              if (!event.analysis.sourceCustomFoodId) {
                const matchGen = findMatchesGenerationRef.current;
                fetch("/api/find-matches", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(event.analysis),
                  signal: controller.signal,
                })
                  .then((r) => r.json())
                  .then((matchResult) => {
                    // Ignore stale result if state was reset since this fetch started
                    if (findMatchesGenerationRef.current !== matchGen) return;
                    if (matchResult.success && matchResult.data?.matches) {
                      setMatches(matchResult.data.matches);
                    }
                  })
                  .catch((err) => {
                    // Silently ignore match errors and abort errors
                    if (err.name === "AbortError") return;
                  });
              }
            } else if (event.type === "needs_chat") {
              // Clear compression warning timeout before transitioning
              if (compressionWarningTimeoutRef.current) {
                clearTimeout(compressionWarningTimeoutRef.current);
                compressionWarningTimeoutRef.current = null;
              }
              // Auto-transition to chat with seeded conversation
              const userMessage = description.trim() || "Analyze this food.";
              const seeds: ConversationMessage[] = [
                { role: "user", content: userMessage },
                { role: "assistant", content: event.message },
              ];
              setSeedMessages(seeds);
              setChatOpen(true);
            } else if (event.type === "error") {
              // Clear compression warning timeout before setting real error
              if (compressionWarningTimeoutRef.current) {
                clearTimeout(compressionWarningTimeoutRef.current);
                compressionWarningTimeoutRef.current = null;
              }
              setError(event.message || "Failed to analyze food");
              vibrateError();
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === "AbortError") {
        // Clear stale compression warning timeout to prevent it from wiping future errors
        if (compressionWarningTimeoutRef.current) {
          clearTimeout(compressionWarningTimeoutRef.current);
          compressionWarningTimeoutRef.current = null;
        }
        return;
      }
      // Clear compression warning timeout before setting real error
      if (compressionWarningTimeoutRef.current) {
        clearTimeout(compressionWarningTimeoutRef.current);
        compressionWarningTimeoutRef.current = null;
      }
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      vibrateError();
    } finally {
      setCompressing(false);
      setLoading(false);
      setLoadingStep(undefined);
      abortControllerRef.current = null;
    }
  };

  const handleRetry = () => {
    handleAnalyze();
  };

  const handleLogToFitbit = async () => {
    if (!analysis) return;

    setLogError(null);
    setLogging(true);

    // Optimistic: show confirmation immediately
    const optimisticResponse: FoodLogResponse = {
      success: true,
      reusedFood: false,
      foodLogId: 0,
    };
    setLogResponse(optimisticResponse);

    try {
      const logBody: Record<string, unknown> = analysis.sourceCustomFoodId
        ? {
            reuseCustomFoodId: analysis.sourceCustomFoodId,
            mealTypeId,
            ...getLocalDateTime(),
          }
        : {
            ...analysis,
            mealTypeId,
            ...getLocalDateTime(),
          };

      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(logBody),
        signal: AbortSignal.timeout(15000),
      });

      const result = (await safeResponseJson(response)) as {
        success: boolean;
        data?: FoodLogResponse;
        error?: { code: string; message: string };
      };

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
        }
        if (errorCode === "FITBIT_CREDENTIALS_MISSING" || errorCode === "FITBIT_NOT_CONNECTED") {
          setLogError("Fitbit is not set up. Please configure your credentials in Settings.");
          vibrateError();
          return;
        }
        setLogError(result.error?.message || "Failed to log food to Fitbit");
        vibrateError();
        return;
      }

      // Replace optimistic response with real data
      setLogResponse(result.data ?? null);
    } catch (err) {
      // Revert optimistic update
      setLogResponse(null);
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setLogError("Request timed out. Please try again.");
      } else {
        setLogError(err instanceof Error ? err.message : "An unexpected error occurred");
      }
      vibrateError();
    } finally {
      setLogging(false);
    }
  };

  const handleUseExisting = async (match: FoodMatch) => {
    setLogError(null);
    setLogging(true);

    // Optimistic: show confirmation immediately
    const optimisticResponse: FoodLogResponse = {
      success: true,
      reusedFood: true,
      foodLogId: 0,
    };
    setLogResponse(optimisticResponse);

    try {
      const requestBody: Record<string, unknown> = {
        reuseCustomFoodId: match.customFoodId,
        mealTypeId,
        ...getLocalDateTime(),
      };

      // Include current analysis metadata if available
      if (analysis) {
        requestBody.newDescription = analysis.description;
        requestBody.newNotes = analysis.notes;
        requestBody.newKeywords = analysis.keywords;
        requestBody.newConfidence = analysis.confidence;
      }

      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(15000),
      });

      const result = (await safeResponseJson(response)) as {
        success: boolean;
        data?: FoodLogResponse;
        error?: { code: string; message: string };
      };

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
        }
        if (errorCode === "FITBIT_CREDENTIALS_MISSING" || errorCode === "FITBIT_NOT_CONNECTED") {
          setLogError("Fitbit is not set up. Please configure your credentials in Settings.");
          vibrateError();
          return;
        }
        setLogError(result.error?.message || "Failed to log food to Fitbit");
        vibrateError();
        return;
      }

      // Replace optimistic response with real data
      setLogResponse(result.data ?? null);
    } catch (err) {
      // Revert optimistic update
      setLogResponse(null);
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setLogError("Request timed out. Please try again.");
      } else {
        setLogError(err instanceof Error ? err.message : "An unexpected error occurred");
      }
      vibrateError();
    } finally {
      setLogging(false);
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
      signal: AbortSignal.timeout(15000),
    })
      .then((r) => safeResponseJson(r))
      .then((raw) => {
        const result = raw as {
          success: boolean;
          data?: FoodLogResponse;
          error?: { code: string; message: string };
        };
        clearPendingSubmission();
        if (result.success) {
          setLogResponse(result.data ?? null);
        } else {
          setLogError(result.error?.message || "Failed to resubmit food log");
        }
      })
      .catch((err) => {
        clearPendingSubmission();
        if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
          setLogError("Request timed out. Please try again.");
        } else {
          setLogError("Failed to resubmit food log");
        }
      })
      .finally(() => {
        setResubmitting(false);
      });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (compressionWarningTimeoutRef.current) {
        clearTimeout(compressionWarningTimeoutRef.current);
      }
    };
  }, []);

  // Show resubmitting state
  if (resubmitting) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
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

  // Show full-screen chat if open (FoodChat uses fixed positioning)
  if (chatOpen && (analysis || seedMessages)) {
    return (
      <FoodChat
        initialAnalysis={analysis ?? undefined}
        seedMessages={seedMessages ?? undefined}
        compressedImages={compressedImages || []}
        initialMealTypeId={mealTypeId}
        onClose={() => setChatOpen(false)}
        onLogged={(response, refinedAnalysis, mealTypeId) => {
          setAnalysis(refinedAnalysis);
          setLogResponse(response);
          setMealTypeId(mealTypeId);
        }}
      />
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

      <PhotoCapture onPhotosChange={handlePhotosChange} autoCapture={autoCapture && !autoCaptureUsedRef.current} />

      <DescriptionInput value={description} onChange={setDescription} disabled={loading || logging || compressing} />

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
          {/* CTA button for chat */}
          <Button
            variant="outline"
            onClick={() => setChatOpen(true)}
            className="w-full min-h-[44px] justify-start gap-2"
          >
            <MessageSquare className="h-4 w-4" />
            Refine with chat
          </Button>

          {/* Meal type selector */}
          <div className="space-y-2">
            <Label htmlFor="meal-type-analyzer">Meal Type</Label>
            <MealTypeSelector
              value={mealTypeId}
              onChange={setMealTypeId}
              disabled={logging}
              id="meal-type-analyzer"
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
              {(logError.includes("reconnect") || logError.includes("Settings")) && (
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
