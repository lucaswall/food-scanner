"use client";

import { useState, useEffect, useCallback } from "react";
import { FoodLogConfirmation } from "./food-log-confirmation";
import { MealTypeSelector } from "./meal-type-selector";
import { NutritionFactsCard } from "./nutrition-facts-card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { vibrateError } from "@/lib/haptics";
import {
  savePendingSubmission,
  getPendingSubmission,
  clearPendingSubmission,
} from "@/lib/pending-submission";
import { getDefaultMealType, getLocalDateTime } from "@/lib/meal-type";
import { getUnitLabel } from "@/types";
import type { CommonFood, FoodAnalysis, FoodLogResponse } from "@/types";

function foodToAnalysis(food: CommonFood): FoodAnalysis {
  return {
    food_name: food.foodName,
    amount: food.amount,
    unit_id: food.unitId,
    calories: food.calories,
    protein_g: food.proteinG,
    carbs_g: food.carbsG,
    fat_g: food.fatG,
    fiber_g: food.fiberG,
    sodium_mg: food.sodiumMg,
    confidence: "high",
    notes: "",
    keywords: [],
  };
}

export function QuickSelect() {
  const [foods, setFoods] = useState<CommonFood[]>([]);
  const [loadingFoods, setLoadingFoods] = useState(true);
  const [selectedFood, setSelectedFood] = useState<CommonFood | null>(null);
  const [mealTypeId, setMealTypeId] = useState(getDefaultMealType());
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitFoodName, setResubmitFoodName] = useState<string | null>(null);

  const fetchFoods = useCallback(async () => {
    setLoadingFoods(true);
    try {
      const response = await fetch("/api/common-foods");
      const result = await response.json();
      if (result.success) {
        setFoods(result.data.foods);
      }
    } catch {
      // Silently fail — empty state will show
    } finally {
      setLoadingFoods(false);
    }
  }, []);

  useEffect(() => {
    // Check for pending submission first
    const pending = getPendingSubmission();
    if (pending) {
      setResubmitting(true);
      setResubmitFoodName(pending.foodName);
      setMealTypeId(pending.mealTypeId);

      const dateTime = pending.date && pending.time
        ? { date: pending.date, time: pending.time }
        : getLocalDateTime();
      const body: Record<string, unknown> = { mealTypeId: pending.mealTypeId, ...dateTime };
      if (pending.reuseCustomFoodId) {
        body.reuseCustomFoodId = pending.reuseCustomFoodId;
      } else if (pending.analysis) {
        Object.assign(body, pending.analysis);
      }

      fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => r.json())
        .then((result) => {
          clearPendingSubmission();
          if (result.success) {
            setLogResponse(result.data);
          } else {
            setLogError(result.error?.message || "Failed to resubmit food log");
          }
        })
        .catch(() => {
          clearPendingSubmission();
          setLogError("Failed to resubmit food log");
        })
        .finally(() => {
          setResubmitting(false);
        });
      return;
    }

    fetchFoods();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectFood = (food: CommonFood) => {
    setSelectedFood(food);
    setMealTypeId(getDefaultMealType());
    setLogError(null);
  };

  const handleBack = () => {
    setSelectedFood(null);
    setLogError(null);
  };

  const handleLogToFitbit = async () => {
    if (!selectedFood) return;

    setLogging(true);
    setLogError(null);

    try {
      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reuseCustomFoodId: selectedFood.customFoodId,
          mealTypeId,
          ...getLocalDateTime(),
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorCode = result.error?.code;
        if (errorCode === "FITBIT_TOKEN_INVALID") {
          savePendingSubmission({
            analysis: null,
            mealTypeId,
            foodName: selectedFood.foodName,
            reuseCustomFoodId: selectedFood.customFoodId,
            ...getLocalDateTime(),
          });
          window.location.href = "/api/auth/fitbit";
          return;
        }
        setLogError(result.error?.message || "Failed to log food");
        vibrateError();
        return;
      }

      setLogResponse(result.data);
    } catch (err) {
      setLogError(err instanceof Error ? err.message : "An unexpected error occurred");
      vibrateError();
    } finally {
      setLogging(false);
    }
  };

  // Resubmitting state
  if (resubmitting) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        <p className="text-sm text-muted-foreground">
          Reconnected! Resubmitting {resubmitFoodName ?? "food"}...
        </p>
      </div>
    );
  }

  // Success screen
  if (logResponse) {
    const analysis = selectedFood ? foodToAnalysis(selectedFood) : undefined;
    return (
      <FoodLogConfirmation
        response={logResponse}
        foodName={selectedFood?.foodName ?? resubmitFoodName ?? "Food"}
        analysis={analysis}
        mealTypeId={mealTypeId}
        onDone={() => {
          setLogResponse(null);
          setSelectedFood(null);
          setLogError(null);
          fetchFoods();
        }}
      />
    );
  }

  // Detail/confirm view
  if (selectedFood) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={handleBack}
          className="min-h-[44px]"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        <NutritionFactsCard
          foodName={selectedFood.foodName}
          calories={selectedFood.calories}
          proteinG={selectedFood.proteinG}
          carbsG={selectedFood.carbsG}
          fatG={selectedFood.fatG}
          fiberG={selectedFood.fiberG}
          sodiumMg={selectedFood.sodiumMg}
          unitId={selectedFood.unitId}
          amount={selectedFood.amount}
        />

        <div className="space-y-2">
          <label className="text-sm font-medium">Meal Type</label>
          <MealTypeSelector
            value={mealTypeId}
            onChange={setMealTypeId}
            disabled={logging}
          />
        </div>

        {logError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{logError}</p>
          </div>
        )}

        <Button
          onClick={handleLogToFitbit}
          disabled={logging}
          className="w-full min-h-[44px]"
        >
          {logging ? "Logging..." : "Log to Fitbit"}
        </Button>
      </div>
    );
  }

  // Loading state
  if (loadingFoods) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">Loading recent foods...</p>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (foods.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <p className="text-muted-foreground">No recent foods</p>
      </div>
    );
  }

  // Food list
  return (
    <div className="space-y-4">
      {logError && (
        <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-sm text-destructive">{logError}</p>
        </div>
      )}

      <div className="space-y-3">
        {foods.map((food) => (
          <button
            key={food.customFoodId}
            onClick={() => handleSelectFood(food)}
            className="w-full text-left p-4 rounded-lg border bg-card min-h-[44px] active:bg-muted transition-colors"
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="font-medium">{food.foodName}</p>
                <p className="text-sm text-muted-foreground">
                  {getUnitLabel(food.unitId, food.amount)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-bold">{food.calories} cal</p>
                <p className="text-xs text-muted-foreground">
                  P:{food.proteinG}g C:{food.carbsG}g F:{food.fatG}g
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
