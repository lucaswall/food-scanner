"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { apiFetcher } from "@/lib/swr";
import { FoodLogConfirmation } from "./food-log-confirmation";
import { MealTypeSelector } from "./meal-type-selector";
import { NutritionFactsCard } from "./nutrition-facts-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Search } from "lucide-react";
import { vibrateError } from "@/lib/haptics";
import {
  savePendingSubmission,
  getPendingSubmission,
  clearPendingSubmission,
} from "@/lib/pending-submission";
import { getDefaultMealType, getLocalDateTime } from "@/lib/meal-type";
import { getUnitLabel } from "@/types";
import { useDebounce } from "@/hooks/use-debounce";
import type { CommonFood, FoodAnalysis, FoodLogResponse } from "@/types";

type TabType = "suggested" | "recent";

interface PaginatedFoodsPage {
  foods: CommonFood[];
  nextCursor: unknown;
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
    description: "",
    keywords: [],
  };
}

function buildCursorParam(cursor: unknown): string {
  if (cursor == null) return "";
  return `&cursor=${encodeURIComponent(JSON.stringify(cursor))}`;
}

export function QuickSelect() {
  const [activeTab, setActiveTab] = useState<TabType>("suggested");
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedQuery = useDebounce(searchQuery, 300);
  const isSearchActive = debouncedQuery.length >= 2;

  const getKey = useCallback(
    (pageIndex: number, previousPageData: PaginatedFoodsPage | null) => {
      if (previousPageData && !previousPageData.nextCursor) return null;
      const base = activeTab === "recent"
        ? "/api/common-foods?tab=recent&limit=10"
        : "/api/common-foods?limit=10";
      if (pageIndex === 0) return base;
      const cursorParam = buildCursorParam(previousPageData!.nextCursor);
      return `${base}${cursorParam}`;
    },
    [activeTab]
  );

  const {
    data: pages,
    setSize,
    isLoading: loadingFoods,
    isValidating,
  } = useSWRInfinite<PaginatedFoodsPage>(getKey, apiFetcher, {
    revalidateFirstPage: false,
  });

  const { data: searchData, isLoading: searchLoading } = useSWR<{ foods: CommonFood[] }>(
    isSearchActive ? `/api/search-foods?q=${encodeURIComponent(debouncedQuery)}` : null,
    apiFetcher,
  );

  const foods = isSearchActive
    ? (searchData?.foods ?? [])
    : (pages?.flatMap((page) => page.foods) ?? []);
  const hasMore = !isSearchActive && pages && pages.length > 0 && pages[pages.length - 1].nextCursor != null;
  const isLoadingMore = isValidating && (pages?.length ?? 0) > 0;

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || isSearchActive) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isValidating) {
          setSize((s) => s + 1);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, isValidating, setSize, isSearchActive]);

  const [selectedFood, setSelectedFood] = useState<CommonFood | null>(null);
  const [mealTypeId, setMealTypeId] = useState(getDefaultMealType());
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitFoodName, setResubmitFoodName] = useState<string | null>(null);

  useEffect(() => {
    // Check for pending submission
    const pending = getPendingSubmission();
    if (!pending) return;

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
  }, []);

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

    // Optimistic UI: show success immediately
    const optimisticResponse: FoodLogResponse = {
      success: true,
      fitbitLogId: 0,
      reusedFood: true,
    };
    setLogResponse(optimisticResponse);

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
          setLogResponse(null);
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
        setLogResponse(null);
        setLogError(result.error?.message || "Failed to log food");
        vibrateError();
        return;
      }

      setLogResponse(result.data);
    } catch (err) {
      setLogResponse(null);
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
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
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
        onLogAnother={() => {
          setLogResponse(null);
          setSelectedFood(null);
          setLogError(null);
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
          <Label htmlFor="meal-type-quick-select">Meal Type</Label>
          <MealTypeSelector
            value={mealTypeId}
            onChange={setMealTypeId}
            disabled={logging}
            id="meal-type-quick-select"
          />
        </div>

        {logError && (
          <div role="alert" className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
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

  // Loading state (initial load, no cached data)
  if (loadingFoods && !pages) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">Loading foods...</p>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Food list with tabs and search
  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div role="tablist" className="flex gap-2">
        <button
          role="tab"
          id="tab-suggested"
          aria-selected={activeTab === "suggested"}
          onClick={() => setActiveTab("suggested")}
          className={`flex-1 min-h-[44px] rounded-lg font-medium text-sm transition-colors ${
            activeTab === "suggested"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          Suggested
        </button>
        <button
          role="tab"
          id="tab-recent"
          aria-selected={activeTab === "recent"}
          onClick={() => setActiveTab("recent")}
          className={`flex-1 min-h-[44px] rounded-lg font-medium text-sm transition-colors ${
            activeTab === "recent"
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}
        >
          Recent
        </button>
      </div>

      {/* Tab content */}
      <div role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="space-y-4">
        {/* Search input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search foods..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search foods"
            className="pl-9 min-h-[44px]"
          />
        </div>

        {logError && (
          <div role="alert" className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{logError}</p>
          </div>
        )}

        {/* Search loading state */}
        {isSearchActive && searchLoading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!searchLoading && foods.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
            <p className="text-muted-foreground">
              {isSearchActive ? "No results found" : "No foods found"}
            </p>
            {!isSearchActive && (
              <p className="text-sm text-muted-foreground">Log some foods first using the Analyze page, then they&apos;ll appear here for quick re-logging</p>
            )}
          </div>
        )}

        {/* Food cards */}
        {foods.length > 0 && (
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
        )}

        {/* Infinite scroll sentinel */}
        {hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-4">
            {isLoadingMore && (
              <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
