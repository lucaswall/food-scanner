"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { NutritionFactsCard } from "@/components/nutrition-facts-card";
import { MealTypeSelector } from "@/components/meal-type-selector";
import { FoodLogConfirmation } from "@/components/food-log-confirmation";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { FitbitMealType } from "@/types";
import type { FoodAnalysis, FoodLogResponse } from "@/types";
import { getLocalDateTime } from "@/lib/meal-type";

interface LogSharedContentProps {
  token: string;
}

export function LogSharedContent({ token }: LogSharedContentProps) {
  const [mealTypeId, setMealTypeId] = useState<number>(FitbitMealType.Anytime);
  const [isLogging, setIsLogging] = useState(false);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);
  const [logError, setLogError] = useState<string | null>(null);

  const { data, error, isLoading, mutate } = useSWR<FoodAnalysis>(
    `/api/shared-food/${token}`,
    apiFetcher,
  );

  if (isLoading) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-6">
        <p className="text-center text-muted-foreground">Loading shared food...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-md mx-auto p-4 space-y-6">
        <div
          data-testid="error-container"
          className="flex flex-col items-center gap-4 p-6 bg-destructive/10 border border-destructive/20 rounded-lg text-center"
        >
          <AlertCircle data-testid="error-icon" className="h-10 w-10 text-destructive" />
          <p className="text-sm text-destructive">
            This shared food link is invalid or has expired.
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

  if (!data) return null;

  if (logResponse) {
    return (
      <div className="max-w-md mx-auto p-4">
        <FoodLogConfirmation
          response={logResponse}
          foodName={data.food_name}
        />
      </div>
    );
  }

  async function handleLog() {
    if (!data || isLogging) return;
    setIsLogging(true);
    setLogError(null);

    const { date, time, zoneOffset } = getLocalDateTime();

    try {
      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          notes: data.notes ?? "",
          description: data.description ?? "",
          keywords: data.keywords ?? [],
          mealTypeId,
          date,
          time,
          zoneOffset,
        }),
      });

      if (!response.ok) {
        setLogError("Failed to log food. Please try again.");
        return;
      }

      const result = await response.json();
      if (result.success) {
        setLogResponse(result.data as FoodLogResponse);
      } else {
        setLogError(result.error?.message ?? "Failed to log food. Please try again.");
      }
    } catch {
      setLogError("Network error. Please check your connection and try again.");
    } finally {
      setIsLogging(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{data.food_name}</h1>
        <p className="text-sm text-muted-foreground mt-1">Shared food</p>
      </div>

      <NutritionFactsCard
        foodName={data.food_name}
        calories={data.calories}
        proteinG={data.protein_g}
        carbsG={data.carbs_g}
        fatG={data.fat_g}
        fiberG={data.fiber_g}
        sodiumMg={data.sodium_mg}
        unitId={data.unit_id}
        amount={data.amount}
        mealTypeId={mealTypeId}
        saturatedFatG={data.saturated_fat_g}
        transFatG={data.trans_fat_g}
        sugarsG={data.sugars_g}
        caloriesFromFat={data.calories_from_fat}
      />

      <div className="space-y-2">
        <label className="text-sm font-medium">Meal type</label>
        <MealTypeSelector
          value={mealTypeId}
          onChange={setMealTypeId}
          disabled={isLogging}
        />
      </div>

      {logError && (
        <p className="text-sm text-destructive text-center">{logError}</p>
      )}

      <Button
        onClick={handleLog}
        disabled={isLogging}
        className="w-full min-h-[44px]"
      >
        {isLogging ? "Logging..." : "Log to Fitbit"}
      </Button>
    </div>
  );
}
