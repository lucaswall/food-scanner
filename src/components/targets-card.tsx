"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import type { NutritionGoals } from "@/types";

interface TargetsCardProps {
  date: string;
}

function getBlockedMessage(reason?: string): string {
  switch (reason) {
    case "no_weight":
      return "Log your weight in Fitbit to enable macro targets.";
    case "sex_unset":
      return "Set your biological sex in Fitbit profile to enable macro targets.";
    case "scope_mismatch":
      return "Reconnect Fitbit to enable macro targets.";
    default:
      return "Macro targets unavailable.";
  }
}

export function TargetsCard({ date }: TargetsCardProps) {
  const [expanded, setExpanded] = useState(false);

  const {
    data: goals,
    error,
    isLoading,
    mutate,
  } = useSWR<NutritionGoals>(
    `/api/nutrition-goals?clientDate=${date}`,
    apiFetcher
  );

  if (isLoading) {
    return (
      <div data-testid="targets-card-skeleton">
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
        <span className="text-sm text-muted-foreground">Could not load targets</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => mutate()}
          className="min-h-[44px]"
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  // Hide if no data or status not yet populated (pre-macro-engine API)
  if (!goals || !goals.status) return null;

  if (goals.status === "blocked") {
    return (
      <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
        {getBlockedMessage(goals.reason)}
      </div>
    );
  }

  if (goals.status === "partial") {
    return (
      <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
        Targets pending — waiting for Fitbit activity
      </div>
    );
  }

  // status === "ok"
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <span className="font-medium">
            {goals.calories != null
              ? goals.calories.toLocaleString("en-US")
              : "—"}{" "}
            cal/day
          </span>
          {goals.proteinG != null && <span>P:{goals.proteinG}g</span>}
          {goals.carbsG != null && <span>C:{goals.carbsG}g</span>}
          {goals.fatG != null && <span>F:{goals.fatG}g</span>}
        </div>
        {goals.audit && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            aria-label={
              expanded ? "Hide calculation details" : "Show calculation details"
            }
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {expanded && goals.audit && (
        <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t">
          <p>RMR: {goals.audit.rmr} kcal</p>
          <p>Activity: {goals.audit.activityKcal} kcal</p>
          <p>TDEE: {goals.audit.tdee} kcal</p>
          <p>
            Weight: {goals.audit.weightKg}kg ({goals.audit.bmiTier})
          </p>
          <p>Goal: {goals.audit.goalType}</p>
        </div>
      )}
    </div>
  );
}
