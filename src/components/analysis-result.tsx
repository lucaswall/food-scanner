"use client";

import { useState } from "react";
import type { FoodAnalysis } from "@/types";
import { getUnitLabel } from "@/types";
import { Button } from "@/components/ui/button";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NutritionFactsCard } from "@/components/nutrition-facts-card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ChevronDown } from "lucide-react";

interface AnalysisResultProps {
  analysis: FoodAnalysis | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  loadingStep?: string;
  narrative?: string | null;
}

export function AnalysisResult({
  analysis,
  loading,
  error,
  onRetry,
  loadingStep,
  narrative,
}: AnalysisResultProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [narrativeOpen, setNarrativeOpen] = useState(false);
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
        <Button onClick={onRetry}>
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

      {/* Main nutrition grid — tappable */}
      <button
        type="button"
        onClick={() => setDetailOpen(true)}
        aria-label={`View full nutrition details for ${analysis.food_name}`}
        className="w-full text-left cursor-pointer"
      >
        <div className="grid grid-cols-2 gap-4">
          <NutritionItem label="Calories" value={analysis.calories} unit="kcal" />
          <NutritionItem label="Protein" value={analysis.protein_g} unit="g" />
          <NutritionItem label="Carbs" value={analysis.carbs_g} unit="g" />
          <NutritionItem label="Fat" value={analysis.fat_g} unit="g" />
          <NutritionItem label="Fiber" value={analysis.fiber_g} unit="g" />
          <NutritionItem label="Sodium" value={analysis.sodium_mg} unit="mg" />
        </div>
        <p className="text-xs text-muted-foreground mt-2">Tap for full details</p>
      </button>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
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

      {/* Notes section */}
      {analysis.notes && (
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground italic">{analysis.notes}</p>
        </div>
      )}

      {/* AI Analysis narrative collapsible section */}
      {narrative && narrative.length >= 20 && (
        <div className="pt-2 border-t">
          <Collapsible open={narrativeOpen} onOpenChange={setNarrativeOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between text-sm font-medium text-foreground min-h-[44px] py-2"
              >
                <span>AI Analysis</span>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
                    narrativeOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pb-2">
                <ChatMarkdown content={narrative} />
              </div>
            </CollapsibleContent>
          </Collapsible>
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
