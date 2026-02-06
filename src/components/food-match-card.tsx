"use client";

import { Button } from "@/components/ui/button";
import type { FoodMatch } from "@/types";
import { getUnitLabel } from "@/types";

function formatRelativeDate(date: Date | string): string {
  const now = new Date();
  const parsed = typeof date === "string" ? new Date(date) : date;
  const diffMs = now.getTime() - parsed.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }
  const months = Math.floor(diffDays / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

interface FoodMatchCardProps {
  match: FoodMatch;
  onSelect: (match: FoodMatch) => void;
  disabled?: boolean;
}

export function FoodMatchCard({ match, onSelect, disabled }: FoodMatchCardProps) {
  return (
    <div className="p-3 rounded-lg border bg-card" data-testid="food-match-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{match.foodName}</p>
          <p className="text-sm text-muted-foreground">
            {getUnitLabel(match.unitId, match.amount)} · {match.calories} cal
          </p>
          <p className="text-sm text-muted-foreground">
            {match.proteinG}g protein · {match.carbsG}g carbs · {match.fatG}g fat
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Last logged: {formatRelativeDate(match.lastLoggedAt)}
          </p>
        </div>
        <Button
          onClick={() => onSelect(match)}
          disabled={disabled}
          variant="outline"
          className="min-h-[44px] shrink-0"
        >
          Use this
        </Button>
      </div>
    </div>
  );
}
