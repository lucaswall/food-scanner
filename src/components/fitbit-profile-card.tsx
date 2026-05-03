"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { FitbitProfileData } from "@/types";

const NOT_SET = "Not set in Fitbit";

function formatSex(sex: "MALE" | "FEMALE" | "NA" | undefined): string {
  if (!sex || sex === "NA") return NOT_SET;
  return sex === "MALE" ? "Male" : "Female";
}

function formatGoalType(goalType: "LOSE" | "MAINTAIN" | "GAIN" | null | undefined): string {
  if (!goalType) return NOT_SET;
  switch (goalType) {
    case "LOSE": return "Lose weight";
    case "MAINTAIN": return "Maintain weight";
    case "GAIN": return "Gain weight";
  }
}

export function FitbitProfileCard() {
  const { data, error, isLoading, mutate } = useSWR<FitbitProfileData>(
    "/api/fitbit/profile",
    apiFetcher,
  );
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await fetch("/api/fitbit/profile?refresh=1");
      await mutate();
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Fitbit Profile</h2>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6" role="alert">
        <h2 className="text-lg font-semibold">Fitbit Profile</h2>
        <p className="text-sm text-destructive">Could not load Fitbit profile</p>
        <Button
          variant="outline"
          className="min-h-[44px]"
          onClick={() => mutate()}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Fitbit Profile</h2>
        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px] min-w-[44px] shrink-0"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh from Fitbit"}
        </Button>
      </div>

      {data && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Age</span>
            <span>{data.ageYears} years</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sex</span>
            <span>{formatSex(data.sex)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Height</span>
            <span>{data.heightCm} cm</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Weight</span>
            <span>
              {data.weightKg != null
                ? `${data.weightKg} kg${data.weightLoggedDate ? ` (${data.weightLoggedDate})` : ""}`
                : NOT_SET}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Goal</span>
            <span>{formatGoalType(data.goalType)}</span>
          </div>
          {data.lastSyncedAt > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Last synced: {new Date(data.lastSyncedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
