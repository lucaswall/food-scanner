"use client";

import { useEffect } from "react";
import type { FoodAnalysis, FoodLogResponse } from "@/types";
import { getUnitLabel, FITBIT_MEAL_TYPE_LABELS } from "@/types";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";
import { vibrateSuccess } from "@/lib/haptics";

interface FoodLogConfirmationProps {
  response: FoodLogResponse | null;
  foodName: string;
  analysis?: FoodAnalysis;
  mealTypeId?: number;
  onReset: () => void;
}

export function FoodLogConfirmation({
  response,
  foodName,
  analysis,
  mealTypeId,
  onReset,
}: FoodLogConfirmationProps) {
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
        className="w-16 h-16 text-green-500"
      />

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">
          {foodName} logged successfully!
        </h3>
        <p className="text-sm text-gray-500">
          {response.reusedFood
            ? "Reused existing food from your Fitbit library"
            : "Created new food in your Fitbit library"}
        </p>
        <p className="text-xs text-gray-400">Log ID: {response.fitbitLogId}</p>
      </div>

      {analysis && (
        <div className="w-full max-w-xs border-2 border-foreground rounded-lg p-4 text-left">
          <h4 className="text-lg font-bold border-b border-foreground pb-1">
            Nutrition Facts
          </h4>
          <p className="text-sm font-medium mt-1">{analysis.food_name}</p>
          <p className="text-sm text-muted-foreground">
            {getUnitLabel(analysis.unit_id, analysis.amount)}
          </p>
          <div className="border-t-4 border-foreground mt-2 pt-2">
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-bold">Calories</span>
              <span className="text-2xl font-bold">{analysis.calories}</span>
            </div>
          </div>
          <div className="border-t border-foreground mt-1 pt-1 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-bold">Protein</span>
              <span>{analysis.protein_g}g</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-bold">Carbs</span>
              <span>{analysis.carbs_g}g</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-bold">Fat</span>
              <span>{analysis.fat_g}g</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-bold">Fiber</span>
              <span>{analysis.fiber_g}g</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-bold">Sodium</span>
              <span>{analysis.sodium_mg}mg</span>
            </div>
          </div>
          {mealTypeId !== undefined && (
            <div className="border-t border-foreground mt-2 pt-2 text-sm text-muted-foreground">
              {FITBIT_MEAL_TYPE_LABELS[mealTypeId] ?? "Unknown"}
            </div>
          )}
        </div>
      )}

      <Button
        onClick={onReset}
        variant="outline"
        className="min-h-[44px] min-w-[120px]"
      >
        Log Another
      </Button>
    </div>
  );
}
