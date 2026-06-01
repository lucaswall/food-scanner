"use client";

import { useState, useCallback } from "react";
import * as Sentry from "@sentry/nextjs";
import { safeResponseJson } from "@/lib/safe-json";
import { savePendingSubmission } from "@/lib/pending-submission";
import { vibrateError } from "@/lib/haptics";
import { getLocalDateTime } from "@/lib/meal-type";
import type { FoodAnalysis, FoodLogResponse } from "@/types";

interface UseLogFoodConfig {
  analysis: FoodAnalysis | null;
  mealTypeId: number;
  selectedTime?: string | null;
  dateOverride?: string | null;
  onSuccess?: (response: FoodLogResponse) => void | Promise<void>;
  getSessionId?: () => string | undefined;
}

interface UseLogFoodReturn {
  logFood: () => Promise<void>;
  logFoodWithMatch: (
    match: { customFoodId: number; foodName: string },
    metadata?: {
      description?: string;
      notes?: string;
      keywords?: string[];
      confidence?: string;
    }
  ) => Promise<void>;
  logging: boolean;
  logError: string | null;
  logResponse: FoodLogResponse | null;
  clearLogError: () => void;
}

async function handleLogResponse(
  response: Response,
  setLogError: (e: string | null) => void,
  setLogResponse: (r: FoodLogResponse) => void,
  onSuccess: ((r: FoodLogResponse) => void | Promise<void>) | undefined,
  onTokenInvalid: () => void
): Promise<void> {
  const result = (await safeResponseJson(response)) as {
    success: boolean;
    data?: FoodLogResponse;
    error?: { code: string; message: string };
  };

  if (!response.ok || !result.success) {
    const errorCode = result.error?.code;
    if (errorCode === "HEALTH_TOKEN_INVALID") {
      onTokenInvalid();
      return;
    }
    if (errorCode === "HEALTH_NOT_CONNECTED") {
      setLogError("Google Health is not connected. Please connect in Settings.");
      vibrateError();
      return;
    }
    setLogError(result.error?.message || "Failed to log food");
    vibrateError();
    return;
  }

  if (result.data) {
    setLogResponse(result.data);
    await onSuccess?.(result.data);
  }
}

function handleCatchError(err: unknown, setLogError: (e: string | null) => void): void {
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
    setLogError("Request timed out. Please try again.");
  } else {
    Sentry.captureException(err);
    setLogError(err instanceof Error ? err.message : "An unexpected error occurred");
  }
  vibrateError();
}

export function useLogFood({
  analysis,
  mealTypeId,
  selectedTime,
  dateOverride,
  onSuccess,
  getSessionId,
}: UseLogFoodConfig): UseLogFoodReturn {
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logResponse, setLogResponse] = useState<FoodLogResponse | null>(null);

  const clearLogError = useCallback(() => setLogError(null), []);

  const logFood = useCallback(async () => {
    if (logging || !analysis) return;

    setLogging(true);
    setLogError(null);

    try {
      const localDateTime = getLocalDateTime();
      const logDate = dateOverride ?? localDateTime.date;
      const logTime = selectedTime ?? localDateTime.time;

      const logBody: Record<string, unknown> = analysis.sourceCustomFoodId
        ? {
            reuseCustomFoodId: analysis.sourceCustomFoodId,
            mealTypeId,
            date: logDate,
            time: logTime,
            zoneOffset: localDateTime.zoneOffset,
            expectedCalories: analysis.calories,
          }
        : {
            ...analysis,
            mealTypeId,
            date: logDate,
            time: logTime,
            zoneOffset: localDateTime.zoneOffset,
          };

      const response = await fetch("/api/log-food", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(logBody),
        signal: AbortSignal.timeout(15000),
      });

      await handleLogResponse(
        response,
        setLogError,
        setLogResponse,
        onSuccess,
        () => {
          savePendingSubmission({
            analysis,
            mealTypeId,
            foodName: analysis.food_name,
            date: logDate,
            time: logTime,
            zoneOffset: localDateTime.zoneOffset,
            sessionId: getSessionId?.(),
          });
          window.location.href = "/api/auth/google-health";
        }
      );
    } catch (err) {
      handleCatchError(err, setLogError);
    } finally {
      setLogging(false);
    }
  }, [logging, analysis, mealTypeId, selectedTime, dateOverride, onSuccess, getSessionId]);

  const logFoodWithMatch = useCallback(
    async (
      match: { customFoodId: number; foodName: string },
      metadata?: {
        description?: string;
        notes?: string;
        keywords?: string[];
        confidence?: string;
      }
    ) => {
      if (logging) return;

      setLogging(true);
      setLogError(null);

      try {
        const localDateTime = getLocalDateTime();
        const logBody: Record<string, unknown> = {
          reuseCustomFoodId: match.customFoodId,
          mealTypeId,
          ...localDateTime,
        };

        if (metadata) {
          if (metadata.description !== undefined) logBody.newDescription = metadata.description;
          if (metadata.notes !== undefined) logBody.newNotes = metadata.notes;
          if (metadata.keywords !== undefined) logBody.newKeywords = metadata.keywords;
          if (metadata.confidence !== undefined) logBody.newConfidence = metadata.confidence;
        }

        const response = await fetch("/api/log-food", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(logBody),
          signal: AbortSignal.timeout(15000),
        });

        await handleLogResponse(
          response,
          setLogError,
          setLogResponse,
          onSuccess,
          () => {
            savePendingSubmission({
              analysis: null,
              mealTypeId,
              foodName: match.foodName,
              reuseCustomFoodId: match.customFoodId,
              ...localDateTime,
              sessionId: getSessionId?.(),
            });
            window.location.href = "/api/auth/google-health";
          }
        );
      } catch (err) {
        handleCatchError(err, setLogError);
      } finally {
        setLogging(false);
      }
    },
    [logging, mealTypeId, onSuccess, getSessionId]
  );

  return { logFood, logFoodWithMatch, logging, logError, logResponse, clearLogError };
}
