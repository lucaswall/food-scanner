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
import type { FoodLogResponse } from "@/types";
import { formatTimeFromDate } from "@/lib/date-utils";

interface SharedFood {
  id: number;
  foodName: string;
  amount: number;
  unitId: number;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sodiumMg: number;
  saturatedFatG: number | null;
  transFatG: number | null;
  sugarsG: number | null;
  caloriesFromFat: number | null;
  confidence: string;
  notes: string | null;
  description: string | null;
  keywords: string[] | null;
}

interface LogSharedContentProps {
  token: string;
}

export function LogSharedContent({ token }: LogSharedContentProps) {
  const [mealTypeId, setMealTypeId] = useState<number>(FitbitMealType.Anytime);
  const [isLogging, setIsLogging] = useState(false);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);

  const { data, error, isLoading, mutate } = useSWR<SharedFood>(
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
          foodName={data.foodName}
        />
      </div>
    );
  }

  async function handleLog() {
    if (!data || isLogging) return;
    setIsLogging(true);

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = formatTimeFromDate(now);

    try {
      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          food_name: data.foodName,
          amount: data.amount,
          unit_id: data.unitId,
          calories: data.calories,
          protein_g: data.proteinG,
          carbs_g: data.carbsG,
          fat_g: data.fatG,
          fiber_g: data.fiberG,
          sodium_mg: data.sodiumMg,
          saturated_fat_g: data.saturatedFatG,
          trans_fat_g: data.transFatG,
          sugars_g: data.sugarsG,
          calories_from_fat: data.caloriesFromFat,
          confidence: (data.confidence as "high" | "medium" | "low") || "high",
          notes: data.notes ?? "",
          description: data.description ?? "",
          keywords: data.keywords ?? [],
          mealTypeId,
          date,
          time,
        }),
      });

      const result = await response.json();
      if (result.success) {
        setLogResponse(result.data as FoodLogResponse);
      }
    } finally {
      setIsLogging(false);
    }
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{data.foodName}</h1>
        <p className="text-sm text-muted-foreground mt-1">Shared food</p>
      </div>

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
        mealTypeId={mealTypeId}
        saturatedFatG={data.saturatedFatG}
        transFatG={data.transFatG}
        sugarsG={data.sugarsG}
        caloriesFromFat={data.caloriesFromFat}
      />

      <div className="space-y-2">
        <label className="text-sm font-medium">Meal type</label>
        <MealTypeSelector
          value={mealTypeId}
          onChange={setMealTypeId}
          disabled={isLogging}
        />
      </div>

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
