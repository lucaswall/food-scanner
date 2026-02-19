"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { apiFetcher } from "@/lib/swr";
import { getTodayDate } from "@/lib/date-utils";
import { DateNavigator } from "@/components/date-navigator";
import { CalorieRing } from "@/components/calorie-ring";
import { MacroBars } from "@/components/macro-bars";
import { MealBreakdown } from "@/components/meal-breakdown";
import { FastingCard } from "@/components/fasting-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2, ScanEye, ListChecks } from "lucide-react";
import type { NutritionSummary, NutritionGoals, LumenGoalsResponse } from "@/types";

function DashboardSkeleton() {
  return (
    <div data-testid="dashboard-skeleton" className="space-y-6">
      {/* Date navigator skeleton */}
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-[44px] w-[44px] rounded-md" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-[44px] w-[44px] rounded-md" />
      </div>

      {/* Calorie ring skeleton */}
      <div className="flex flex-col items-center gap-2">
        <Skeleton className="w-32 h-32 rounded-full" />
      </div>

      {/* Macro bars skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>

      {/* Meal sections skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function DailyDashboard() {
  const [selectedDate, setSelectedDate] = useState(getTodayDate());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingLumen, setIsUploadingLumen] = useState(false);
  const [lumenUploadError, setLumenUploadError] = useState<string | null>(null);
  const { mutate: globalMutate } = useSWRConfig();
  const lastActiveRef = useRef({ date: getTodayDate(), timestamp: Date.now() });

  // Auto-reset to today when tab becomes visible after date change or 1hr+ idle
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Tab is hidden - record current date and timestamp
        lastActiveRef.current = {
          date: getTodayDate(),
          timestamp: Date.now(),
        };
      } else if (document.visibilityState === "visible") {
        // Tab is visible - check if we should reset to today
        const today = getTodayDate();
        const dateChanged = today !== lastActiveRef.current.date;
        const elapsed = Date.now() - lastActiveRef.current.timestamp;
        const oneHourInMs = 3_600_000;

        if (dateChanged || elapsed > oneHourInMs) {
          // Reset to today and revalidate only dashboard-related caches
          setSelectedDate(today);
          globalMutate(
            (key) =>
              typeof key === "string" &&
              (key.startsWith("/api/nutrition-summary") ||
                key.startsWith("/api/nutrition-goals") ||
                key.startsWith("/api/lumen-goals") ||
                key.startsWith("/api/fasting") ||
                key === "/api/earliest-entry")
          );
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [globalMutate]);

  const {
    data: earliestEntry,
    isLoading: earliestLoading,
  } = useSWR<{ date: string | null }>("/api/earliest-entry", apiFetcher);

  const {
    data: summary,
    error: summaryError,
    isLoading: summaryLoading,
    mutate: mutateSummary,
  } = useSWR<NutritionSummary>(`/api/nutrition-summary?date=${selectedDate}`, apiFetcher);

  const {
    data: goals,
  } = useSWR<NutritionGoals>(`/api/nutrition-goals?clientDate=${selectedDate}`, apiFetcher);

  const {
    data: lumenGoals,
    mutate: mutateLumenGoals,
  } = useSWR<LumenGoalsResponse>(`/api/lumen-goals?date=${selectedDate}`, apiFetcher);

  const handleUpdateLumenGoals = () => {
    fileInputRef.current?.click();
  };

  const handleLumenFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploadingLumen(true);
    setLumenUploadError(null);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("date", selectedDate);

      const response = await fetch("/api/lumen-goals", {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "Upload failed");
      }

      // Mutate SWR cache on success
      await mutateLumenGoals();
    } catch (error) {
      if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
        setLumenUploadError("Upload timed out. Please try again.");
      } else {
        setLumenUploadError(error instanceof Error ? error.message : "Upload failed");
      }
    } finally {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setIsUploadingLumen(false);
    }
  };

  // Loading state (only wait for summary - goals can load in background)
  if (summaryLoading) {
    return <DashboardSkeleton />;
  }

  // Error states
  if (summaryError) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <p className="text-destructive">
          {summaryError.message || "Failed to load nutrition summary"}
        </p>
        <Button
          onClick={() => mutateSummary()}
          size="sm"
          className="min-h-[44px]"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  // Format numbers with commas
  const formatNumber = (num: number): string => {
    return num.toLocaleString("en-US");
  };

  // Fallback for undefined summary - use zero values
  const totals = summary?.totals ?? {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sodiumMg: 0,
    saturatedFatG: 0,
    transFatG: 0,
    sugarsG: 0,
    caloriesFromFat: 0,
  };

  const meals = summary?.meals ?? [];

  // Empty state - when there are no meals logged for this date
  const showEmptyState = !summaryLoading && meals.length === 0;

  // Data state - compose all dashboard components
  return (
    <div className="space-y-6">
      {/* Date Navigator */}
      <DateNavigator
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        earliestDate={earliestEntry?.date ?? null}
        isLoading={earliestLoading}
      />
      {/* Calorie Ring or Plain Display */}
      <div className="flex flex-col items-center gap-2">
        {/* Day type badge */}
        {lumenGoals?.goals && (
          <span className="text-sm text-muted-foreground">
            {lumenGoals.goals.dayType} day
          </span>
        )}

        <div className="flex justify-center">
          {goals?.calories != null ? (
            <CalorieRing
              calories={totals.calories}
              goal={goals.calories}
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="text-4xl font-bold tabular-nums">
                {formatNumber(totals.calories)}
              </span>
              <span className="text-sm text-muted-foreground">cal</span>
            </div>
          )}
        </div>
      </div>

      {/* Macro Bars */}
      <MacroBars
        proteinG={totals.proteinG}
        carbsG={totals.carbsG}
        fatG={totals.fatG}
        proteinGoal={lumenGoals?.goals?.proteinGoal}
        carbsGoal={lumenGoals?.goals?.carbsGoal}
        fatGoal={lumenGoals?.goals?.fatGoal}
      />

      {/* Fasting Card */}
      <FastingCard date={selectedDate} />

      {/* Empty state or Meal Breakdown */}
      {showEmptyState ? (
        <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
          <p className="text-muted-foreground">No meals logged yet</p>
          <div className="flex gap-3">
            <Link
              href="/app/analyze"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 h-11 px-4 py-2 min-h-[44px]"
            >
              <ScanEye className="h-4 w-4" />
              Scan Food
            </Link>
            <Link
              href="/app/quick-select"
              className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50 h-11 px-4 py-2 min-h-[44px]"
            >
              <ListChecks className="h-4 w-4" />
              Quick Select
            </Link>
          </div>
        </div>
      ) : (
        <MealBreakdown meals={meals} />
      )}

      {/* Update Lumen goals button */}
      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          onClick={handleUpdateLumenGoals}
          disabled={isUploadingLumen}
          className="w-full min-h-[44px]"
        >
          {isUploadingLumen ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Update Lumen goals
        </Button>
        {lumenUploadError && (
          <p className="text-sm text-destructive">{lumenUploadError}</p>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleLumenFileChange}
      />
    </div>
  );
}
