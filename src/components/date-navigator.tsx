"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDisplayDate, addDays, getTodayDate } from "@/lib/date-utils";

interface DateNavigatorProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  earliestDate: string | null;
  isLoading?: boolean;
}

export function DateNavigator({
  selectedDate,
  onDateChange,
  earliestDate,
  isLoading = false,
}: DateNavigatorProps) {
  const today = getTodayDate();
  const isToday = selectedDate === today;
  const isEarliestDate = earliestDate !== null && selectedDate === earliestDate;
  const canGoBack = !isEarliestDate && earliestDate !== null;
  const canGoForward = !isToday;

  const handlePrevious = () => {
    if (canGoBack) {
      onDateChange(addDays(selectedDate, -1));
    }
  };

  const handleNext = () => {
    if (canGoForward) {
      onDateChange(addDays(selectedDate, 1));
    }
  };

  return (
    <div className="flex items-center justify-between gap-2">
      {/* Previous day button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handlePrevious}
        disabled={!canGoBack}
        aria-label="Previous day"
        className="min-h-[44px] min-w-[44px] shrink-0"
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>

      {/* Date label and Today indicator */}
      <div className="flex flex-col items-center gap-0.5 min-w-0 flex-1">
        {isLoading ? (
          <Skeleton data-testid="date-label-skeleton" className="h-6 w-32" />
        ) : (
          <span className="text-base font-medium">
            {formatDisplayDate(selectedDate)}
          </span>
        )}
      </div>

      {/* Next day button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={handleNext}
        disabled={!canGoForward}
        aria-label="Next day"
        className="min-h-[44px] min-w-[44px] shrink-0"
      >
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
}
