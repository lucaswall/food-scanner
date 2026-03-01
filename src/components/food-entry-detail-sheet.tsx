"use client";

import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NutritionFactsCard } from "@/components/nutrition-facts-card";
import { Button } from "@/components/ui/button";
import { Star, Share2 } from "lucide-react";
import type { FoodLogHistoryEntry } from "@/types";

interface FoodEntryDetailSheetProps {
  entry: FoodLogHistoryEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleFavorite: (entry: FoodLogHistoryEntry) => void;
  localFavorites: Map<number, boolean>;
  onShare: (entry: FoodLogHistoryEntry) => void;
  isSharing: boolean;
  shareCopied: boolean;
  shareError: string | null;
}

export function FoodEntryDetailSheet({
  entry,
  open,
  onOpenChange,
  onToggleFavorite,
  localFavorites,
  onShare,
  isSharing,
  shareCopied,
  shareError,
}: FoodEntryDetailSheetProps) {
  if (!entry) return null;

  const isFavorite = localFavorites.get(entry.customFoodId) ?? entry.isFavorite;

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onOpenChange(false);
        }
      }}
    >
      <DialogContent variant="bottom-sheet" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="sr-only">{entry.foodName}</DialogTitle>
        </DialogHeader>
        <NutritionFactsCard
          foodName={entry.foodName}
          calories={entry.calories}
          proteinG={entry.proteinG}
          carbsG={entry.carbsG}
          fatG={entry.fatG}
          fiberG={entry.fiberG}
          sodiumMg={entry.sodiumMg}
          unitId={entry.unitId}
          amount={entry.amount}
          mealTypeId={entry.mealTypeId}
          saturatedFatG={entry.saturatedFatG}
          transFatG={entry.transFatG}
          sugarsG={entry.sugarsG}
          caloriesFromFat={entry.caloriesFromFat}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              aria-label="Toggle favorite"
              aria-pressed={isFavorite}
              onClick={() => onToggleFavorite(entry)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <Star
                className="h-5 w-5"
                fill={isFavorite ? "currentColor" : "none"}
              />
            </button>
            <Button
              onClick={() => onShare(entry)}
              variant="ghost"
              size="icon"
              className="min-h-[44px] min-w-[44px]"
              aria-label="Share"
              disabled={isSharing}
            >
              <Share2 className="h-5 w-5" />
            </Button>
            {shareCopied && (
              <span className="text-xs text-green-600">Link copied!</span>
            )}
            {shareError && (
              <span className="text-xs text-destructive">{shareError}</span>
            )}
          </div>
          <Link
            href={`/app/food-detail/${entry.id}`}
            className="text-sm text-primary hover:underline min-h-[44px] flex items-center justify-center"
          >
            View Full Details
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
