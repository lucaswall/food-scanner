"use client";

import { useState, useEffect, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";
import { apiFetcher, HEALTH_BACKED_SWR_CONFIG } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  computeMacroTargets,
  ACTIVITY_LEVEL_LABELS,
} from "@/lib/macro-engine";
import type { ActivityLevel, HealthProfileData } from "@/types";

interface DailyGoalsSettingsData {
  activityLevel: ActivityLevel | null;
  goalWeightKg: number | null;
  goalRateKgPerWeek: number | null;
}

const ACTIVITY_LEVEL_VALUES: ActivityLevel[] = [
  "sedentary",
  "light",
  "moderate",
  "very_active",
  "extra_active",
];

const SAFETY_FLOOR_FEMALE = 1200;
const SAFETY_FLOOR_MALE = 1500;

export function DailyGoalsCard() {
  const { mutate: globalMutate } = useSWRConfig();

  const {
    data: settingsData,
    error: settingsError,
    isLoading: settingsLoading,
    mutate: mutateSettings,
  } = useSWR<DailyGoalsSettingsData>("/api/daily-goals-settings", apiFetcher);

  const {
    data: profileData,
    isLoading: profileLoading,
  } = useSWR<HealthProfileData>("/api/health-profile", apiFetcher, HEALTH_BACKED_SWR_CONFIG);

  // Local form state
  const [activityLevel, setActivityLevel] = useState<ActivityLevel | null>(null);
  const [goalWeightKg, setGoalWeightKg] = useState<string>("");
  const [goalRateKgPerWeek, setGoalRateKgPerWeek] = useState<string>("");

  // Sync form state from SWR on initial load only
  const hasSynced = useRef(false);
  useEffect(() => {
    if (settingsData && !hasSynced.current) {
      hasSynced.current = true;
      setActivityLevel(settingsData.activityLevel);
      setGoalWeightKg(settingsData.goalWeightKg !== null ? String(settingsData.goalWeightKg) : "");
      setGoalRateKgPerWeek(
        settingsData.goalRateKgPerWeek !== null ? String(settingsData.goalRateKgPerWeek) : "",
      );
    }
  }, [settingsData]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Compute live target preview
  let liveTargetKcal: number | null = null;
  const goalWeightNum = parseFloat(goalWeightKg);
  const goalRateNum = parseFloat(goalRateKgPerWeek);
  const canPreview =
    activityLevel !== null &&
    !isNaN(goalWeightNum) &&
    goalWeightNum > 0 &&
    !isNaN(goalRateNum) &&
    goalRateNum >= 0 &&
    profileData !== undefined &&
    profileData !== null &&
    profileData.weightKg !== null;

  if (canPreview && profileData) {
    try {
      const result = computeMacroTargets({
        sex: profileData.sex,
        ageYears: profileData.ageYears,
        heightCm: profileData.heightCm,
        currentWeightKg: profileData.weightKg as number,
        activityLevel: activityLevel as ActivityLevel,
        goalWeightKg: goalWeightNum,
        goalRateKgPerWeek: goalRateNum,
      });
      liveTargetKcal = result.targetKcal;
    } catch {
      // INVALID_PROFILE_DATA, SEX_UNSET, INVALID_GOAL_RATE — show "—"
      liveTargetKcal = null;
    }
  }

  const safetyFloor =
    profileData?.sex === "FEMALE" ? SAFETY_FLOOR_FEMALE : SAFETY_FLOOR_MALE;
  const showSafetyWarning =
    liveTargetKcal !== null && liveTargetKcal < safetyFloor;

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const goalWeightValue =
        goalWeightKg !== "" && !isNaN(parseFloat(goalWeightKg))
          ? parseFloat(goalWeightKg)
          : null;
      const goalRateValue =
        goalRateKgPerWeek !== "" && !isNaN(parseFloat(goalRateKgPerWeek))
          ? parseFloat(goalRateKgPerWeek)
          : null;

      const res = await fetch("/api/daily-goals-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityLevel,
          goalWeightKg: goalWeightValue,
          goalRateKgPerWeek: goalRateValue,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        throw new Error("save_failed");
      }

      const body = (await res.json()) as { data: DailyGoalsSettingsData };
      await mutateSettings(body.data, { revalidate: false });
      // Force dashboard / targets card to re-pull computed goals
      await globalMutate(
        (key) => typeof key === "string" && key.startsWith("/api/nutrition-goals"),
      );
    } catch (err) {
      if (
        err instanceof DOMException &&
        (err.name === "TimeoutError" || err.name === "AbortError")
      ) {
        setSaveError("Request timed out. Please try again.");
      } else {
        setSaveError("Could not save. Try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Loading state
  if (settingsLoading || profileLoading) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Daily Goals</h2>
        <Skeleton className="h-12 w-full" data-slot="skeleton" />
        <Skeleton className="h-12 w-full" data-slot="skeleton" />
        <Skeleton className="h-12 w-full" data-slot="skeleton" />
        <Skeleton className="h-10 w-full" data-slot="skeleton" />
      </div>
    );
  }

  if (settingsError) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6" role="alert">
        <h2 className="text-lg font-semibold">Daily Goals</h2>
        <p className="text-sm text-destructive">Could not load daily goal settings</p>
        <Button variant="outline" className="min-h-[44px]" onClick={() => mutateSettings()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Daily Goals</h2>

      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      {/* Activity level */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium mb-1">Activity level</legend>
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Activity level">
          {ACTIVITY_LEVEL_VALUES.map((level) => {
            const isActive = activityLevel === level;
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-label={ACTIVITY_LEVEL_LABELS[level]}
                aria-checked={isActive}
                disabled={saving}
                onClick={() => setActivityLevel(level)}
                className={[
                  "text-left rounded-lg border p-3 min-h-[44px] transition-colors",
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50",
                ].join(" ")}
              >
                <span className="font-medium">{ACTIVITY_LEVEL_LABELS[level]}</span>
                {isActive && (
                  <span className="ml-2 text-xs text-primary">Selected</span>
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Goal weight */}
      <div className="flex flex-col gap-1">
        <label htmlFor="goal-weight-kg" className="text-sm font-medium">
          Goal weight (kg)
        </label>
        <Input
          id="goal-weight-kg"
          type="number"
          step="0.1"
          inputMode="decimal"
          className="min-h-[44px]"
          aria-label="Goal weight"
          value={goalWeightKg}
          onChange={(e) => setGoalWeightKg(e.target.value)}
          disabled={saving}
        />
      </div>

      {/* Goal rate */}
      <div className="flex flex-col gap-1">
        <label htmlFor="goal-rate-kg-per-week" className="text-sm font-medium">
          Goal rate (kg/week)
        </label>
        <Input
          id="goal-rate-kg-per-week"
          type="number"
          step="0.05"
          min="0"
          inputMode="decimal"
          className="min-h-[44px]"
          aria-label="Goal rate"
          value={goalRateKgPerWeek}
          onChange={(e) => setGoalRateKgPerWeek(e.target.value)}
          disabled={saving}
        />
      </div>

      {/* Live target preview */}
      {canPreview && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          Estimated daily target:{" "}
          {liveTargetKcal !== null ? (
            <span className="font-semibold">{liveTargetKcal} kcal</span>
          ) : (
            <span className="font-semibold">—</span>
          )}
        </div>
      )}

      {/* Safety floor warning */}
      {showSafetyWarning && liveTargetKcal !== null && (
        <p role="alert" className="text-sm text-warning">
          ⚠ Estimated target {liveTargetKcal} cal/day is below the {safetyFloor} cal/day safe
          minimum for unsupervised dieting.
        </p>
      )}

      <Button
        className="w-full min-h-[44px]"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
