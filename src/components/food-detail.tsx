"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { NutritionFactsCard } from "@/components/nutrition-facts-card";
import { ArrowLeft, AlertCircle, Star } from "lucide-react";
import { getUnitLabel, FITBIT_MEAL_TYPE_LABELS } from "@/types";
import type { FoodLogEntryDetail } from "@/types";
import { formatTime } from "@/lib/date-utils";

interface FoodDetailProps {
  entryId: string;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function FoodDetail({ entryId }: FoodDetailProps) {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<FoodLogEntryDetail>(
    `/api/food-history/${entryId}`,
    apiFetcher,
  );

  const [localFavorite, setLocalFavorite] = useState<boolean | undefined>(undefined);
  const isFavorite = localFavorite ?? data?.isFavorite ?? false;

  const handleToggleFavorite = async () => {
    if (!data) return;
    const newValue = !isFavorite;
    setLocalFavorite(newValue);
    try {
      const res = await fetch(`/api/custom-foods/${data.customFoodId}/favorite`, { method: "PATCH" });
      if (!res.ok) setLocalFavorite(!newValue);
    } catch {
      setLocalFavorite(!newValue);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-6">
        <p className="text-center text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-6">
        <Button
          onClick={() => router.back()}
          variant="ghost"
          className="min-h-[44px]"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div
          data-testid="error-container"
          className="flex flex-col items-center gap-4 p-6 bg-destructive/10 border border-destructive/20 rounded-lg text-center"
        >
          <AlertCircle data-testid="error-icon" className="h-10 w-10 text-destructive" />
          <p className="text-sm text-destructive">
            Something went wrong loading this food entry.
          </p>
          <Button
            onClick={() => mutate()}
            variant="outline"
            className="min-h-[44px]"
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-6">
      {/* Back button */}
      <Button
        onClick={() => router.back()}
        variant="ghost"
        className="min-h-[44px]"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back
      </Button>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">{data.foodName}</h1>
          <button
            aria-label="Toggle favorite"
            aria-pressed={isFavorite}
            onClick={handleToggleFavorite}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <Star
              className="h-5 w-5"
              fill={isFavorite ? "currentColor" : "none"}
            />
          </button>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {formatDate(data.date)} · {formatTime(data.time) || "Not specified"} ·{" "}
          {FITBIT_MEAL_TYPE_LABELS[data.mealTypeId] ?? "Unknown"}
        </p>
        <p className="text-sm text-muted-foreground">
          {getUnitLabel(data.unitId, data.amount)}
        </p>
      </div>

      {/* Description */}
      {data.description && (
        <div className="p-4 rounded-lg bg-muted">
          <h2 className="text-sm font-semibold mb-2">Description</h2>
          <p className="text-sm">{data.description}</p>
        </div>
      )}

      {/* Nutrition Facts */}
      <NutritionFactsCard
        foodName={data.foodName}
        calories={data.calories}
        proteinG={data.proteinG}
        carbsG={data.carbsG}
        fatG={data.fatG}
        fiberG={data.fiberG}
        sodiumMg={data.sodiumMg}
        unitId={data.unitId}
        amount={data.amount}
        mealTypeId={data.mealTypeId}
        saturatedFatG={data.saturatedFatG}
        transFatG={data.transFatG}
        sugarsG={data.sugarsG}
        caloriesFromFat={data.caloriesFromFat}
      />

      {/* Notes */}
      {data.notes && (
        <div className="p-4 rounded-lg border">
          <h2 className="text-sm font-semibold mb-2">Notes</h2>
          <p className="text-sm text-muted-foreground">{data.notes}</p>
        </div>
      )}
    </div>
  );
}
