"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import Link from "next/link";
import { apiFetcher } from "@/lib/swr";
import { getTodayDate, isToday } from "@/lib/date-utils";
import { DateNavigator } from "@/components/date-navigator";
import { CalorieRing } from "@/components/calorie-ring";
import { MacroBars } from "@/components/macro-bars";
import { MealBreakdown } from "@/components/meal-breakdown";
import { FastingCard } from "@/components/fasting-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import type { NutritionSummary, NutritionGoals, ActivitySummary, LumenGoalsResponse } from "@/types";

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
          // Reset to today and revalidate all SWR caches
          setSelectedDate(today);
          globalMutate(() => true);
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
  } = useSWR<NutritionSummary>(`/api/nutrition-summary?date=${selectedDate}`, apiFetcher);

  const {
    data: goals,
    isLoading: goalsLoading,
  } = useSWR<NutritionGoals>("/api/nutrition-goals", apiFetcher);

  const {
    data: activity,
    error: activityError,
  } = useSWR<ActivitySummary>(`/api/activity-summary?date=${selectedDate}`, apiFetcher);

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
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || "Upload failed");
      }

      // Mutate SWR cache on success
      await mutateLumenGoals();
    } catch (error) {
      setLumenUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setIsUploadingLumen(false);
    }
  };

  // Loading state
  if (summaryLoading || goalsLoading) {
    return <DashboardSkeleton />;
  }

  // Error states
  if (summaryError) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <p className="text-destructive">
          {summaryError.message || "Failed to load nutrition summary"}
        </p>
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

  // Calculate budget if all data is available
  const budget =
    goals?.calories != null && activity
      ? activity.caloriesOut - (activity.estimatedCaloriesOut - goals.calories) - totals.calories
      : undefined;

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
              budget={isToday(selectedDate) ? budget : undefined}
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

        {/* Activity error message - only show when ring is rendered */}
        {activityError && goals?.calories != null && (
          <div className="text-sm text-muted-foreground text-center">
            <div className="min-h-[44px] flex items-center justify-center">
              Fitbit permissions need updating.{" "}
              <Link href="/settings" className="text-primary hover:underline ml-1">
                Settings
              </Link>
            </div>
          </div>
        )}
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
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-muted-foreground">No food logged</p>
        </div>
      ) : (
        <MealBreakdown meals={meals} />
      )}

      {/* Update Lumen goals button */}
      <div className="flex flex-col items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={handleUpdateLumenGoals}
          disabled={isUploadingLumen}
          className="min-h-[44px]"
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
