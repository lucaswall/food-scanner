"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CheckCircle, AlertTriangle } from "lucide-react";
import { confidenceColors, confidenceExplanations } from "@/lib/confidence";

interface ConfidenceBadgeProps {
  confidence: "high" | "medium" | "low";
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="confidence-trigger"
          className="flex items-center gap-2 cursor-help min-h-[44px]"
        >
          {confidence === "high" ? (
            <CheckCircle
              data-testid="confidence-icon-check"
              className="w-4 h-4 text-success"
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              data-testid="confidence-icon-alert"
              className={`w-4 h-4 ${confidence === "medium" ? "text-warning" : "text-destructive"}`}
              aria-hidden="true"
            />
          )}
          <div
            data-testid="confidence-indicator"
            className={`w-3 h-3 rounded-full ${confidenceColors[confidence]}`}
          />
          <span className="text-sm text-muted-foreground capitalize">
            {confidence}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-xs">
        <p>{confidenceExplanations[confidence]}</p>
      </PopoverContent>
    </Popover>
  );
}
