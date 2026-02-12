"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatWeekRange, addWeeks, getTodayDate, getWeekBounds } from "@/lib/date-utils";

interface WeekNavigatorProps {
  weekStart: string;
  onWeekChange: (newStart: string) => void;
}

export function WeekNavigator({
  weekStart,
  onWeekChange,
}: WeekNavigatorProps) {
  const today = getTodayDate();
  const currentWeekBounds = getWeekBounds(today);
  const isCurrentWeek = weekStart === currentWeekBounds.start;

  const weekBounds = getWeekBounds(weekStart);
  const weekLabel = formatWeekRange(weekBounds.start, weekBounds.end);

  const handlePrevious = () => {
    onWeekChange(addWeeks(weekStart, -1));
  };

  const handleNext = () => {
    if (!isCurrentWeek) {
      onWeekChange(addWeeks(weekStart, 1));
    }
  };

  return (
    <div className="flex items-center justify-between gap-2">
      {/* Previous week button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handlePrevious}
        aria-label="Previous week"
        className="min-h-[44px] min-w-[44px] shrink-0"
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>

      {/* Week label */}
      <div className="flex flex-col items-center gap-0.5 min-w-0 flex-1">
        <span className="text-base font-medium">
          {weekLabel}
        </span>
      </div>

      {/* Next week button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleNext}
        disabled={isCurrentWeek}
        aria-label="Next week"
        className="min-h-[44px] min-w-[44px] shrink-0"
      >
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
}
