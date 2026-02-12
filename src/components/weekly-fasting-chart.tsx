import type { FastingWindow } from "@/types";
import { addDays } from "@/lib/date-utils";

interface WeeklyFastingChartProps {
  windows: FastingWindow[];
  weekStart: string;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

export function WeeklyFastingChart({ windows, weekStart }: WeeklyFastingChartProps) {
  // Build map of date -> window for quick lookup
  const windowsByDate = new Map<string, FastingWindow>();
  for (const window of windows) {
    windowsByDate.set(window.date, window);
  }

  // Build 7-slot array (Sun–Sat) starting from weekStart
  const slots = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    const window = windowsByDate.get(date);
    slots.push({
      date,
      dayLabel: DAY_LABELS[i],
      window,
    });
  }

  return (
    <div className="grid grid-cols-7 gap-2">
      {slots.map((slot) => (
        <div
          key={slot.date}
          className="flex flex-col items-center gap-1 p-2 rounded-md border bg-card"
        >
          <span className="text-xs text-muted-foreground">{slot.dayLabel}</span>
          <span
            data-testid={`fasting-duration-${slot.date}`}
            className="text-sm font-medium"
          >
            {slot.window && slot.window.durationMinutes !== null
              ? formatDuration(slot.window.durationMinutes)
              : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}
