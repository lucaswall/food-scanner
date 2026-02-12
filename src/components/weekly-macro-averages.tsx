import type { DailyNutritionTotals } from "@/types";

interface WeeklyMacroAveragesProps {
  days: DailyNutritionTotals[];
}

export function WeeklyMacroAverages({ days }: WeeklyMacroAveragesProps) {
  // Filter out zero-calorie days
  const validDays = days.filter((day) => day.calories > 0);

  // Check if we have any data
  if (validDays.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-center">
        <p className="text-muted-foreground">No data</p>
      </div>
    );
  }

  // Calculate averages
  const avgProtein = Math.round(
    validDays.reduce((sum, day) => sum + day.proteinG, 0) / validDays.length
  );
  const avgCarbs = Math.round(
    validDays.reduce((sum, day) => sum + day.carbsG, 0) / validDays.length
  );
  const avgFat = Math.round(
    validDays.reduce((sum, day) => sum + day.fatG, 0) / validDays.length
  );

  // Calculate total for percentage width
  const total = avgProtein + avgCarbs + avgFat;

  // Calculate percentage widths (handle division by zero)
  const proteinPercent = total > 0 ? (avgProtein / total) * 100 : 0;
  const carbsPercent = total > 0 ? (avgCarbs / total) * 100 : 0;
  const fatPercent = total > 0 ? (avgFat / total) * 100 : 0;

  const macros = [
    {
      name: "Protein",
      value: avgProtein,
      percent: proteinPercent,
      color: "bg-blue-500",
    },
    {
      name: "Carbs",
      value: avgCarbs,
      percent: carbsPercent,
      color: "bg-green-500",
    },
    {
      name: "Fat",
      value: avgFat,
      percent: fatPercent,
      color: "bg-amber-500",
    },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">Weekly Averages</h3>
      <div className="flex flex-col gap-3">
        {macros.map((macro) => (
          <div key={macro.name} className="flex flex-col gap-1">
            <div className="flex justify-between items-center text-sm">
              <span className="font-medium">{macro.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {macro.value}g
              </span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full ${macro.color} transition-all duration-300`}
                style={{ width: `${macro.percent}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
