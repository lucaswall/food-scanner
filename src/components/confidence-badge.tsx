"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckCircle, AlertTriangle } from "lucide-react";
import { confidenceColors, confidenceExplanations } from "@/lib/confidence";

interface ConfidenceBadgeProps {
  confidence: "high" | "medium" | "low";
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="confidence-trigger"
            className="flex items-center gap-2 cursor-help min-h-[44px]"
          >
            {confidence === "high" ? (
              <CheckCircle
                data-testid="confidence-icon-check"
                className="w-4 h-4 text-green-500"
                aria-hidden="true"
              />
            ) : (
              <AlertTriangle
                data-testid="confidence-icon-alert"
                className={`w-4 h-4 ${confidence === "medium" ? "text-yellow-500" : "text-red-500"}`}
                aria-hidden="true"
              />
            )}
            <div
              data-testid="confidence-indicator"
              aria-label={`Confidence: ${confidence}`}
              className={`w-3 h-3 rounded-full ${confidenceColors[confidence]}`}
            />
            <span className="text-sm text-muted-foreground capitalize">
              {confidence}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>{confidenceExplanations[confidence]}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
