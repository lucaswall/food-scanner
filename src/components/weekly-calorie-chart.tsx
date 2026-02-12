"use client";

import type { DailyNutritionTotals } from "@/types";
import { addDays } from "@/lib/date-utils";

interface WeeklyCalorieChartProps {
  days: DailyNutritionTotals[];
  weekStart: string;
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function WeeklyCalorieChart({ days, weekStart }: WeeklyCalorieChartProps) {
  // Build 7-slot array for the week (Sunday - Saturday)
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const dayData = days.find((d) => d.date === date);
    return {
      date,
      data: dayData ?? null,
    };
  });

  // Check if we have any data
  const hasData = weekDays.some((day) => day.data !== null && day.data.calories > 0);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center py-8 text-center">
        <p className="text-muted-foreground">
          Log food for a few days to see weekly trends
        </p>
      </div>
    );
  }

  // Find max calories for scaling (only from days with data)
  const maxCalories = Math.max(
    ...weekDays
      .filter((day) => day.data !== null && day.data.calories > 0)
      .map((day) => day.data!.calories),
    1 // Minimum of 1 to avoid division by zero
  );

  return (
    <div className="space-y-4">
      {/* Chart container */}
      <div className="flex items-end gap-2 h-48">
        {weekDays.map((day, index) => {
          const isEmpty = day.data === null || day.data.calories === 0;
          const calories = day.data?.calories ?? 0;
          const calorieGoal = day.data?.calorieGoal ?? null;

          // Calculate bar height as percentage of max
          const barHeightPercent = isEmpty ? 0 : (calories / maxCalories) * 100;

          // Calculate goal marker position as percentage
          const goalHeightPercent = calorieGoal ? (calorieGoal / maxCalories) * 100 : 0;

          // Determine bar color
          let barColor = "bg-primary";
          if (!isEmpty && calorieGoal !== null) {
            barColor = calories <= calorieGoal ? "bg-green-500" : "bg-amber-500";
          }

          return (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-2">
              {/* Bar container */}
              <div className="relative w-full h-40 flex items-end">
                {/* Bar */}
                <div
                  data-testid={`day-bar-${day.date}`}
                  className={`w-full rounded-t-md transition-all ${barColor} ${
                    isEmpty ? "opacity-30" : ""
                  }`}
                  style={{ height: `${barHeightPercent}%` }}
                />

                {/* Goal marker */}
                {calorieGoal !== null && goalHeightPercent > 0 && (
                  <div
                    data-testid={`goal-marker-${day.date}`}
                    className="absolute left-0 right-0 border-t-2 border-dashed border-muted-foreground"
                    style={{ bottom: `${goalHeightPercent}%` }}
                  />
                )}
              </div>

              {/* Day label */}
              <span className="text-xs text-muted-foreground font-medium">
                {DAY_LABELS[index]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
