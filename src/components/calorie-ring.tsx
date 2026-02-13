interface CalorieRingProps {
  calories: number;
  goal: number;
}

export function CalorieRing({ calories, goal }: CalorieRingProps) {
  // SVG circle parameters
  const size = 128;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Calculate progress (0-1, capped at 1 for >100%)
  const progress = goal > 0 ? Math.min(calories / goal, 1) : 0;

  // Stroke dashoffset: full circumference = 0% progress, 0 = 100% progress
  const dashOffset = circumference * (1 - progress);

  // Over-goal indicators
  const isOverGoal = goal > 0 && calories > goal;

  // Format numbers with commas
  const formatNumber = (num: number): string => {
    return num.toLocaleString("en-US");
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          data-testid="calorie-ring-svg"
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
        >
          {/* Background circle (muted) */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-muted"
            opacity={0.2}
          />

          {/* Progress circle */}
          <circle
            data-testid="calorie-ring-progress"
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            className="text-primary transition-all duration-300"
          />
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold tabular-nums ${isOverGoal ? 'text-destructive' : ''}`}>
            {formatNumber(calories)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            / {formatNumber(goal)} cal
          </span>
        </div>
      </div>
    </div>
  );
}
