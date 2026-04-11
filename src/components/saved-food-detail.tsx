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
import { safeResponseJson } from "@/lib/safe-json";
import { getDefaultMealType, getLocalDateTime } from "@/lib/meal-type";
import { useLogToFitbit } from "@/hooks/use-log-to-fitbit";
import type { FoodLogResponse, FoodMatch } from "@/types";
import type { SavedAnalysisDetail } from "@/types";

interface SavedFoodDetailProps {
  savedId: number;
}

export function SavedFoodDetail({ savedId }: SavedFoodDetailProps) {
  const { data: savedAnalysis, isLoading } = useSWR<SavedAnalysisDetail>(
    `/api/saved-analyses/${savedId}`,
    apiFetcher,
  );

  const matchesKey = savedAnalysis ? `find-matches-${savedId}` : null;
  const { data: matchesData } = useSWR<FoodMatch[]>(
    matchesKey,
    async () => {
      const { keywords, food_name, amount, unit_id, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg } = savedAnalysis!.foodAnalysis;
      const response = await fetch("/api/find-matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords, food_name, amount, unit_id, calories, protein_g, carbs_g, fat_g, fiber_g, sodium_mg }),
        signal: AbortSignal.timeout(15000),
      });
      const result = (await safeResponseJson(response)) as { success: boolean; data?: { matches: FoodMatch[] }; error?: { message: string } };
      return result.data?.matches ?? [];
    },
  );

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

  if (!savedAnalysis) {
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

  return (
    <SavedFoodDetailLoaded
      savedId={savedId}
      savedAnalysis={savedAnalysis}
      matches={matchesData ?? []}
    />
  );
}

interface SavedFoodDetailLoadedProps {
  savedId: number;
  savedAnalysis: SavedAnalysisDetail;
  matches: FoodMatch[];
}

function SavedFoodDetailLoaded({ savedId, savedAnalysis, matches }: SavedFoodDetailLoadedProps) {
  const router = useRouter();
  const fa = savedAnalysis.foodAnalysis;

  const [mealTypeId, setMealTypeId] = useState(() => fa.mealTypeId ?? getDefaultMealType());
  const [selectedTime, setSelectedTime] = useState<string | null>(() => fa.time ?? getLocalDateTime().time);
  const [selectedDate] = useState<string | null>(() => fa.date ?? null);
  const [selectedMatch, setSelectedMatch] = useState<number | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [loggedFoodName, setLoggedFoodName] = useState<string | null>(null);
  const [loggedAnalysis, setLoggedAnalysis] = useState<SavedAnalysisDetail["foodAnalysis"] | null>(null);

  const { logToFitbit, logToFitbitWithMatch, logging, logError, logResponse, clearLogError } = useLogToFitbit({
    analysis: fa,
    mealTypeId,
    selectedTime,
    dateOverride: selectedDate,
    onSuccess: async () => {
      // Delete saved analysis on success (non-blocking)
      try {
        const deleteRes = await fetch(`/api/saved-analyses/${savedId}`, { method: "DELETE", signal: AbortSignal.timeout(15000) });
        if (!deleteRes.ok) console.warn("Failed to delete saved analysis after logging:", deleteRes.status);
      } catch (deleteErr) {
        console.warn("Failed to delete saved analysis after logging:", deleteErr);
      }
      setLoggedFoodName(fa.food_name);
      setLoggedAnalysis(fa);
      await Promise.all([invalidateFoodCaches(), invalidateSavedAnalysesCaches()]);
    },
  });

  const handleSelectMatch = (match: FoodMatch) => {
    setSelectedMatch(match.customFoodId);
    clearLogError();
  };

  const handleLogClick = () => {
    if (selectedMatch) {
      const match = matches.find(m => m.customFoodId === selectedMatch);
      if (match) {
        void logToFitbitWithMatch({ customFoodId: selectedMatch, foodName: match.foodName });
      }
    } else {
      void logToFitbit();
    }
  };

  const handleDiscard = async () => {
    try {
      const response = await fetch(`/api/saved-analyses/${savedId}`, { method: "DELETE", signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        setShowDiscardConfirm(false);
        setDiscardError("Failed to discard saved food");
        return;
      }
      await invalidateSavedAnalysesCaches();
      router.push("/app");
    } catch (err) {
      setShowDiscardConfirm(false);
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setDiscardError("Request timed out. Please try again.");
      } else {
        setDiscardError("Failed to discard saved food");
      }
    }
  };

  const handleChatLogged = async (response: FoodLogResponse) => {
    if (!response.success) return;
    try {
      const deleteRes = await fetch(`/api/saved-analyses/${savedId}`, { method: "DELETE", signal: AbortSignal.timeout(15000) });
      if (!deleteRes.ok) {
        console.warn("Failed to delete saved analysis after logging from chat:", deleteRes.status);
      }
      await invalidateSavedAnalysesCaches();
      router.push("/app");
    } catch (err) {
      console.warn("Failed to delete saved analysis after logging from chat:", err);
    }
  };

  // Success confirmation (checked before other states — SWR may 404 after the saved analysis is deleted on log)
  if (logResponse) {
    return (
      <div className="space-y-6">
        <FoodLogConfirmation
          response={logResponse}
          foodName={loggedFoodName ?? fa.food_name}
          analysis={loggedAnalysis ?? fa}
          mealTypeId={mealTypeId}
          onDone={() => router.push("/app")}
        />
      </div>
    );
  }

  // Chat overlay
  if (showChat) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col bg-background pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <FoodChat
          initialAnalysis={fa}
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
          <h1 className="text-xl font-semibold truncate">{fa.food_name}</h1>
        </div>

        {/* Analysis result */}
        <AnalysisResult
          analysis={fa}
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

        {/* Log / discard error */}
        {(logError ?? discardError) && (
          <div
            data-testid="log-error"
            className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg"
            aria-live="polite"
          >
            <p className="text-sm text-destructive">{logError ?? discardError}</p>
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
            onClick={handleLogClick}
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
