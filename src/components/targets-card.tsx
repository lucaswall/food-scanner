"use client";

import useSWR from "swr";
import Link from "next/link";
import { apiFetcher, ApiError, HEALTH_BACKED_SWR_CONFIG } from "@/lib/swr";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { ACTIVITY_LEVEL_LABELS } from "@/lib/macro-engine";
import type { NutritionGoals } from "@/types";
import type { GoalBlockedReason } from "@/components/goals-setup-banner";

// Connect-flow page (POSTs to /api/auth/google-health). Shared with HealthStatusBanner.
const RECONNECT_HEALTH_HREF = "/app/connect-health";

/**
 * A broken Google Health connection surfaces to read-surface routes as one of these
 * API error codes: HEALTH_NOT_CONNECTED (token revoked/deleted → needs_reconnect) or
 * HEALTH_SCOPE_MISSING (scope_mismatch). Both are resolved by reconnecting (P1-5).
 */
function isHealthReconnectError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "HEALTH_NOT_CONNECTED" || error.code === "HEALTH_SCOPE_MISSING")
  );
}

/** Compact, consistent "Reconnect Google Health" CTA for read-surface cards (P1-5). */
function ReconnectHealthCta({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg bg-muted/50">
      <span className="text-sm text-muted-foreground">{message}</span>
      <Button variant="outline" size="sm" asChild className="min-h-[44px] self-start">
        <Link href={RECONNECT_HEALTH_HREF}>Reconnect Google Health</Link>
      </Button>
    </div>
  );
}

interface TargetsCardProps {
  date: string;
}

/** Format a signed deficit value: negative numbers already carry a minus, positive get +. */
function formatSignedDeficit(kcal: number): string {
  if (kcal === 0) return "0";
  if (kcal > 0) return `+${kcal}`;
  return `${kcal}`;
}

const BLOCKED_MESSAGES: Record<GoalBlockedReason, string> = {
  goals_not_set: "Set up your daily goals in Settings to enable targets.",
  no_weight: "Log your weight in Google Health to enable macro targets.",
  sex_unset: "Set your biological sex in Settings to enable macro targets.",
  scope_mismatch: "Google Health is missing the permissions needed to compute macro targets.",
  invalid_profile:
    "Your Google Health profile has invalid values (height, weight, or age). Update your profile in Google Health.",
};

function getBlockedMessage(reason?: GoalBlockedReason): string {
  if (reason === undefined) return "Macro targets unavailable.";
  return BLOCKED_MESSAGES[reason];
}

export function TargetsCard({ date }: TargetsCardProps) {
  const {
    data: goals,
    error,
    isLoading,
    mutate,
  } = useSWR<NutritionGoals>(
    `/api/nutrition-goals?clientDate=${date}`,
    apiFetcher,
    HEALTH_BACKED_SWR_CONFIG,
  );

  if (isLoading) {
    return (
      <div data-testid="targets-card-skeleton">
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    // A revoked/deleted token (needs_reconnect) or missing scopes surface as typed
    // reconnect errors — show the reconnect CTA instead of a futile retry (P1-5).
    if (isHealthReconnectError(error)) {
      return (
        <ReconnectHealthCta message="Google Health needs to be reconnected to load your targets." />
      );
    }
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

  // Hide if no data or status not yet populated
  if (!goals || !goals.status) return null;

  if (goals.status === "blocked") {
    // A scope_mismatch is reconnect-resolvable — pair the message with the CTA (P1-5).
    if (goals.reason === "scope_mismatch") {
      return <ReconnectHealthCta message={getBlockedMessage(goals.reason)} />;
    }
    return (
      <div className="p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
        {getBlockedMessage(goals.reason)}
      </div>
    );
  }

  // status === "ok"
  const audit = goals.audit;

  const weightAgeDays =
    audit?.weightLoggedDate != null
      ? Math.floor(
          (Date.parse(date) - Date.parse(audit.weightLoggedDate)) / 86_400_000,
        )
      : null;

  return (
    <div className="rounded-lg border p-3 space-y-2">
      {goals.weightStale && weightAgeDays != null && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          ⚠ Weight log is {weightAgeDays} days old — log a recent weight in Google Health.
        </p>
      )}
      {/* Top-line target summary — unchanged */}
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

      {/* Audit detail — shown inline whenever audit is present (FOO-1045: no expand toggle) */}
      {audit && (
        <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t">
          {audit.rmr != null && <p>RMR: {audit.rmr} kcal</p>}
          {audit.activityLevel != null && audit.palMultiplier != null && (
            <p>
              Activity:{" "}
              {ACTIVITY_LEVEL_LABELS[audit.activityLevel as keyof typeof ACTIVITY_LEVEL_LABELS]}{" "}
              (PAL ×{audit.palMultiplier})
            </p>
          )}
          {audit.tdee != null && <p>TDEE: {audit.tdee} kcal</p>}
          {audit.weightKg != null && (
            <p>
              Weight: {audit.weightKg} kg
              {audit.weightLoggedDate
                ? ` (logged ${audit.weightLoggedDate})`
                : " (no log date)"}
            </p>
          )}
          {audit.goalWeightKg != null && <p>Goal weight: {audit.goalWeightKg} kg</p>}
          {audit.goalRateKgPerWeek != null && (
            <p>Goal rate: {audit.goalRateKgPerWeek} kg/week</p>
          )}
          {audit.deficitKcal != null && audit.direction != null && (
            <p>
              Deficit: {formatSignedDeficit(audit.deficitKcal)} kcal/day · {audit.direction}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
