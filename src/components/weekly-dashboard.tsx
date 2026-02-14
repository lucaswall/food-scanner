"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { apiFetcher } from "@/lib/swr";
import { getTodayDate, getWeekBounds } from "@/lib/date-utils";
import { WeekNavigator } from "@/components/week-navigator";
import { WeeklyNutritionChart } from "@/components/weekly-nutrition-chart";
import { WeeklyFastingChart } from "@/components/weekly-fasting-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { DateRangeNutritionResponse, FastingWindow } from "@/types";

function DashboardSkeleton() {
  return (
    <div data-testid="dashboard-skeleton" className="space-y-6">
      {/* Week navigator skeleton */}
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-[44px] w-[44px] rounded-md" />
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-[44px] w-[44px] rounded-md" />
      </div>

      {/* Nutrition chart skeleton (metric selector + chart) */}
      <div className="space-y-4">
        {/* Metric selector skeleton */}
        <div className="flex gap-1 p-1 bg-muted rounded-full">
          <Skeleton className="h-[44px] flex-1 rounded-full" />
          <Skeleton className="h-[44px] flex-1 rounded-full" />
          <Skeleton className="h-[44px] flex-1 rounded-full" />
          <Skeleton className="h-[44px] flex-1 rounded-full" />
        </div>
        {/* Chart area skeleton */}
        <Skeleton className="h-48 w-full" />
      </div>

      {/* Fasting chart skeleton */}
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

export function WeeklyDashboard() {
  const today = getTodayDate();
  const currentWeekBounds = getWeekBounds(today);
  const [weekStart, setWeekStart] = useState(currentWeekBounds.start);
  const { mutate: globalMutate } = useSWRConfig();
  const lastActiveRef = useRef({ weekStart: currentWeekBounds.start, timestamp: Date.now() });

  // Auto-reset to current week when tab becomes visible after week change or 1hr+ idle
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Tab is hidden - record current week start and timestamp
        const currentToday = getTodayDate();
        const currentWeek = getWeekBounds(currentToday);
        lastActiveRef.current = {
          weekStart: currentWeek.start,
          timestamp: Date.now(),
        };
      } else if (document.visibilityState === "visible") {
        // Tab is visible - check if we should reset to current week
        const currentToday = getTodayDate();
        const currentWeek = getWeekBounds(currentToday);
        const weekChanged = currentWeek.start !== lastActiveRef.current.weekStart;
        const elapsed = Date.now() - lastActiveRef.current.timestamp;
        const oneHourInMs = 3_600_000;

        if (weekChanged || elapsed > oneHourInMs) {
          // Reset to current week and revalidate only dashboard-related caches
          setWeekStart(currentWeek.start);
          globalMutate(
            (key) =>
              typeof key === "string" &&
              (key.startsWith("/api/nutrition-summary") || key.startsWith("/api/fasting"))
          );
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [globalMutate]);

  const weekBounds = getWeekBounds(weekStart);
  const weekEnd = weekBounds.end;

  const {
    data: earliestEntry,
    isLoading: earliestLoading,
  } = useSWR<{ date: string | null }>("/api/earliest-entry", apiFetcher);

  // Fetch nutrition data for the week
  const {
    data: nutritionData,
    error: nutritionError,
    isLoading: nutritionLoading,
    mutate: mutateNutrition,
  } = useSWR<DateRangeNutritionResponse>(
    `/api/nutrition-summary?from=${weekStart}&to=${weekEnd}`,
    apiFetcher
  );

  // Fetch fasting data for the week
  const {
    data: fastingData,
    error: fastingError,
    isLoading: fastingLoading,
    mutate: mutateFasting,
  } = useSWR<{ windows: FastingWindow[] }>(
    `/api/fasting?from=${weekStart}&to=${weekEnd}`,
    apiFetcher
  );

  // Loading state
  if (nutritionLoading || fastingLoading) {
    return <DashboardSkeleton />;
  }

  // Error states
  if (nutritionError) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <p className="text-destructive">
          {nutritionError.message || "Failed to load nutrition data"}
        </p>
        <Button
          onClick={() => mutateNutrition()}
          variant="outline"
          size="sm"
          className="min-h-[44px]"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (fastingError) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <p className="text-destructive">
          {fastingError.message || "Failed to load fasting data"}
        </p>
        <Button
          onClick={() => mutateFasting()}
          variant="outline"
          size="sm"
          className="min-h-[44px]"
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const days = nutritionData?.days ?? [];
  const windows = fastingData?.windows ?? [];

  return (
    <div className="space-y-6">
      {/* Week Navigator */}
      <WeekNavigator
        weekStart={weekStart}
        onWeekChange={setWeekStart}
        earliestDate={earliestEntry?.date ?? null}
      />

      {/* Weekly Nutrition Chart */}
      <WeeklyNutritionChart days={days} weekStart={weekStart} />

      {/* Weekly Fasting Chart */}
      <WeeklyFastingChart windows={windows} weekStart={weekStart} />
    </div>
  );
}
