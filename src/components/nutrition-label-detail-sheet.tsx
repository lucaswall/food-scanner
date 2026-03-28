"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { NutritionLabel } from "@/types";

interface NutritionLabelDetailSheetProps {
  label: NutritionLabel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (label: NutritionLabel) => void;
}

function sourceLabel(source: string): string {
  if (source === "photo_scan") return "Photo scan";
  if (source === "manual") return "Manual entry";
  if (source === "chat") return "Chat entry";
  return source;
}

function NutritionRow({ label, value, unit }: { label: string; value: number | null | undefined; unit: string }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}{unit}</span>
    </div>
  );
}

export function NutritionLabelDetailSheet({
  label,
  open,
  onOpenChange,
  onDelete,
}: NutritionLabelDetailSheetProps) {
  if (!label) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="bottom-sheet" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="sr-only">{label.productName}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 pb-2">
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">{label.brand}</p>
            <p className="text-lg font-semibold">
              {label.productName}
              {label.variant && <span className="text-muted-foreground font-normal"> — {label.variant}</span>}
            </p>
            <p className="text-sm text-muted-foreground">Serving: {label.servingSizeLabel}</p>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex justify-between text-sm font-semibold">
              <span>Calories</span>
              <span>{label.calories}</span>
            </div>
            <div className="border-t pt-2 flex flex-col gap-1">
              <NutritionRow label="Protein" value={label.proteinG} unit="g" />
              <NutritionRow label="Carbs" value={label.carbsG} unit="g" />
              <NutritionRow label="Fat" value={label.fatG} unit="g" />
              <NutritionRow label="Fiber" value={label.fiberG} unit="g" />
              <NutritionRow label="Sodium" value={label.sodiumMg} unit="mg" />
              <NutritionRow label="Saturated Fat" value={label.saturatedFatG} unit="g" />
              <NutritionRow label="Trans Fat" value={label.transFatG} unit="g" />
              <NutritionRow label="Sugars" value={label.sugarsG} unit="g" />
            </div>
          </div>

          {label.extraNutrients && Object.keys(label.extraNutrients).length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Additional Nutrients</p>
              <div className="flex flex-col gap-1">
                {Object.entries(label.extraNutrients).map(([name, value]) => (
                  <div key={name} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
              {sourceLabel(label.source)}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(label.createdAt).toLocaleDateString()}
            </span>
          </div>

          {label.notes && (
            <p className="text-sm text-muted-foreground">{label.notes}</p>
          )}

          <Button
            variant="destructive"
            className="w-full min-h-[44px]"
            onClick={() => onDelete(label)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Label
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
