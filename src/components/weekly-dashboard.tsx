"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { getTodayDate, getWeekBounds } from "@/lib/date-utils";
import { WeekNavigator } from "@/components/week-navigator";
import { WeeklyCalorieChart } from "@/components/weekly-calorie-chart";
import { WeeklyMacroAverages } from "@/components/weekly-macro-averages";
import { WeeklyFastingChart } from "@/components/weekly-fasting-chart";
import { Skeleton } from "@/components/ui/skeleton";
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

      {/* Calorie chart skeleton */}
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
      </div>

      {/* Macro averages skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
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

  const weekBounds = getWeekBounds(weekStart);
  const weekEnd = weekBounds.end;

  // Fetch nutrition data for the week
  const {
    data: nutritionData,
    error: nutritionError,
    isLoading: nutritionLoading,
  } = useSWR<DateRangeNutritionResponse>(
    `/api/nutrition-summary?from=${weekStart}&to=${weekEnd}`,
    apiFetcher
  );

  // Fetch fasting data for the week
  const {
    data: fastingData,
    error: fastingError,
    isLoading: fastingLoading,
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
      </div>
    );
  }

  if (fastingError) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <p className="text-destructive">
          {fastingError.message || "Failed to load fasting data"}
        </p>
      </div>
    );
  }

  const days = nutritionData?.days ?? [];
  const windows = fastingData?.windows ?? [];

  return (
    <div className="space-y-6">
      {/* Week Navigator */}
      <WeekNavigator weekStart={weekStart} onWeekChange={setWeekStart} />

      {/* Weekly Calorie Chart */}
      <WeeklyCalorieChart days={days} weekStart={weekStart} />

      {/* Weekly Macro Averages */}
      <WeeklyMacroAverages days={days} />

      {/* Weekly Fasting Chart */}
      <WeeklyFastingChart windows={windows} weekStart={weekStart} />
    </div>
  );
}
