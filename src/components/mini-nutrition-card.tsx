"use client";

import { useState } from "react";
import type { FoodAnalysis } from "@/types";
import { getUnitLabel } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NutritionFactsCard } from "@/components/nutrition-facts-card";

interface MiniNutritionCardProps {
  analysis: FoodAnalysis;
  previousAnalysis?: FoodAnalysis;
}

export function MiniNutritionCard({
  analysis,
  previousAnalysis,
}: MiniNutritionCardProps) {
  const [open, setOpen] = useState(false);

  const changed = (field: keyof FoodAnalysis) =>
    previousAnalysis && previousAnalysis[field] !== analysis[field];

  const highlight = (isChanged: boolean | undefined) =>
    isChanged ? "font-semibold" : "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`View full nutrition details for ${analysis.food_name}`}
        className="w-full text-left cursor-pointer"
      >
        <div className="border rounded-lg p-2 text-sm space-y-1">
          {/* Food name and serving */}
          <div>
            <p className={`font-medium ${highlight(changed("food_name"))}`}>
              {analysis.food_name}
            </p>
            <p className={`text-xs text-muted-foreground ${highlight(changed("amount") || changed("unit_id"))}`}>
              {getUnitLabel(analysis.unit_id, analysis.amount)}
            </p>
          </div>

          {/* Calories */}
          <div className="flex items-baseline gap-1">
            <span className={`text-lg font-bold ${highlight(changed("calories"))}`}>
              {analysis.calories}
            </span>
            <span className="text-xs text-muted-foreground">cal</span>
          </div>

          {/* Macros row */}
          <div className="flex gap-3 text-xs">
            <span className={highlight(changed("protein_g"))}>
              P: {analysis.protein_g}g
            </span>
            <span className={highlight(changed("carbs_g"))}>
              C: {analysis.carbs_g}g
            </span>
            <span className={highlight(changed("fat_g"))}>
              F: {analysis.fat_g}g
            </span>
          </div>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent variant="bottom-sheet" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="sr-only">{analysis.food_name}</DialogTitle>
          </DialogHeader>
          <NutritionFactsCard
            foodName={analysis.food_name}
            calories={analysis.calories}
            proteinG={analysis.protein_g}
            carbsG={analysis.carbs_g}
            fatG={analysis.fat_g}
            fiberG={analysis.fiber_g}
            sodiumMg={analysis.sodium_mg}
            unitId={analysis.unit_id}
            amount={analysis.amount}
            saturatedFatG={analysis.saturated_fat_g}
            transFatG={analysis.trans_fat_g}
            sugarsG={analysis.sugars_g}
            caloriesFromFat={analysis.calories_from_fat}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
