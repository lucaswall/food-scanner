"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, MessageSquare, Trash2 } from "lucide-react";
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
import { AnalysisResult } from "@/components/analysis-result";
import { MealTypeSelector } from "@/components/meal-type-selector";
import { TimeSelector } from "@/components/time-selector";
import { FoodMatchCard } from "@/components/food-match-card";
import { FoodLogConfirmation } from "@/components/food-log-confirmation";
import { FoodChat } from "@/components/food-chat";
import { apiFetcher, invalidateFoodCaches, invalidateSavedAnalysesCaches } from "@/lib/swr";
import { getDefaultMealType, getLocalDateTime } from "@/lib/meal-type";
import { savePendingSubmission } from "@/lib/pending-submission";
import { safeResponseJson } from "@/lib/safe-json";
import type { FoodLogResponse, FoodMatch } from "@/types";
import type { SavedAnalysisDetail } from "@/types";

interface SavedFoodDetailProps {
  savedId: number;
}

export function SavedFoodDetail({ savedId }: SavedFoodDetailProps) {
  const router = useRouter();

  const { data: savedAnalysis, isLoading, error } = useSWR<SavedAnalysisDetail>(
    `/api/saved-analyses/${savedId}`,
    apiFetcher,
  );

  // Derive keywords from food name for match lookup
  const keywords = savedAnalysis?.foodAnalysis.food_name?.trim() ?? null;
  const searchKey = keywords
    ? `/api/search-foods?q=${encodeURIComponent(keywords)}&limit=3`
    : null;
  const { data: matchesData } = useSWR<FoodMatch[]>(searchKey, apiFetcher);
  const matches = matchesData ?? [];

  const [mealTypeId, setMealTypeId] = useState(() => getDefaultMealType());
  const [selectedTime, setSelectedTime] = useState<string | null>(() => getLocalDateTime().time);
  const [selectedMatch, setSelectedMatch] = useState<number | null>(null);
  const [logging, setLogging] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);

  const handleSelectMatch = (match: FoodMatch) => {
    setSelectedMatch(match.customFoodId);
  };

  const handleLogToFitbit = async () => {
    if (!savedAnalysis) return;
    setLogError(null);
    setLogging(true);

    try {
      const localDateTime = getLocalDateTime();
      const logTime = selectedTime ?? localDateTime.time;

      const logBody: Record<string, unknown> = selectedMatch
        ? {
            reuseCustomFoodId: selectedMatch,
            mealTypeId,
            date: localDateTime.date,
            time: logTime,
            zoneOffset: localDateTime.zoneOffset,
          }
        : {
            ...savedAnalysis.foodAnalysis,
            mealTypeId,
            date: localDateTime.date,
            time: logTime,
            zoneOffset: localDateTime.zoneOffset,
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
            analysis: savedAnalysis.foodAnalysis,
            mealTypeId,
            foodName: savedAnalysis.foodAnalysis.food_name,
            date: localDateTime.date,
            time: logTime,
            zoneOffset: localDateTime.zoneOffset,
          });
          window.location.href = "/api/auth/fitbit";
          return;
        }
        setLogError(result.error?.message || "Failed to log food to Fitbit");
        return;
      }

      // Delete saved analysis on success
      await fetch(`/api/saved-analyses/${savedId}`, { method: "DELETE" });
      await Promise.all([invalidateFoodCaches(), invalidateSavedAnalysesCaches()]);
      setLogResponse(result.data ?? null);
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setLogError("Request timed out. Please try again.");
      } else {
        setLogError(err instanceof Error ? err.message : "An unexpected error occurred");
      }
    } finally {
      setLogging(false);
    }
  };

  const handleDiscard = async () => {
    try {
      await fetch(`/api/saved-analyses/${savedId}`, { method: "DELETE" });
      await invalidateSavedAnalysesCaches();
      router.push("/app");
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "Failed to discard saved food");
    }
  };

  const handleChatLogged = async (response: FoodLogResponse) => {
    if (!response.success) return;
    try {
      await fetch(`/api/saved-analyses/${savedId}`, { method: "DELETE" });
      await invalidateSavedAnalysesCaches();
      router.push("/app");
    } catch (err) {
      console.error("Failed to delete saved analysis after logging from chat:", err);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div data-testid="saved-detail-skeleton" className="space-y-4 pb-24">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-7 w-48" />
        </div>
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-11 w-full rounded-md" />
        <Skeleton className="h-11 w-full rounded-md" />
        <div className="flex gap-2">
          <Skeleton className="h-11 flex-1 rounded-md" />
          <Skeleton className="h-11 flex-1 rounded-md" />
        </div>
        <Skeleton className="h-14 w-full rounded-md" />
      </div>
    );
  }

  // Error / not found state
  if (error || !savedAnalysis) {
    return (
      <div data-testid="saved-not-found" className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
        <p className="text-muted-foreground">This saved analysis was not found.</p>
        <Button variant="outline" asChild className="min-h-[44px]">
          <a href="/app">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </a>
        </Button>
      </div>
    );
  }

  // Chat overlay
  if (showChat) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-background pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <FoodChat
          initialAnalysis={savedAnalysis.foodAnalysis}
          initialMealTypeId={mealTypeId}
          mode="analyze"
          onClose={() => setShowChat(false)}
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          onLogged={(response, _analysis, _mealTypeId) => {
            handleChatLogged(response).catch(() => {});
          }}
        />
      </div>
    );
  }

  // Success confirmation
  if (logResponse) {
    return (
      <div className="space-y-6">
        <FoodLogConfirmation
          response={logResponse}
          foodName={savedAnalysis.foodAnalysis.food_name}
          analysis={savedAnalysis.foodAnalysis}
          mealTypeId={mealTypeId}
          onDone={() => router.push("/app")}
        />
      </div>
    );
  }

  const logButtonLabel = selectedMatch
    ? "Log to Fitbit"
    : matches.length > 0
      ? "Log as new food"
      : "Log to Fitbit";

  return (
    <>
      <div className="space-y-4 pb-24">
        {/* Back button header */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/app")}
            aria-label="Back"
            className="min-h-[44px] min-w-[44px]"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-semibold truncate">{savedAnalysis.foodAnalysis.food_name}</h1>
        </div>

        {/* Analysis result */}
        <AnalysisResult
          analysis={savedAnalysis.foodAnalysis}
          loading={false}
          error={null}
          onRetry={() => {}}
        />

        {/* Meal type and time selectors */}
        <div className="space-y-3">
          <MealTypeSelector
            value={mealTypeId}
            onChange={setMealTypeId}
            disabled={logging}
          />
          <TimeSelector value={selectedTime} onChange={setSelectedTime} />
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowChat(true)}
            className="flex-1 min-h-[44px] justify-center gap-2"
          >
            <MessageSquare className="h-4 w-4" />
            Refine with chat
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowDiscardConfirm(true)}
            className="flex-1 min-h-[44px] justify-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Discard
          </Button>
        </div>

        {/* Matches section */}
        {matches.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Similar foods</p>
            {matches.map((match) => (
              <FoodMatchCard
                key={match.customFoodId}
                match={match}
                onSelect={handleSelectMatch}
                disabled={logging}
              />
            ))}
          </div>
        )}

        {/* Log error */}
        {logError && (
          <div
            data-testid="log-error"
            className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
            aria-live="polite"
          >
            <p className="text-sm text-destructive">{logError}</p>
          </div>
        )}
      </div>

      {/* Sticky bottom CTA */}
      <div
        data-testid="sticky-cta-bar"
        className="fixed left-0 right-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 px-4"
      >
        <div className="mx-auto w-full max-w-md py-3 border-t bg-background/80 backdrop-blur-sm">
          <Button
            onClick={handleLogToFitbit}
            disabled={logging}
            className="w-full min-h-[44px]"
          >
            {logging ? "Logging..." : logButtonLabel}
          </Button>
        </div>
      </div>

      {/* Discard confirmation dialog */}
      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard saved analysis?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this saved analysis. You can always re-analyze the food later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDiscard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
