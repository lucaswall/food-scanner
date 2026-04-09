"use client";

import { X } from "lucide-react";
import type { FoodAnalysis } from "@/types";
import { FITBIT_MEAL_TYPE_LABELS } from "@/types";

interface SessionItemsListProps {
  items: FoodAnalysis[];
  onRemoveItem?: (index: number) => void;
}

function formatTime(time: string): string {
  const [hourStr, minuteStr] = time.split(":");
  const hour = parseInt(hourStr, 10);
  const minute = minuteStr ?? "00";
  const period = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minute} ${period}`;
}

const confidenceBadgeColor: Record<FoodAnalysis["confidence"], string> = {
  high: "bg-success",
  medium: "bg-warning",
  low: "bg-orange-400",
};

export function SessionItemsList({ items, onRemoveItem }: SessionItemsListProps) {
  if (items.length === 0) {
    return (
      <p
        data-testid="session-items-empty"
        className="text-sm text-muted-foreground text-center py-4"
      >
        No items to display.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={index}
          data-testid={`session-item-${index}`}
          className="flex items-start gap-2 rounded-lg border p-3"
        >
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-sm font-bold truncate">{item.food_name}</p>

            <p className="text-xs text-muted-foreground">
              {item.calories} cal · {item.protein_g}p · {item.carbs_g}c · {item.fat_g}f
            </p>

            {(item.time != null || item.mealTypeId != null) && (
              <p
                data-testid={`item-time-${index}`}
                className="text-xs text-muted-foreground"
              >
                {item.time != null && formatTime(item.time)}
                {item.time != null && item.mealTypeId != null && " · "}
                {item.mealTypeId != null && (FITBIT_MEAL_TYPE_LABELS[item.mealTypeId] ?? "")}
              </p>
            )}

            <div className="flex items-center gap-1.5">
              <div
                data-testid={`confidence-badge-${index}`}
                className={`w-2.5 h-2.5 rounded-full ${confidenceBadgeColor[item.confidence]}`}
              />
              <span className="text-xs text-muted-foreground capitalize">
                {item.confidence}
              </span>
            </div>
          </div>

          {onRemoveItem && (
            <button
              type="button"
              data-testid={`remove-item-${index}`}
              onClick={() => onRemoveItem(index)}
              aria-label={`Remove ${item.food_name}`}
              className="flex items-center justify-center min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
