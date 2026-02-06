"use client";

import type { FoodAnalysis } from "@/types";
import { getUnitLabel } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckCircle, AlertTriangle } from "lucide-react";

interface AnalysisResultProps {
  analysis: FoodAnalysis | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  loadingStep?: string;
}

import { confidenceColors, confidenceExplanations } from "@/lib/confidence";

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
    <div className="space-y-4 p-4 border rounded-lg" aria-live="polite">
      {/* Header with food name and confidence */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{analysis.food_name}</h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                data-testid="confidence-trigger"
                className="flex items-center gap-2 cursor-help"
              >
                {analysis.confidence === "high" ? (
                  <CheckCircle
                    data-testid="confidence-icon-check"
                    className="w-4 h-4 text-green-500"
                    aria-hidden="true"
                  />
                ) : (
                  <AlertTriangle
                    data-testid="confidence-icon-alert"
                    className={`w-4 h-4 ${analysis.confidence === "medium" ? "text-yellow-500" : "text-red-500"}`}
                    aria-hidden="true"
                  />
                )}
                <div
                  data-testid="confidence-indicator"
                  aria-label={`Confidence: ${analysis.confidence}`}
                  className={`w-3 h-3 rounded-full ${confidenceColors[analysis.confidence]}`}
                />
                <span className="text-sm text-muted-foreground capitalize">
                  {analysis.confidence}
                </span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>{confidenceExplanations[analysis.confidence]}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Portion size */}
      <p className="text-sm text-muted-foreground">Portion: {getUnitLabel(analysis.unit_id, analysis.amount)}</p>

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
        {value}
        {unit}
      </span>
    </div>
  );
}
