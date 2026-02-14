"use client";

import { useState, useEffect } from "react";
import { FitbitMealType } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MealTypeSelectorProps {
  value: number;
  onChange: (id: number) => void;
  disabled?: boolean;
  showTimeHint?: boolean;
  id?: string;
  ariaLabel?: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const MEAL_TYPE_OPTIONS = [
  { id: FitbitMealType.Breakfast, label: "Breakfast" },
  { id: FitbitMealType.MorningSnack, label: "Morning Snack" },
  { id: FitbitMealType.Lunch, label: "Lunch" },
  { id: FitbitMealType.AfternoonSnack, label: "Afternoon Snack" },
  { id: FitbitMealType.Dinner, label: "Dinner" },
  { id: FitbitMealType.Anytime, label: "Anytime" },
];

export function MealTypeSelector({
  value,
  onChange,
  disabled,
  showTimeHint = true,
  id,
  ariaLabel,
}: MealTypeSelectorProps) {
  const [currentTime, setCurrentTime] = useState(() => new Date());

  useEffect(() => {
    if (!showTimeHint) return;

    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);

    return () => clearInterval(interval);
  }, [showTimeHint]);

  return (
    <div className="space-y-1">
      <Select
        value={String(value)}
        onValueChange={(val) => onChange(Number(val))}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-label={ariaLabel} className="w-full min-h-[44px]">
          <SelectValue placeholder="Select meal type" />
        </SelectTrigger>
        <SelectContent>
          {MEAL_TYPE_OPTIONS.map((option) => (
            <SelectItem
              key={option.id}
              value={String(option.id)}
              className="min-h-[44px]"
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {showTimeHint && (
        <p className="text-sm text-muted-foreground">
          Based on current time ({formatTime(currentTime)})
        </p>
      )}
    </div>
  );
}
