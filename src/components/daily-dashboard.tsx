"use client";

import useSWR from "swr";
import Link from "next/link";
import { apiFetcher } from "@/lib/swr";
import { CalorieRing } from "@/components/calorie-ring";
import { MacroBars } from "@/components/macro-bars";
import { MealBreakdown } from "@/components/meal-breakdown";
import { Skeleton } from "@/components/ui/skeleton";
import type { NutritionSummary, NutritionGoals, ActivitySummary } from "@/types";

function getTodayDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function DashboardSkeleton() {
  return (
    <div data-testid="dashboard-skeleton" className="space-y-6">
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
  const today = getTodayDate();

  const {
    data: summary,
    error: summaryError,
    isLoading: summaryLoading,
  } = useSWR<NutritionSummary>(`/api/nutrition-summary?date=${today}`, apiFetcher);

  const {
    data: goals,
    isLoading: goalsLoading,
  } = useSWR<NutritionGoals>("/api/nutrition-goals", apiFetcher);

  const {
    data: activity,
    error: activityError,
  } = useSWR<ActivitySummary>(`/api/activity-summary?date=${today}`, apiFetcher);

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

  // Empty state
  if (!summary || summary.meals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <p className="text-muted-foreground">No food logged today</p>
        <Link
          href="/app"
          className="text-sm text-primary hover:underline min-h-[44px] flex items-center"
        >
          Scan food to get started
        </Link>
      </div>
    );
  }

  // Format numbers with commas
  const formatNumber = (num: number): string => {
    return num.toLocaleString("en-US");
  };

  // Calculate budget if all data is available
  const budget =
    goals?.calories != null && activity
      ? activity.caloriesOut - (activity.estimatedCaloriesOut - goals.calories) - summary.totals.calories
      : undefined;

  // Data state - compose all dashboard components
  return (
    <div className="space-y-6">
      {/* Calorie Ring or Plain Display */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex justify-center">
          {goals?.calories != null ? (
            <CalorieRing
              calories={summary.totals.calories}
              goal={goals.calories}
              budget={budget}
            />
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="text-4xl font-bold tabular-nums">
                {formatNumber(summary.totals.calories)}
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
        proteinG={summary.totals.proteinG}
        carbsG={summary.totals.carbsG}
        fatG={summary.totals.fatG}
      />

      {/* Meal Breakdown */}
      <MealBreakdown meals={summary.meals} />
    </div>
  );
}
