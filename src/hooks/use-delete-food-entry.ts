"use client";

import { useState, useCallback, useRef } from "react";
import * as Sentry from "@sentry/nextjs";
import { invalidateFoodCaches } from "@/lib/swr";
import { vibrateError } from "@/lib/haptics";
import { safeResponseJson } from "@/lib/safe-json";

interface UseDeleteFoodEntryOptions {
  onSuccess: () => void;
}

interface UseDeleteFoodEntryReturn {
  deleteTargetId: number | null;
  deletingId: number | null;
  deleteError: string | null;
  deleteErrorCode: string | null;
  handleDeleteRequest: (id: number) => void;
  handleDeleteConfirm: () => Promise<void>;
  handleDeleteCancel: () => void;
  clearError: () => void;
}

export function useDeleteFoodEntry({ onSuccess }: UseDeleteFoodEntryOptions): UseDeleteFoodEntryReturn {
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteErrorCode, setDeleteErrorCode] = useState<string | null>(null);
  const deleteTargetIdRef = useRef<number | null>(null);

  const handleDeleteRequest = useCallback((id: number) => {
    deleteTargetIdRef.current = id;
    setDeleteTargetId(id);
  }, []);

  const handleDeleteCancel = useCallback(() => {
    deleteTargetIdRef.current = null;
    setDeleteTargetId(null);
  }, []);

  const clearError = useCallback(() => {
    setDeleteError(null);
    setDeleteErrorCode(null);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    const id = deleteTargetIdRef.current;
    if (id === null) return;
    deleteTargetIdRef.current = null;
    setDeleteTargetId(null);

    setDeletingId(id);
    setDeleteError(null);
    setDeleteErrorCode(null);

    try {
      const response = await fetch(`/api/food-history/${id}`, {
        method: "DELETE",
        signal: AbortSignal.timeout(15000),
      });
      const result = await safeResponseJson(response) as {
        success?: boolean;
        error?: { code?: string; message?: string };
      };

      if (!response.ok || !result.success) {
        const errorCode = result.error?.code;
        setDeleteError(result.error?.message || "Failed to delete entry");
        setDeleteErrorCode(errorCode || null);

        if (errorCode === "FITBIT_CREDENTIALS_MISSING" || errorCode === "FITBIT_NOT_CONNECTED") {
          setDeleteError("Fitbit is not set up. Please configure your credentials in Settings.");
        }

        vibrateError();
        return;
      }

      onSuccess();
      invalidateFoodCaches().catch(() => {});
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setDeleteError("Request timed out. Please try again.");
      } else {
        Sentry.captureException(err);
        console.error("Failed to delete food history entry:", err);
        setDeleteError("Failed to delete entry");
      }
      vibrateError();
    } finally {
      setDeletingId(null);
    }
  }, [onSuccess]);

  return {
    deleteTargetId,
    deletingId,
    deleteError,
    deleteErrorCode,
    handleDeleteRequest,
    handleDeleteConfirm,
    handleDeleteCancel,
    clearError,
  };
}
