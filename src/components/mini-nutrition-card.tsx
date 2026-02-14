import type { FoodAnalysis } from "@/types";
import { getUnitLabel } from "@/types";

interface MiniNutritionCardProps {
  analysis: FoodAnalysis;
  previousAnalysis?: FoodAnalysis;
}

export function MiniNutritionCard({
  analysis,
  previousAnalysis,
}: MiniNutritionCardProps) {
  const changed = (field: keyof FoodAnalysis) =>
    previousAnalysis && previousAnalysis[field] !== analysis[field];

  const highlight = (isChanged: boolean | undefined) =>
    isChanged ? "font-semibold" : "";

  return (
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
  );
}
