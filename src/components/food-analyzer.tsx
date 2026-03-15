"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { PhotoCapture } from "./photo-capture";
import { DescriptionInput } from "./description-input";
import { AnalysisResult } from "./analysis-result";
import { MealTypeSelector } from "./meal-type-selector";
import { TimeSelector } from "./time-selector";
import { FoodLogConfirmation } from "./food-log-confirmation";
import { FoodMatchCard } from "./food-match-card";
import { FoodChat } from "./food-chat";
import { compressImage } from "@/lib/image";
import { vibrateError } from "@/lib/haptics";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useKeyboardHeight } from "@/hooks/use-keyboard-height";
import { useAnalysisSession } from "@/hooks/use-analysis-session";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { MessageSquare, RotateCcw } from "lucide-react";
import {
  savePendingSubmission,
  getPendingSubmission,
  clearPendingSubmission,
} from "@/lib/pending-submission";
import { getLocalDateTime } from "@/lib/meal-type";
import { getActiveSessionId } from "@/lib/analysis-session";
import { safeResponseJson } from "@/lib/safe-json";
import { getTodayDate } from "@/lib/date-utils";
import { parseSSEEvents } from "@/lib/sse";
import type { FoodLogResponse, FoodMatch, ConversationMessage } from "@/types";

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
  const router = useRouter();
  // Persisted state from analysis session hook
  const { state: sessionState, actions, isRestoring, wasRestored } = useAnalysisSession();
  const {
    photos,
    convertedPhotoBlobs,
    compressedImages,
    description,
    analysis,
    analysisNarrative,
    mealTypeId,
    selectedTime,
    matches,
  } = sessionState;

  // Refs for focus management
  const analysisSectionRef = useRef<HTMLDivElement>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);

  // Transient state (not persisted)
  const [compressing, setCompressing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitFoodName, setResubmitFoodName] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [seedMessages, setSeedMessages] = useState<ConversationMessage[] | null>(null);
  const [showStartOverConfirm, setShowStartOverConfirm] = useState(false);
  const [photoCaptureKey, setPhotoCaptureKey] = useState(0);
  const autoCaptureUsedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const compressionWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const findMatchesGenerationRef = useRef(0);
  const textDeltaBufferRef = useRef("");

  const keyboardHeight = useKeyboardHeight();

  const canAnalyze = (photos.length > 0 || convertedPhotoBlobs.length > 0 || description.trim().length > 0) && !compressing && !loading && !logging;
  const canLog = analysis !== null && !loading && !logging;
  const hasContent = photos.length > 0 || convertedPhotoBlobs.length > 0 || description.trim().length > 0 || analysis !== null;

  const handlePhotosChange = (files: File[], convertedBlobs?: (File | Blob)[]) => {
    actions.setPhotos(files, convertedBlobs);
    if (files.length > 0) {
      autoCaptureUsedRef.current = true;
    }
    // Clear previous analysis and persisted session when all photos removed
    if (files.length === 0) {
      resetAnalysisState();
      actions.clearSession();
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
    actions.setAnalysis(null);
    actions.setAnalysisNarrative(null);
    setStreamingText("");
    setError(null);
    setLogError(null);
    setLogResponse(null);
    actions.setMatches([]);
    actions.setCompressedImages(null);
    setChatOpen(false);
    setSeedMessages(null);
  };

  const handleStartOver = () => {
    resetAnalysisState();
    actions.setPhotos([], []);
    actions.setDescription("");
    actions.clearSession();
    setShowStartOverConfirm(false);
    setPhotoCaptureKey(k => k + 1);
  };

  const handleAnalyze = async () => {
    if (photos.length === 0 && convertedPhotoBlobs.length === 0 && !description.trim()) return;

    setError(null);
    setLogError(null);

    // Create AbortController early so Cancel works during compression
    const controller = new AbortController();
    abortControllerRef.current = controller;

    let compressedBlobs: Blob[] = [];

    if (photos.length > 0 || convertedPhotoBlobs.length > 0) {
      setCompressing(true);
      setLoadingStep("Preparing images...");

      try {
        // Use converted blobs if available (already converted from HEIC in PhotoCapture, or restored from IndexedDB)
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

    // If cancelled during compression, bail out
    if (controller.signal.aborted) {
      setCompressing(false);
      setLoadingStep(undefined);
      return;
    }

    actions.setCompressedImages(compressedBlobs);
    setLoading(true);
    setLoadingStep("Analyzing food...");
    setStreamingText("");
    analysisSectionRef.current?.scrollIntoView({ behavior: "smooth" });
    textDeltaBufferRef.current = "";

    // Manual timeout — AbortSignal.any() not available on iOS 16, Chrome <116
    const timeoutId = setTimeout(() => controller.abort(new DOMException("signal timed out", "TimeoutError")), 120000);

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
        signal: controller.signal,
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
      if (!response.body) {
        if (compressionWarningTimeoutRef.current) {
          clearTimeout(compressionWarningTimeoutRef.current);
          compressionWarningTimeoutRef.current = null;
        }
        setError("No response body");
        vibrateError();
        return;
      }
      const reader = response.body.getReader();
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
              setStreamingText(textDeltaBufferRef.current);
            } else if (event.type === "tool_start") {
              textDeltaBufferRef.current = "";
              setStreamingText("");
              setLoadingStep(TOOL_DESCRIPTIONS[event.tool] ?? "Processing...");
            } else if (event.type === "analysis") {
              actions.setAnalysis(event.analysis);
              actions.setAnalysisNarrative(textDeltaBufferRef.current.trim() || null);
              if (event.analysis.mealTypeId != null) {
                actions.setMealTypeId(event.analysis.mealTypeId);
              }
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
                      actions.setMatches(matchResult.data.matches);
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
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    } catch (err) {
      // Clear stale compression warning timeout before handling any error
      if (compressionWarningTimeoutRef.current) {
        clearTimeout(compressionWarningTimeoutRef.current);
        compressionWarningTimeoutRef.current = null;
      }
      // Ignore abort errors (user-initiated cancel)
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      // User-friendly message for timeout errors
      if (err instanceof DOMException && err.name === "TimeoutError") {
        setError("Analysis timed out. Please try again.");
        vibrateError();
        return;
      }
      // Network errors (connectivity loss, device sleep) — user-friendly message, no Sentry
      if (err instanceof TypeError && err.message.includes("network")) {
        setError("Network error. Please check your connection and try again.");
        vibrateError();
        return;
      }
      Sentry.captureException(err);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      vibrateError();
    } finally {
      clearTimeout(timeoutId);
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

    try {
      const localDateTime = getLocalDateTime();
      const logTime = selectedTime ?? localDateTime.time;
      const logBody: Record<string, unknown> = analysis.sourceCustomFoodId
        ? {
            reuseCustomFoodId: analysis.sourceCustomFoodId,
            mealTypeId,
            date: localDateTime.date,
            time: logTime,
          }
        : {
            ...analysis,
            mealTypeId,
            date: localDateTime.date,
            time: logTime,
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
        if (errorCode === "FITBIT_TOKEN_INVALID") {
          savePendingSubmission({
            analysis: analysis,
            mealTypeId,
            foodName: analysis.food_name,
            date: localDateTime.date,
            time: logTime,
            sessionId: getActiveSessionId() ?? undefined,
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

      // Only set response after API confirms success
      setLogResponse(result.data ?? null);
      actions.clearPersistedSession();
    } catch (err) {
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
        if (errorCode === "FITBIT_TOKEN_INVALID") {
          savePendingSubmission({
            analysis: null,
            mealTypeId,
            foodName: match.foodName,
            reuseCustomFoodId: match.customFoodId,
            ...getLocalDateTime(),
            sessionId: getActiveSessionId() ?? undefined,
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

      // Only set response after API confirms success
      setLogResponse(result.data ?? null);
      actions.clearPersistedSession();
    } catch (err) {
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

  const handleDone = () => {
    actions.clearSession();
    router.push("/app");
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
    actions.setMealTypeId(pending.mealTypeId);

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
  }, [actions]);

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

  // Show loading skeleton while restoring session from storage
  if (isRestoring) {
    return (
      <div data-testid="restoring-skeleton" className="space-y-6">
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
      </div>
    );
  }

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
            onDone={handleDone}
          />
        </div>
      </div>
    );
  }

  // Show full-screen chat if open — FoodChat is layout-only; the overlay is provided here
  if (chatOpen && (analysis || seedMessages)) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-background pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <FoodChat
          initialAnalysis={analysis ?? undefined}
          seedMessages={seedMessages ?? undefined}
          compressedImages={compressedImages || []}
          initialMealTypeId={mealTypeId}
          onClose={() => setChatOpen(false)}
          onLogged={(response, refinedAnalysis, chatMealTypeId) => {
            actions.setAnalysis(refinedAnalysis);
            setLogResponse(response);
            actions.setMealTypeId(chatMealTypeId);
            actions.clearPersistedSession();
          }}
        />
      </div>
    );
  }

  return (
    <>
    <div className="space-y-4 pb-24">
      {/* Header row: h1 always present (anchors row height), Start over conditionally rendered */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Analyze Food</h1>
        {hasContent && (
          <button
            onClick={() => setShowStartOverConfirm(true)}
            className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 min-h-[44px]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Start over
          </button>
        )}
      </div>

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

      <AlertDialog open={showStartOverConfirm} onOpenChange={setShowStartOverConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start over?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all photos, description, and analysis results.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStartOver} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Start over
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PhotoCapture key={photoCaptureKey} onPhotosChange={handlePhotosChange} autoCapture={autoCapture && !autoCaptureUsedRef.current} restoredBlobs={wasRestored && convertedPhotoBlobs.length > 0 ? (convertedPhotoBlobs as Blob[]) : undefined} />

      <DescriptionInput value={description} onChange={actions.setDescription} disabled={loading || logging || compressing} />

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
          streamingText={streamingText}
          narrative={analysisNarrative}
        />
      </div>

      {/* Post-analysis controls */}
      {analysis && !loading && (
        <div className="space-y-4">
          {/* Meal type and time selectors */}
          <div className="space-y-3">
            <MealTypeSelector
              value={mealTypeId}
              onChange={actions.setMealTypeId}
              disabled={logging}
              ariaLabel="Meal Type"
            />
            <TimeSelector value={selectedTime} onChange={actions.setSelectedTime} />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setChatOpen(true)}
              className="flex-1 min-h-[44px] justify-center gap-2"
            >
              <MessageSquare className="h-4 w-4" />
              Refine with chat
            </Button>
            <Button
              variant="outline"
              onClick={handleAnalyze}
              disabled={!canAnalyze}
              className="flex-1 min-h-[44px] justify-center gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Re-analyze
            </Button>
          </div>

          {/* Food matches section */}
          {matches.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">Similar foods you&apos;ve logged before</p>
              <p className="text-sm text-muted-foreground -mt-1">Tap a match to reuse it, or log as a new food with the button below.</p>
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
        </div>
      )}
    </div>

    {/* Sticky bottom CTA bar */}
    {(hasContent || loading || compressing) && (
    <div
      data-testid="sticky-cta-bar"
      className={`fixed left-0 right-0 z-40 px-4 ${keyboardHeight === 0 ? "bottom-[calc(4rem+env(safe-area-inset-bottom))]" : ""}`}
      style={keyboardHeight > 0 ? { bottom: `${keyboardHeight}px` } : undefined}
    >
      <div className={`mx-auto w-full max-w-md py-3 border-t ${keyboardHeight > 0 ? "bg-background border-b pb-4" : "bg-background/80 backdrop-blur-sm"}`}>
        <Button
          onClick={analysis ? handleLogToFitbit : handleAnalyze}
          disabled={analysis ? logging : !canAnalyze}
          className="w-full min-h-[44px]"
        >
          {compressing
            ? "Preparing images..."
            : loading
              ? "Analyzing..."
              : logging
                ? "Logging..."
                : analysis
                  ? matches.length > 0
                    ? "Log as new food"
                    : "Log to Fitbit"
                  : "Analyze Food"}
        </Button>
        {(loading || compressing) && (
          <Button
            variant="ghost"
            onClick={() => {
              if (abortControllerRef.current) {
                abortControllerRef.current.abort();
              }
            }}
            className="w-full min-h-[44px] mt-1"
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
    )}
    </>
  );
}
