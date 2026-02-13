"use client";

import type { FoodAnalysis } from "@/types";
import { getUnitLabel } from "@/types";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge } from "@/components/confidence-badge";

interface AnalysisResultProps {
  analysis: FoodAnalysis | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  loadingStep?: string;
}

export function AnalysisResult({
  analysis,
  loading,
  error,
  onRetry,
  loadingStep,
}: AnalysisResultProps) {
  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-8 space-y-4"
        aria-live="assertive"
        aria-busy="true"
      >
        <div
          data-testid="loading-spinner"
          className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"
          aria-hidden="true"
        />
        <p className="text-sm text-muted-foreground">
          {loadingStep || "Analyzing your food..."}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex flex-col items-center justify-center py-8 space-y-4"
        aria-live="polite"
      >
        <p className="text-sm text-destructive">{error}</p>
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
    <div className="space-y-4 p-4 border rounded-lg" aria-live="polite">
      {/* Header with food name and confidence */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{analysis.food_name}</h2>
        <ConfidenceBadge confidence={analysis.confidence} />
      </div>

      {/* Portion size */}
      <p className="text-sm text-muted-foreground">Portion: {getUnitLabel(analysis.unit_id, analysis.amount)}</p>

      {/* Description */}
      {analysis.description && (
        <div className="pt-2 border-t">
          <p className="text-sm text-foreground">{analysis.description}</p>
        </div>
      )}

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
          <p className="text-xs text-muted-foreground italic">{analysis.notes}</p>
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
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">
        {value} {unit}
      </span>
    </div>
  );
}
