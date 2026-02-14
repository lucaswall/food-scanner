"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { MealGroup } from "@/types";
import { FITBIT_MEAL_TYPE_LABELS } from "@/types";

interface MealBreakdownProps {
  meals: MealGroup[];
}

// Define meal type order: Breakfast → Morning Snack → Lunch → Afternoon Snack → Dinner → Anytime
const MEAL_ORDER = [1, 2, 3, 4, 5, 7];

export function MealBreakdown({ meals }: MealBreakdownProps) {
  const [expandedMealIds, setExpandedMealIds] = useState<Set<number>>(
    new Set()
  );

  const toggleMeal = (mealTypeId: number) => {
    setExpandedMealIds((prev) => {
      const next = new Set(prev);
      if (next.has(mealTypeId)) {
        next.delete(mealTypeId);
      } else {
        next.add(mealTypeId);
      }
      return next;
    });
  };

  // Sort meals in logical order
  const sortedMeals = [...meals].sort((a, b) => {
    const orderA = MEAL_ORDER.indexOf(a.mealTypeId);
    const orderB = MEAL_ORDER.indexOf(b.mealTypeId);
    return orderA - orderB;
  });

  if (meals.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {sortedMeals.map((meal) => {
        const isExpanded = expandedMealIds.has(meal.mealTypeId);

        return (
          <div
            key={meal.mealTypeId}
            className="border rounded-lg overflow-hidden"
          >
            {/* Header */}
            <button
              type="button"
              data-testid={`meal-header-${meal.mealTypeId}`}
              onClick={() => toggleMeal(meal.mealTypeId)}
              className="w-full flex items-center justify-between p-4 min-h-[44px] hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${
                    isExpanded ? "rotate-180" : ""
                  }`}
                />
                <span className="font-medium">{FITBIT_MEAL_TYPE_LABELS[meal.mealTypeId] ?? "Other"}</span>
              </div>
              <span className="text-sm text-muted-foreground tabular-nums">
                {meal.subtotal.calories} cal
              </span>
            </button>

            {/* Entries (collapsible) */}
            {isExpanded && (
              <div className="border-t bg-muted/20">
                {meal.entries.map((entry) => (
                  <Link
                    key={entry.id}
                    href={`/app/food-detail/${entry.id}`}
                    className="flex items-center justify-between p-4 border-b last:border-b-0 hover:bg-muted/50 transition-colors cursor-pointer"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">
                        {entry.foodName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {entry.time ?? ""}
                      </span>
                    </div>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {entry.calories} cal
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
