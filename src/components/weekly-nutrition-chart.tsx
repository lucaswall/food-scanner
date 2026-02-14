"use client";

import { useState } from "react";
import type { DailyNutritionTotals } from "@/types";
import { addDays } from "@/lib/date-utils";

interface WeeklyNutritionChartProps {
  days: DailyNutritionTotals[];
  weekStart: string;
}

type MetricType = "calories" | "protein" | "carbs" | "fat";

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

const METRICS = [
  { key: "calories" as const, label: "Calories" },
  { key: "protein" as const, label: "Protein" },
  { key: "carbs" as const, label: "Carbs" },
  { key: "fat" as const, label: "Fat" },
];

// Helper to extract value and goal for a given metric
function getMetricData(day: DailyNutritionTotals | null, metric: MetricType) {
  if (!day) return { value: 0, goal: null };

  switch (metric) {
    case "calories":
      return { value: day.calories, goal: day.calorieGoal };
    case "protein":
      return { value: day.proteinG, goal: day.proteinGoalG };
    case "carbs":
      return { value: day.carbsG, goal: day.carbsGoalG };
    case "fat":
      return { value: day.fatG, goal: day.fatGoalG };
  }
}

export function WeeklyNutritionChart({ days, weekStart }: WeeklyNutritionChartProps) {
  const [selectedMetric, setSelectedMetric] = useState<MetricType>("calories");

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

  // Find max value for scaling (include both actual values and goals)
  const maxValue = Math.max(
    ...weekDays
      .filter((day) => day.data !== null && day.data.calories > 0)
      .flatMap((day) => {
        const { value, goal } = getMetricData(day.data, selectedMetric);
        // Include both value and goal (if goal exists) in the max calculation
        return goal !== null ? [value, goal] : [value];
      }),
    1 // Minimum of 1 to avoid division by zero
  );

  // Calculate goal consistency for the selected metric
  const daysWithData = weekDays.filter((day) => day.data !== null && day.data.calories > 0);
  const daysWithGoals = daysWithData.filter((day) => {
    const { goal } = getMetricData(day.data, selectedMetric);
    return goal !== null;
  });
  const totalWithGoal = daysWithGoals.length;
  const onTarget = daysWithGoals.filter((day) => {
    const { value, goal } = getMetricData(day.data, selectedMetric);
    return goal !== null && value <= goal;
  }).length;

  // Calculate net surplus/deficit for the selected metric
  const netDiff = Math.round(
    daysWithGoals.reduce((sum, day) => {
      const { value, goal } = getMetricData(day.data, selectedMetric);
      return sum + (value - (goal ?? 0));
    }, 0)
  );
  const unit = selectedMetric === "calories" ? "kcal" : "g";

  return (
    <div className="space-y-4">
      {/* Metric selector */}
      <div role="tablist" className="flex gap-1 p-1 bg-muted rounded-full">
        {METRICS.map((metric) => {
          const isSelected = selectedMetric === metric.key;
          return (
            <button
              key={metric.key}
              role="tab"
              aria-selected={isSelected}
              data-testid={`metric-${metric.key}`}
              onClick={() => setSelectedMetric(metric.key)}
              className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors min-h-[44px] ${
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {metric.label}
            </button>
          );
        })}
      </div>

      {/* Goal consistency indicator */}
      {totalWithGoal > 0 && (
        <p className="text-sm text-muted-foreground" data-testid="goal-consistency">
          {onTarget}/{totalWithGoal} days on target
        </p>
      )}

      {/* Chart container */}
      <div className="flex items-end gap-2 h-48">
        {weekDays.map((day, index) => {
          const { value, goal } = getMetricData(day.data, selectedMetric);
          const isEmpty = day.data === null || value === 0;

          // Calculate bar height as percentage of max
          const barHeightPercent = isEmpty ? 0 : (value / maxValue) * 100;

          // Calculate goal marker position as percentage
          const goalHeightPercent = goal ? (goal / maxValue) * 100 : 0;

          // Determine bar color
          let barColor = "bg-primary";
          if (!isEmpty && goal !== null) {
            barColor = value <= goal ? "bg-success" : "bg-warning";
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
                {goal !== null && goalHeightPercent > 0 && (
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

      {/* Net surplus/deficit summary */}
      {totalWithGoal > 0 && (
        <p
          className={`text-sm font-medium ${
            netDiff > 0
              ? "text-warning"
              : "text-success"
          }`}
          data-testid="net-surplus-deficit"
        >
          {netDiff === 0
            ? "On target"
            : netDiff > 0
            ? `+${netDiff} ${unit} over`
            : `${netDiff} ${unit} under`}
        </p>
      )}
    </div>
  );
}
