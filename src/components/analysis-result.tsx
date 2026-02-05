"use client";

import type { FoodAnalysis } from "@/types";
import { Button } from "@/components/ui/button";

interface AnalysisResultProps {
  analysis: FoodAnalysis | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

const confidenceColors = {
  high: "bg-green-500",
  medium: "bg-yellow-500",
  low: "bg-red-500",
} as const;

export function AnalysisResult({
  analysis,
  loading,
  error,
  onRetry,
}: AnalysisResultProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <div
          data-testid="loading-spinner"
          className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"
        />
        <p className="text-sm text-gray-500">Analyzing your food...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <p className="text-sm text-red-500">{error}</p>
        <Button onClick={onRetry} variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  if (!analysis) {
    return null;
  }

  return (
    <div className="space-y-4 p-4 border rounded-lg">
      {/* Header with food name and confidence */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{analysis.food_name}</h3>
        <div className="flex items-center gap-2">
          <div
            data-testid="confidence-indicator"
            className={`w-3 h-3 rounded-full ${confidenceColors[analysis.confidence]}`}
          />
          <span className="text-sm text-gray-500 capitalize">
            {analysis.confidence}
          </span>
        </div>
      </div>

      {/* Portion size */}
      <p className="text-sm text-gray-600">Portion: {analysis.portion_size_g}g</p>

      {/* Main nutrition grid */}
      <div className="grid grid-cols-2 gap-4">
        <NutritionItem label="Calories" value={analysis.calories} unit="kcal" />
        <NutritionItem label="Protein" value={analysis.protein_g} unit="g" />
        <NutritionItem label="Carbs" value={analysis.carbs_g} unit="g" />
        <NutritionItem label="Fat" value={analysis.fat_g} unit="g" />
        <NutritionItem label="Fiber" value={analysis.fiber_g} unit="g" />
        <NutritionItem label="Sodium" value={analysis.sodium_mg} unit="mg" />
      </div>

      {/* Notes section */}
      {analysis.notes && (
        <div className="pt-2 border-t">
          <p className="text-xs text-gray-500 italic">{analysis.notes}</p>
        </div>
      )}
    </div>
  );
}

interface NutritionItemProps {
  label: string;
  value: number;
  unit: string;
}

function NutritionItem({ label, value, unit }: NutritionItemProps) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-600">{label}</span>
      <span className="text-sm font-medium">
        {value}
        {unit}
      </span>
    </div>
  );
}
