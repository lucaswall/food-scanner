"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { apiFetcher, ApiError, HEALTH_BACKED_SWR_CONFIG } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { HealthProfileData } from "@/types";

const NOT_SET = "Not set in Google Health";

// Connect-flow page (POSTs to /api/auth/google-health). Shared with HealthStatusBanner.
const RECONNECT_HEALTH_HREF = "/app/connect-health";

/**
 * A broken Google Health connection reaches this read surface as HEALTH_NOT_CONNECTED
 * (token revoked/deleted → needs_reconnect) or HEALTH_SCOPE_MISSING (scope_mismatch).
 * Both are resolved by reconnecting, so we show a reconnect CTA rather than a retry (P1-5).
 */
function isHealthReconnectError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "HEALTH_NOT_CONNECTED" || error.code === "HEALTH_SCOPE_MISSING")
  );
}

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

/** Days between today and the weight log, or null when not loggable. */
function weightAgeDays(loggedDate: string | null | undefined): number | null {
  if (!loggedDate) return null;
  const ageMs = Date.now() - Date.parse(loggedDate);
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  return Math.floor(ageMs / 86_400_000);
}

export function HealthProfileCard() {
  const { data, error, isLoading, mutate } = useSWR<HealthProfileData>(
    "/api/health-profile",
    apiFetcher,
    HEALTH_BACKED_SWR_CONFIG,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch("/api/health-profile?refresh=1", {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) throw new Error("refresh_failed");
      await mutate();
    } catch {
      setRefreshError("Could not refresh from Google Health. Try again.");
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Google Health Profile</h2>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-24" />
      </div>
    );
  }

  if (error) {
    // A revoked/deleted token (needs_reconnect) or missing scopes are not retryable —
    // surface a clear reconnect CTA to the connect flow instead of a retry button (P1-5).
    if (isHealthReconnectError(error)) {
      return (
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-6" role="alert">
          <h2 className="text-lg font-semibold">Google Health Profile</h2>
          <p className="text-sm text-muted-foreground">
            Google Health needs to be reconnected to load your profile.
          </p>
          <Button asChild variant="outline" className="min-h-[44px] self-start">
            <Link href={RECONNECT_HEALTH_HREF}>Reconnect Google Health</Link>
          </Button>
        </div>
      );
    }
    const isTimeout =
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6" role="alert">
        <h2 className="text-lg font-semibold">Google Health Profile</h2>
        <p className="text-sm text-destructive">
          {isTimeout
            ? "Request timed out. Please try again."
            : "Could not load Google Health profile"}
        </p>
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
        <h2 className="text-lg font-semibold">Google Health Profile</h2>
        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px] min-w-[44px] shrink-0"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh from Google Health"}
        </Button>
      </div>

      {refreshError && (
        <p className="text-sm text-destructive" role="alert">{refreshError}</p>
      )}

      {data && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Age</span>
            <span>{data.ageYears > 0 ? `${data.ageYears} years` : "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sex</span>
            <span>{formatSex(data.sex)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Height</span>
            <span>
              {data.heightCm != null ? (
                `${data.heightCm} cm`
              ) : (
                <span className="text-muted-foreground italic" aria-label="Height unavailable">
                  Unavailable
                </span>
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Weight</span>
            <span>
              {data.weightKg != null
                ? `${data.weightKg} kg${data.weightLoggedDate ? ` (${data.weightLoggedDate})` : ""}`
                : NOT_SET}
            </span>
          </div>
          {(() => {
            const ageDays = weightAgeDays(data.weightLoggedDate);
            if (ageDays !== null && ageDays > 7 && ageDays <= 14) {
              return (
                <p className="text-xs text-warning">
                  Weight log is {ageDays} days old — consider weighing in.
                </p>
              );
            }
            return null;
          })()}
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
