"use client";

import type { FoodAnalysis } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface NutritionEditorProps {
  value: FoodAnalysis;
  onChange: (analysis: FoodAnalysis) => void;
  disabled?: boolean;
}

const confidenceColors = {
  high: "bg-green-500",
  medium: "bg-yellow-500",
  low: "bg-red-500",
} as const;

export function NutritionEditor({
  value,
  onChange,
  disabled,
}: NutritionEditorProps) {
  const handleStringChange = (field: keyof FoodAnalysis, newValue: string) => {
    onChange({ ...value, [field]: newValue });
  };

  const handleNumberChange = (field: keyof FoodAnalysis, newValue: string) => {
    const num = parseFloat(newValue);
    // Reject negative numbers
    if (num < 0) return;
    // Allow empty/NaN to clear the field (will show as empty input)
    onChange({ ...value, [field]: isNaN(num) ? 0 : num });
  };

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      {/* Header with confidence indicator */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Edit Nutrition</h3>
        <div className="flex items-center gap-2">
          <div
            data-testid="confidence-indicator"
            className={`w-3 h-3 rounded-full ${confidenceColors[value.confidence]}`}
          />
          <span className="text-sm text-gray-500 capitalize">
            {value.confidence}
          </span>
        </div>
      </div>

      {/* Food name */}
      <div className="space-y-2">
        <Label htmlFor="food_name">Food Name</Label>
        <Input
          id="food_name"
          type="text"
          value={value.food_name}
          onChange={(e) => handleStringChange("food_name", e.target.value)}
          disabled={disabled}
          className="min-h-[44px]"
        />
      </div>

      {/* Portion size */}
      <div className="space-y-2">
        <Label htmlFor="portion_size_g">Portion (g)</Label>
        <Input
          id="portion_size_g"
          type="number"
          min="0"
          value={value.portion_size_g}
          onChange={(e) => handleNumberChange("portion_size_g", e.target.value)}
          disabled={disabled}
          className="min-h-[44px]"
        />
      </div>

      {/* Nutrition grid */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="calories">Calories</Label>
          <Input
            id="calories"
            type="number"
            min="0"
            value={value.calories}
            onChange={(e) => handleNumberChange("calories", e.target.value)}
            disabled={disabled}
            className="min-h-[44px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="protein_g">Protein (g)</Label>
          <Input
            id="protein_g"
            type="number"
            min="0"
            step="0.1"
            value={value.protein_g}
            onChange={(e) => handleNumberChange("protein_g", e.target.value)}
            disabled={disabled}
            className="min-h-[44px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="carbs_g">Carbs (g)</Label>
          <Input
            id="carbs_g"
            type="number"
            min="0"
            step="0.1"
            value={value.carbs_g}
            onChange={(e) => handleNumberChange("carbs_g", e.target.value)}
            disabled={disabled}
            className="min-h-[44px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="fat_g">Fat (g)</Label>
          <Input
            id="fat_g"
            type="number"
            min="0"
            step="0.1"
            value={value.fat_g}
            onChange={(e) => handleNumberChange("fat_g", e.target.value)}
            disabled={disabled}
            className="min-h-[44px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="fiber_g">Fiber (g)</Label>
          <Input
            id="fiber_g"
            type="number"
            min="0"
            step="0.1"
            value={value.fiber_g}
            onChange={(e) => handleNumberChange("fiber_g", e.target.value)}
            disabled={disabled}
            className="min-h-[44px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="sodium_mg">Sodium (mg)</Label>
          <Input
            id="sodium_mg"
            type="number"
            min="0"
            value={value.sodium_mg}
            onChange={(e) => handleNumberChange("sodium_mg", e.target.value)}
            disabled={disabled}
            className="min-h-[44px]"
          />
        </div>
      </div>

      {/* Notes section (read-only) */}
      {value.notes && (
        <div className="pt-2 border-t">
          <p className="text-xs text-gray-500 italic">{value.notes}</p>
        </div>
      )}
    </div>
  );
}
