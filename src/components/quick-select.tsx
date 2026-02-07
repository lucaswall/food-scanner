"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { FoodLogConfirmation } from "./food-log-confirmation";
import { MealTypeSelector } from "./meal-type-selector";
import { Button } from "@/components/ui/button";
import { Camera, ArrowLeft } from "lucide-react";
import { vibrateError } from "@/lib/haptics";
import {
  savePendingSubmission,
  getPendingSubmission,
  clearPendingSubmission,
} from "@/lib/pending-submission";
import {
  getUnitLabel,
} from "@/types";
import type { CommonFood, FoodAnalysis, FoodLogResponse } from "@/types";

function getDefaultMealType(): number {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 10) return 1;
  if (hour >= 10 && hour < 12) return 2;
  if (hour >= 12 && hour < 14) return 3;
  if (hour >= 14 && hour < 17) return 4;
  if (hour >= 17 && hour < 21) return 5;
  return 7;
}

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

      const body: Record<string, unknown> = { mealTypeId: pending.mealTypeId };
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

  const handleReset = () => {
    setSelectedFood(null);
    setLogResponse(null);
    setLogError(null);
    setMealTypeId(getDefaultMealType());
    fetchFoods();
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
        onReset={handleReset}
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

        <div className="border-2 border-foreground rounded-lg p-4">
          <h4 className="text-lg font-bold border-b border-foreground pb-1">
            Nutrition Facts
          </h4>
          <p className="text-sm font-medium mt-1">{selectedFood.foodName}</p>
          <p className="text-sm text-muted-foreground">
            {getUnitLabel(selectedFood.unitId, selectedFood.amount)}
          </p>
          <div className="border-t-4 border-foreground mt-2 pt-2">
            <div className="flex justify-between items-baseline">
              <span className="text-sm font-bold">Calories</span>
              <span className="text-2xl font-bold">{selectedFood.calories}</span>
            </div>
          </div>
          <div className="border-t border-foreground mt-1 pt-1 space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-bold">Protein</span>
              <span>{selectedFood.proteinG}g</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-bold">Carbs</span>
              <span>{selectedFood.carbsG}g</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-bold">Fat</span>
              <span>{selectedFood.fatG}g</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-bold">Fiber</span>
              <span>{selectedFood.fiberG}g</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-bold">Sodium</span>
              <span>{selectedFood.sodiumMg}mg</span>
            </div>
          </div>
        </div>

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
        <Link
          href="/app/analyze"
          className="flex items-center justify-center gap-2 w-full min-h-[44px] rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
        >
          <Camera className="h-4 w-4" />
          Take Photo
        </Link>
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
        <Link
          href="/app/analyze"
          className="flex items-center justify-center gap-2 min-h-[44px] rounded-md bg-primary text-primary-foreground px-6 py-2 text-sm font-medium"
        >
          <Camera className="h-4 w-4" />
          Take Photo
        </Link>
      </div>
    );
  }

  // Food list
  return (
    <div className="space-y-4">
      <Link
        href="/app/analyze"
        className="flex items-center justify-center gap-2 w-full min-h-[44px] rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
      >
        <Camera className="h-4 w-4" />
        Take Photo
      </Link>

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

      <Link
        href="/app/analyze"
        className="flex items-center justify-center gap-2 w-full min-h-[44px] rounded-md border border-input bg-background px-4 py-2 text-sm font-medium"
      >
        <Camera className="h-4 w-4" />
        Take Photo
      </Link>
    </div>
  );
}
