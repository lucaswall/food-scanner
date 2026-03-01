"use client";

import { Button } from "@/components/ui/button";
import { Star, Pencil, Trash2 } from "lucide-react";
import { getUnitLabel, FITBIT_MEAL_TYPE_LABELS } from "@/types";
import { formatTime } from "@/lib/date-utils";

interface FoodEntryCardProps {
  foodName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  unitId: number;
  amount: number;
  time?: string | null;
  mealTypeId?: number;
  onClick?: () => void;
  actions?: "none" | "favorite" | "edit-delete";
  isFavorite?: boolean;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
}

export function FoodEntryCard({
  foodName,
  calories,
  proteinG,
  carbsG,
  fatG,
  unitId,
  amount,
  time,
  mealTypeId,
  onClick,
  actions = "none",
  isFavorite,
  onToggleFavorite,
  onEdit,
  onDelete,
  isDeleting,
}: FoodEntryCardProps) {
  const metaParts: string[] = [];
  const formattedTime = time ? formatTime(time) : "";
  if (formattedTime) metaParts.push(formattedTime);
  if (mealTypeId != null) metaParts.push(FITBIT_MEAL_TYPE_LABELS[mealTypeId] ?? "Unknown");
  metaParts.push(getUnitLabel(unitId, amount));
  const metaText = metaParts.join(" · ");

  const hasActions = actions !== "none";

  return (
    <div className="flex items-center rounded-lg border bg-card">
      <button
        type="button"
        className={`flex-1 min-w-0 text-left p-3 min-h-[44px] active:bg-muted transition-colors${hasActions ? "" : " rounded-lg"}`}
        onClick={onClick}
        aria-label={`${foodName}, ${calories} calories`}
      >
        {/* Row 1: Food name — full width, no truncation */}
        <p className="font-medium">{foodName}</p>

        {/* Row 2: Metadata */}
        <p className="text-xs text-muted-foreground mt-0.5">{metaText}</p>

        {/* Row 3: Calories + macros */}
        <p className="text-sm text-muted-foreground mt-0.5">
          {calories} cal · P:{proteinG}g · C:{carbsG}g · F:{fatG}g
        </p>
      </button>

      {actions === "favorite" && (
        <button
          aria-label="Toggle favorite"
          aria-pressed={!!isFavorite}
          onClick={onToggleFavorite}
          className={`min-h-[44px] min-w-[44px] shrink-0 mr-1 flex items-center justify-center${isFavorite ? " text-amber-500" : " text-muted-foreground"}`}
        >
          <Star className="h-4 w-4" fill={isFavorite ? "currentColor" : "none"} />
        </button>
      )}

      {actions === "edit-delete" && (
        <>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-[44px] min-w-[44px] shrink-0"
            onClick={onEdit}
            aria-label={`Edit ${foodName}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="min-h-[44px] min-w-[44px] shrink-0 text-destructive hover:text-destructive mr-1"
            onClick={onDelete}
            disabled={isDeleting}
            aria-label={`Delete ${foodName}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}
