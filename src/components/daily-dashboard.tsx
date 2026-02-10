"use client";

import useSWR from "swr";
import Link from "next/link";
import { apiFetcher } from "@/lib/swr";
import { CalorieRing } from "@/components/calorie-ring";
import { MacroBars } from "@/components/macro-bars";
import { MealBreakdown } from "@/components/meal-breakdown";
import { Skeleton } from "@/components/ui/skeleton";
import type { NutritionSummary, NutritionGoals } from "@/types";

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
    error: goalsError,
    isLoading: goalsLoading,
  } = useSWR<NutritionGoals>("/api/nutrition-goals", apiFetcher);

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

  if (goalsError) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <p className="text-destructive">
          {goalsError.message || "Failed to load goals"}
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

  // Data state - compose all dashboard components
  return (
    <div className="space-y-6">
      {/* Calorie Ring */}
      <div className="flex justify-center">
        <CalorieRing
          calories={summary.totals.calories}
          goal={goals?.calories ?? 0}
        />
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
