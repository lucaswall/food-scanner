"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { apiFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type MacroProfileKey = "muscle_preserve" | "metabolic_flex";

interface MacroProfileResponse {
  profile: MacroProfileKey;
  name: string;
  available: { key: MacroProfileKey; name: string; description: string }[];
}

export function MacroProfileCard() {
  const { mutate: globalMutate } = useSWRConfig();
  const { data, error, isLoading, mutate } = useSWR<MacroProfileResponse>(
    "/api/macro-profile",
    apiFetcher,
  );
  const [saving, setSaving] = useState<MacroProfileKey | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function selectProfile(key: MacroProfileKey) {
    if (!data || data.profile === key || saving) return;
    setSaving(key);
    setSaveError(null);
    try {
      const res = await fetch("/api/macro-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: key }),
      });
      if (!res.ok) throw new Error("save_failed");
      const body = (await res.json()) as { data: MacroProfileResponse };
      await mutate(body.data, { revalidate: false });
      // Force the dashboard / targets card to re-pull computed goals under the new profile.
      await globalMutate(
        (swrKey) => typeof swrKey === "string" && swrKey.startsWith("/api/nutrition-goals"),
      );
    } catch {
      setSaveError("Could not save. Try again.");
    } finally {
      setSaving(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Macro Profile</h2>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (error || !data || !Array.isArray(data.available)) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6" role="alert">
        <h2 className="text-lg font-semibold">Macro Profile</h2>
        <p className="text-sm text-destructive">Could not load macro profile</p>
        <Button variant="outline" className="min-h-[44px]" onClick={() => mutate()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Macro Profile</h2>
      <p className="text-xs text-muted-foreground">
        Sets the formula used to compute your daily protein, carbs, and fat targets.
      </p>

      {saveError && (
        <p className="text-sm text-destructive" role="alert">
          {saveError}
        </p>
      )}

      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Macro profile">
        {data.available.map((option) => {
          const isActive = data.profile === option.key;
          const isPending = saving === option.key;
          return (
            <button
              key={option.key}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={saving !== null}
              onClick={() => selectProfile(option.key)}
              className={[
                "text-left rounded-lg border p-3 min-h-[44px] transition-colors",
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{option.name}</span>
                {isActive && <span className="text-xs text-primary">Active</span>}
                {isPending && <span className="text-xs text-muted-foreground">Saving…</span>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {option.description}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
