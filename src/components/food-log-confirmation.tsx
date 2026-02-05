"use client";

import { useEffect } from "react";
import type { FoodLogResponse } from "@/types";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";
import { vibrateSuccess } from "@/lib/haptics";

interface FoodLogConfirmationProps {
  response: FoodLogResponse | null;
  foodName: string;
  onReset: () => void;
}

export function FoodLogConfirmation({
  response,
  foodName,
  onReset,
}: FoodLogConfirmationProps) {
  // Trigger haptic feedback on mount
  useEffect(() => {
    if (response) {
      vibrateSuccess();
    }
  }, [response]);

  if (!response) {
    return null;
  }

  return (
    <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center animate-slide-up">
      <CheckCircle
        data-testid="success-icon"
        className="w-16 h-16 text-green-500"
      />

      <div className="space-y-2">
        <h3 className="text-lg font-semibold">
          {foodName} logged successfully!
        </h3>
        <p className="text-sm text-gray-500">
          {response.reusedFood
            ? "Reused existing food from your Fitbit library"
            : "Created new food in your Fitbit library"}
        </p>
        <p className="text-xs text-gray-400">Log ID: {response.fitbitLogId}</p>
      </div>

      <Button
        onClick={onReset}
        variant="outline"
        className="min-h-[44px] min-w-[120px]"
      >
        Log Another
      </Button>
    </div>
  );
}
