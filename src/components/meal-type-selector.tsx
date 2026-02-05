"use client";

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
}: MealTypeSelectorProps) {
  return (
    <Select
      value={String(value)}
      onValueChange={(val) => onChange(Number(val))}
      disabled={disabled}
    >
      <SelectTrigger className="w-full min-h-[44px]">
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
  );
}
