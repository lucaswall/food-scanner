"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { FoodAnalysis, FoodLogResponse } from "@/types";
import { Button } from "@/components/ui/button";
import { NutritionFactsCard } from "@/components/nutrition-facts-card";
import { CheckCircle } from "lucide-react";
import { vibrateSuccess } from "@/lib/haptics";

interface FoodLogConfirmationProps {
  response: FoodLogResponse | null;
  foodName: string;
  analysis?: FoodAnalysis;
  mealTypeId?: number;
}

export function FoodLogConfirmation({
  response,
  foodName,
  analysis,
  mealTypeId,
}: FoodLogConfirmationProps) {
  const router = useRouter();
  // Trigger haptic feedback on mount
  useEffect(() => {
    if (response) {
      vibrateSuccess();
    }
  }, [response]);

  if (!response) {
    return null;
  }

  return (
    <div
      className="flex flex-col items-center justify-center py-8 space-y-4 text-center animate-slide-up"
      aria-live="assertive"
    >
      <CheckCircle
        data-testid="success-icon"
        className="w-16 h-16 text-success"
        aria-hidden="true"
      />

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">
          {foodName} logged successfully!
        </h3>
        <p className="text-sm text-muted-foreground">
          {response.dryRun
            ? "Saved locally (Fitbit API skipped)"
            : response.reusedFood
              ? "Reused existing food from your Fitbit library"
              : "Created new food in your Fitbit library"}
        </p>
        {response.fitbitLogId != null && (
          <p className="text-xs text-muted-foreground">Log ID: {response.fitbitLogId}</p>
        )}
      </div>

      {analysis && (
        <div className="w-full max-w-xs text-left">
          <NutritionFactsCard
            foodName={analysis.food_name}
            calories={analysis.calories}
            proteinG={analysis.protein_g}
            carbsG={analysis.carbs_g}
            fatG={analysis.fat_g}
            fiberG={analysis.fiber_g}
            sodiumMg={analysis.sodium_mg}
            unitId={analysis.unit_id}
            amount={analysis.amount}
            mealTypeId={mealTypeId}
            saturatedFatG={analysis.saturated_fat_g}
            transFatG={analysis.trans_fat_g}
            sugarsG={analysis.sugars_g}
            caloriesFromFat={analysis.calories_from_fat}
          />
        </div>
      )}

      <div className="flex gap-3">
        <Button
          onClick={() => router.push("/app")}
          variant="outline"
          className="min-h-[44px] min-w-[120px]"
        >
          Done
        </Button>
      </div>
    </div>
  );
}
