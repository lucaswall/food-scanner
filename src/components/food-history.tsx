"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiFetcher, invalidateFoodCaches } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NutritionFactsCard } from "@/components/nutrition-facts-card";
import { Trash2 } from "lucide-react";
import { vibrateError } from "@/lib/haptics";
import { getUnitLabel, FITBIT_MEAL_TYPE_LABELS } from "@/types";
import type { FoodLogHistoryEntry } from "@/types";

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateHeader(dateStr: string): string {
  const today = new Date();
  const date = new Date(dateStr + "T00:00:00");
  const todayStr = formatLocalDate(today);
  const yesterdayDate = new Date(today);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = formatLocalDate(yesterdayDate);

  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(time: string | null): string {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

interface DateGroup {
  date: string;
  entries: FoodLogHistoryEntry[];
  totalCalories: number;
  totalProteinG: number;
  totalCarbsG: number;
  totalFatG: number;
}

function groupByDate(entries: FoodLogHistoryEntry[]): DateGroup[] {
  const grouped = new Map<string, FoodLogHistoryEntry[]>();
  for (const entry of entries) {
    const existing = grouped.get(entry.date) ?? [];
    existing.push(entry);
    grouped.set(entry.date, existing);
  }

  return Array.from(grouped.entries()).map(([date, entries]) => ({
    date,
    entries,
    totalCalories: entries.reduce((sum, e) => sum + e.calories, 0),
    totalProteinG: entries.reduce((sum, e) => sum + e.proteinG, 0),
    totalCarbsG: entries.reduce((sum, e) => sum + e.carbsG, 0),
    totalFatG: entries.reduce((sum, e) => sum + e.fatG, 0),
  }));
}

export function FoodHistory() {
  const { data: initialData, isLoading, mutate } = useSWR<{ entries: FoodLogHistoryEntry[] }>(
    "/api/food-history?limit=20",
    apiFetcher,
  );

  const [entries, setEntries] = useState<FoodLogHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteErrorCode, setDeleteErrorCode] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FoodLogHistoryEntry | null>(null);
  const [jumpDate, setJumpDate] = useState("");

  // Seed local entries state from SWR initial data.
  // After pagination or "Jump to Date", hasPaginated prevents SWR revalidation
  // from overwriting local state with first-page-only data.
  const hasPaginated = useRef(false);
  useEffect(() => {
    if (initialData?.entries && !hasPaginated.current) {
      setEntries(initialData.entries);
      setHasMore(initialData.entries.length >= 20);
    }
  }, [initialData]);

  const fetchEntries = useCallback(async (
    endDate?: string,
    append = false,
    cursor?: { lastDate: string; lastTime: string | null; lastId: number },
  ) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }

    setFetchError(null);

    try {
      const params = new URLSearchParams();
      if (endDate) params.set("endDate", endDate);
      if (cursor) {
        params.set("lastDate", cursor.lastDate);
        if (cursor.lastTime) params.set("lastTime", cursor.lastTime);
        params.set("lastId", String(cursor.lastId));
      }
      params.set("limit", "20");

      const response = await fetch(`/api/food-history?${params}`, {
        method: "GET",
      });
      const result = await response.json();

      if (result.success) {
        const newEntries = result.data.entries as FoodLogHistoryEntry[];
        if (append) {
          setEntries((prev) => [...prev, ...newEntries]);
        } else {
          setEntries(newEntries);
        }
        setHasMore(newEntries.length >= 20);
      }
    } catch {
      setFetchError("Failed to load entries. Please try again.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const handleLoadMore = () => {
    if (entries.length === 0) return;
    hasPaginated.current = true;
    const oldestEntry = entries[entries.length - 1];
    fetchEntries(undefined, true, {
      lastDate: oldestEntry.date,
      lastTime: oldestEntry.time,
      lastId: oldestEntry.id,
    });
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetId === null) return;
    const id = deleteTargetId;
    setDeleteTargetId(null);

    setDeletingId(id);
    setDeleteError(null);
    setDeleteErrorCode(null);

    try {
      const response = await fetch(`/api/food-history/${id}`, {
        method: "DELETE",
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        const errorCode = result.error?.code;
        setDeleteError(result.error?.message || "Failed to delete entry");
        setDeleteErrorCode(errorCode || null);

        // Handle missing credentials - show specific error
        if (errorCode === "FITBIT_CREDENTIALS_MISSING" || errorCode === "FITBIT_NOT_CONNECTED") {
          setDeleteError("Fitbit is not set up. Please configure your credentials in Settings.");
        }

        vibrateError();
        return;
      }

      setEntries((prev) => prev.filter((e) => e.id !== id));
      mutate();
      invalidateFoodCaches().catch(() => {});
    } catch {
      setDeleteError("Failed to delete entry");
      vibrateError();
    } finally {
      setDeletingId(null);
    }
  };

  const handleJumpToDate = () => {
    if (!jumpDate) return;
    hasPaginated.current = true;
    setHasMore(true);
    fetchEntries(jumpDate);
  };

  if (isLoading || loading) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">Loading history...</p>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <p className="text-muted-foreground">No food log entries</p>
        <p className="text-sm text-muted-foreground">Take a photo or use Quick Select to log your first meal</p>
      </div>
    );
  }

  const groups = groupByDate(entries);

  return (
    <div className="space-y-6">
      {/* Date picker */}
      <div className="flex gap-2">
        <input
          type="date"
          value={jumpDate}
          onChange={(e) => setJumpDate(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[44px]"
          aria-label="Jump to date"
        />
        <Button
          onClick={handleJumpToDate}
          variant="outline"
          className="min-h-[44px]"
          disabled={!jumpDate}
        >
          Go
        </Button>
      </div>

      {fetchError && (
        <div role="alert" className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-sm text-destructive">{fetchError}</p>
        </div>
      )}

      {deleteError && (
        <div role="alert" className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-sm text-destructive">{deleteError}</p>
          {deleteErrorCode === "FITBIT_TOKEN_INVALID" && (
            <a
              href="/api/auth/fitbit"
              className="text-sm text-destructive underline mt-2 inline-block font-medium"
            >
              Reconnect Fitbit
            </a>
          )}
          {(deleteErrorCode === "FITBIT_CREDENTIALS_MISSING" || deleteErrorCode === "FITBIT_NOT_CONNECTED") && (
            <a
              href="/settings"
              className="text-sm text-destructive underline mt-2 inline-block font-medium"
            >
              Go to Settings
            </a>
          )}
        </div>
      )}

      {groups.map((group) => (
        <div key={group.date} className="space-y-2">
          {/* Date header with summary */}
          <div className="flex justify-between items-baseline border-b pb-1">
            <h2 className="font-semibold">{formatDateHeader(group.date)}</h2>
            <span className="text-sm text-muted-foreground">
              {Math.round(group.totalCalories)} cal | P:{group.totalProteinG.toFixed(1)}g C:{group.totalCarbsG.toFixed(1)}g F:{group.totalFatG.toFixed(1)}g
            </span>
          </div>

          {/* Entries */}
          {group.entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border bg-card"
            >
              <button
                type="button"
                className="flex-1 min-w-0 p-3 text-left"
                onClick={() => setSelectedEntry(entry)}
                aria-label={`${entry.foodName}, ${entry.calories} calories`}
              >
                <div className="flex justify-between items-start">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{entry.foodName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatTime(entry.time)} · {FITBIT_MEAL_TYPE_LABELS[entry.mealTypeId] ?? "Unknown"} · {getUnitLabel(entry.unitId, entry.amount)}
                    </p>
                  </div>
                  <div className="text-right text-sm shrink-0 ml-2">
                    <p className="font-bold">{entry.calories} cal</p>
                    <p className="text-xs text-muted-foreground">
                      P:{entry.proteinG}g C:{entry.carbsG}g F:{entry.fatG}g
                    </p>
                  </div>
                </div>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="min-h-[44px] min-w-[44px] shrink-0 text-destructive hover:text-destructive mr-3"
                onClick={() => setDeleteTargetId(entry.id)}
                disabled={deletingId === entry.id}
                aria-label={`Delete ${entry.foodName}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      ))}

      {/* Load more */}
      {hasMore && (
        <Button
          variant="outline"
          className="w-full min-h-[44px]"
          onClick={handleLoadMore}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading..." : "Load More"}
        </Button>
      )}

      {/* Entry detail dialog */}
      <Dialog open={!!selectedEntry} onOpenChange={(open) => { if (!open) setSelectedEntry(null); }}>
        <DialogContent variant="bottom-sheet" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="sr-only">{selectedEntry?.foodName}</DialogTitle>
          </DialogHeader>
          {selectedEntry && (
            <>
              <NutritionFactsCard
                foodName={selectedEntry.foodName}
                calories={selectedEntry.calories}
                proteinG={selectedEntry.proteinG}
                carbsG={selectedEntry.carbsG}
                fatG={selectedEntry.fatG}
                fiberG={selectedEntry.fiberG}
                sodiumMg={selectedEntry.sodiumMg}
                unitId={selectedEntry.unitId}
                amount={selectedEntry.amount}
                mealTypeId={selectedEntry.mealTypeId}
                saturatedFatG={selectedEntry.saturatedFatG}
                transFatG={selectedEntry.transFatG}
                sugarsG={selectedEntry.sugarsG}
                caloriesFromFat={selectedEntry.caloriesFromFat}
              />
              <Link
                href={`/app/food-detail/${selectedEntry.id}`}
                className="block w-full text-center text-sm text-primary hover:underline min-h-[44px] flex items-center justify-center"
              >
                View Full Details
              </Link>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteTargetId !== null} onOpenChange={(open) => { if (!open) setDeleteTargetId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The entry will be removed from your food log.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
