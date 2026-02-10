interface MacroBarsProps {
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export function MacroBars({ proteinG, carbsG, fatG }: MacroBarsProps) {
  // Round values to whole numbers
  const protein = Math.round(proteinG);
  const carbs = Math.round(carbsG);
  const fat = Math.round(fatG);

  // Calculate total for percentage width
  const total = protein + carbs + fat;

  // Calculate percentage widths (handle division by zero)
  const proteinPercent = total > 0 ? (protein / total) * 100 : 0;
  const carbsPercent = total > 0 ? (carbs / total) * 100 : 0;
  const fatPercent = total > 0 ? (fat / total) * 100 : 0;

  const macros = [
    {
      name: "Protein",
      grams: protein,
      percent: proteinPercent,
      color: "bg-blue-500",
      testId: "macro-bar-protein",
    },
    {
      name: "Carbs",
      grams: carbs,
      percent: carbsPercent,
      color: "bg-green-500",
      testId: "macro-bar-carbs",
    },
    {
      name: "Fat",
      grams: fat,
      percent: fatPercent,
      color: "bg-amber-500",
      testId: "macro-bar-fat",
    },
  ];

  return (
    <div data-testid="macro-bars" className="flex flex-col gap-3">
      {macros.map((macro) => (
        <div key={macro.name} className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-sm">
            <span className="font-medium">{macro.name}</span>
            <span className="text-muted-foreground tabular-nums">
              {macro.grams}g
            </span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              data-testid={macro.testId}
              className={`h-full ${macro.color} transition-all duration-300`}
              style={{ width: `${macro.percent}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
