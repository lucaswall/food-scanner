interface MacroBarsProps {
  proteinG: number;
  carbsG: number;
  fatG: number;
  proteinGoal?: number;
  carbsGoal?: number;
  fatGoal?: number;
}

export function MacroBars({
  proteinG,
  carbsG,
  fatG,
  proteinGoal,
  carbsGoal,
  fatGoal,
}: MacroBarsProps) {
  // Round values to whole numbers
  const protein = Math.round(proteinG);
  const carbs = Math.round(carbsG);
  const fat = Math.round(fatG);

  // Calculate total for percentage width (fallback behavior)
  const total = protein + carbs + fat;

  // Helper function to calculate percent and label for each macro
  const calculateMacroData = (
    consumed: number,
    goal: number | undefined,
    relativeTotalPercent: number
  ): { percent: number; label: string; isOverGoal: boolean } => {
    // Check if goal is provided and valid (> 0)
    const hasGoal = goal !== undefined && goal > 0;

    if (hasGoal) {
      // Goal-based calculation: min(consumed / goal, 1) * 100, capped at 100%
      const percent = Math.min((consumed / goal) * 100, 100);
      const label = `${consumed} / ${goal}g`;
      const isOverGoal = consumed > goal;
      return { percent, label, isOverGoal };
    } else {
      // Fallback to relative-to-total behavior
      return { percent: relativeTotalPercent, label: `${consumed}g`, isOverGoal: false };
    }
  };

  // Calculate percentage widths (handle division by zero)
  const proteinRelativePercent = total > 0 ? (protein / total) * 100 : 0;
  const carbsRelativePercent = total > 0 ? (carbs / total) * 100 : 0;
  const fatRelativePercent = total > 0 ? (fat / total) * 100 : 0;

  const proteinData = calculateMacroData(
    protein,
    proteinGoal,
    proteinRelativePercent
  );
  const carbsData = calculateMacroData(carbs, carbsGoal, carbsRelativePercent);
  const fatData = calculateMacroData(fat, fatGoal, fatRelativePercent);

  const macros = [
    {
      name: "Protein",
      percent: proteinData.percent,
      label: proteinData.label,
      isOverGoal: proteinData.isOverGoal,
      color: "bg-info",
      testId: "macro-bar-protein",
    },
    {
      name: "Carbs",
      percent: carbsData.percent,
      label: carbsData.label,
      isOverGoal: carbsData.isOverGoal,
      color: "bg-success",
      testId: "macro-bar-carbs",
    },
    {
      name: "Fat",
      percent: fatData.percent,
      label: fatData.label,
      isOverGoal: fatData.isOverGoal,
      color: "bg-warning",
      testId: "macro-bar-fat",
    },
  ];

  return (
    <div data-testid="macro-bars" className="flex flex-col gap-3">
      {macros.map((macro) => (
        <div key={macro.name} className="flex flex-col gap-1">
          <div className="flex justify-between items-center text-sm">
            <span className="font-medium">{macro.name}</span>
            <span className={`tabular-nums ${macro.isOverGoal ? 'text-destructive' : 'text-muted-foreground'}`}>
              {macro.label}
            </span>
          </div>
          <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
            <div
              data-testid={macro.testId}
              role="progressbar"
              aria-valuenow={macro.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${macro.name}: ${macro.label}`}
              className={`h-full ${macro.color} transition-all duration-300`}
              style={{ width: `${macro.percent}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
