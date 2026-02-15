"use client";

import { useState, useEffect } from "react";
import {
  getPendingSubmission,
  clearPendingSubmission,
  savePendingSubmission,
} from "@/lib/pending-submission";
import { invalidateFoodCaches } from "@/lib/swr";
import { getLocalDateTime } from "@/lib/meal-type";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type Status = "resubmitting" | "success" | "error" | "idle";

export function PendingSubmissionHandler() {
  const [status, setStatus] = useState<Status>("idle");
  const [foodName, setFoodName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    async function handlePendingSubmission() {
      const pending = getPendingSubmission();
      if (!pending) return;

      setStatus("resubmitting");
      setFoodName(pending.foodName);

      const dateTime =
        pending.date && pending.time
          ? { date: pending.date, time: pending.time }
          : getLocalDateTime();
      const body: Record<string, unknown> = {};

      if (pending.reuseCustomFoodId) {
        body.reuseCustomFoodId = pending.reuseCustomFoodId;
        body.mealTypeId = pending.mealTypeId;
        Object.assign(body, dateTime);
        if (pending.analysis) {
          body.newDescription = pending.analysis.description;
          body.newNotes = pending.analysis.notes;
          body.newKeywords = pending.analysis.keywords;
          body.newConfidence = pending.analysis.confidence;
        }
      } else if (pending.analysis) {
        Object.assign(body, pending.analysis);
        body.mealTypeId = pending.mealTypeId;
        Object.assign(body, dateTime);
      } else {
        body.mealTypeId = pending.mealTypeId;
        Object.assign(body, dateTime);
      }

      try {
        const r = await fetch("/api/log-food", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const result = await r.json();

        if (result.success) {
          clearPendingSubmission();
          invalidateFoodCaches().catch(() => {});
          setStatus("success");
        } else {
          const errorCode = result.error?.code;

          if (errorCode === "FITBIT_TOKEN_INVALID") {
            savePendingSubmission(pending);
            window.location.href = "/api/auth/fitbit";
            return;
          }

          if (
            errorCode === "FITBIT_CREDENTIALS_MISSING" ||
            errorCode === "FITBIT_NOT_CONNECTED"
          ) {
            clearPendingSubmission();
            setStatus("error");
            setErrorMessage(
              "Fitbit is not set up. Please configure your credentials in Settings."
            );
            return;
          }

          clearPendingSubmission();
          setStatus("error");
          setErrorMessage(
            result.error?.message || "Failed to resubmit food log"
          );
        }
      } catch {
        clearPendingSubmission();
        setStatus("error");
        setErrorMessage("Failed to resubmit food log");
      }
    }

    handlePendingSubmission();
  }, []);

  // Auto-dismiss success message after 3 seconds
  useEffect(() => {
    if (status !== "success") return;
    const timer = setTimeout(() => setStatus("idle"), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  if (status === "idle") return null;

  if (status === "resubmitting") {
    return (
      <Alert variant="default" className="border-primary bg-primary/10">
        <Loader2 className="h-4 w-4 text-primary animate-spin" />
        <AlertDescription className="text-sm text-primary-foreground">
          Reconnected! Resubmitting {foodName}...
        </AlertDescription>
      </Alert>
    );
  }

  if (status === "success") {
    return (
      <Alert variant="default" className="border-green-500 bg-green-500/10">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-sm text-green-900">
          Successfully resubmitted {foodName}
        </AlertDescription>
      </Alert>
    );
  }

  if (status === "error") {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="text-sm">{errorMessage}</AlertDescription>
      </Alert>
    );
  }

  return null;
}
