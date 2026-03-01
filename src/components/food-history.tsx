"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import useSWRInfinite from "swr/infinite";
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
import { Trash2, Pencil, UtensilsCrossed, Loader2, Star, Share2 } from "lucide-react";
import { vibrateError } from "@/lib/haptics";
import { safeResponseJson } from "@/lib/safe-json";
import { getUnitLabel, FITBIT_MEAL_TYPE_LABELS } from "@/types";
import type { FoodLogHistoryEntry } from "@/types";
import { formatTime } from "@/lib/date-utils";

const PAGE_SIZE = 20;

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
  const router = useRouter();
  const [endDate, setEndDate] = useState<string | null>(null);
  const [jumpDate, setJumpDate] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteErrorCode, setDeleteErrorCode] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<FoodLogHistoryEntry | null>(null);
  const [localFavorites, setLocalFavorites] = useState<Map<number, boolean>>(new Map());
  const [isSharing, setIsSharing] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  const getKey = useCallback(
    (pageIndex: number, previousPageData: { entries: FoodLogHistoryEntry[] } | null) => {
      if (previousPageData && previousPageData.entries.length < PAGE_SIZE) return null;
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (endDate) params.set("endDate", endDate);
      if (pageIndex > 0 && previousPageData) {
        const lastEntry = previousPageData.entries[previousPageData.entries.length - 1];
        params.set("lastDate", lastEntry.date);
        if (lastEntry.time) params.set("lastTime", lastEntry.time);
        params.set("lastId", String(lastEntry.id));
      }
      return `/api/food-history?${params}`;
    },
    [endDate],
  );

  const {
    data: pages,
    setSize,
    isLoading,
    isValidating,
    mutate,
    error,
  } = useSWRInfinite<{ entries: FoodLogHistoryEntry[] }>(getKey, apiFetcher, {
    revalidateFirstPage: true,
  });

  const entries = pages?.flatMap((p) => p.entries) ?? [];
  const hasMore = pages != null && pages.length > 0 && pages[pages.length - 1].entries.length === PAGE_SIZE;

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  const isValidatingRef = useRef(false);
  isValidatingRef.current = isValidating;

  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const observer = new IntersectionObserver(
      (intersections) => {
        if (intersections[0]?.isIntersecting && hasMore && !isValidatingRef.current) {
          setSize((s) => s + 1);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, setSize]);

  const handleJumpToDate = () => {
    if (!jumpDate) return;
    mutate(undefined, { revalidate: false });
    setEndDate(jumpDate);
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

      await mutate();
      invalidateFoodCaches().catch(() => {});
    } catch (err) {
      if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
        setDeleteError("Request timed out. Please try again.");
      } else {
        console.error("Failed to delete food history entry:", err);
        setDeleteError("Failed to delete entry");
      }
      vibrateError();
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleFavorite = async (entry: FoodLogHistoryEntry) => {
    const currentValue = localFavorites.get(entry.customFoodId) ?? entry.isFavorite;
    const newValue = !currentValue;
    setLocalFavorites((prev) => new Map(prev).set(entry.customFoodId, newValue));
    try {
      const res = await fetch(`/api/custom-foods/${entry.customFoodId}/favorite`, { method: "PATCH" });
      if (!res.ok) setLocalFavorites((prev) => new Map(prev).set(entry.customFoodId, currentValue));
    } catch {
      setLocalFavorites((prev) => new Map(prev).set(entry.customFoodId, currentValue));
    }
  };

  const handleShare = async (entry: FoodLogHistoryEntry) => {
    if (isSharing) return;
    setIsSharing(true);
    setShareError(null);
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customFoodId: entry.customFoodId }),
      });
      if (!response.ok) {
        setShareError("Failed to share. Please try again.");
        return;
      }
      const result = await response.json();
      const shareUrl: string | undefined = result?.data?.shareUrl;
      if (typeof shareUrl !== "string") {
        setShareError("Failed to share. Please try again.");
        return;
      }
      if (navigator.share) {
        try {
          await navigator.share({ url: shareUrl, title: entry.foodName });
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
          setShareError("Failed to share. Please try again.");
        }
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }
    } finally {
      setIsSharing(false);
    }
  };

  if (isLoading) {
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

  if (entries.length === 0 && !error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4 text-center">
        <UtensilsCrossed data-testid="empty-state-icon" className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">No food log entries</p>
        <p className="text-sm text-muted-foreground">Take a photo or use Quick Select to log your first meal</p>
        <div className="flex gap-3">
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link href="/app/analyze">Scan Food</Link>
          </Button>
          <Button asChild variant="outline" className="min-h-[44px]">
            <Link href="/app/quick-select">Quick Select</Link>
          </Button>
        </div>
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

      {error && (
        <div role="alert" className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <p className="text-sm text-destructive">Failed to load entries. Please try again.</p>
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
          <div className="flex flex-col border-b pb-1">
            <div className="flex justify-between items-baseline">
              <h2 className="font-semibold">{formatDateHeader(group.date)}</h2>
              <span className="text-sm text-muted-foreground">
                {Math.round(group.totalCalories)} cal
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {`P: ${Math.round(group.totalProteinG)}g · C: ${Math.round(group.totalCarbsG)}g · F: ${Math.round(group.totalFatG)}g`}
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
                    <p className="text-xs text-muted-foreground truncate">
                      {formatTime(entry.time) && `${formatTime(entry.time)} · `}{FITBIT_MEAL_TYPE_LABELS[entry.mealTypeId] ?? "Unknown"} · {getUnitLabel(entry.unitId, entry.amount)}
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
                className="min-h-[44px] min-w-[44px] shrink-0 mr-1"
                onClick={() => router.push(`/app/edit/${entry.id}`)}
                aria-label={`Edit ${entry.foodName}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
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

      {/* Infinite scroll sentinel */}
      {hasMore && (
        <div
          ref={sentinelRef}
          data-testid="infinite-scroll-sentinel"
          className="flex justify-center items-center py-4 min-h-[44px]"
        >
          {isValidating && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
        </div>
      )}

      {/* Entry detail dialog */}
      <Dialog open={!!selectedEntry} onOpenChange={(open) => { if (!open) { setSelectedEntry(null); setIsSharing(false); setShareCopied(false); setShareError(null); } }}>
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button
                    aria-label="Toggle favorite"
                    aria-pressed={localFavorites.get(selectedEntry.customFoodId) ?? selectedEntry.isFavorite}
                    onClick={() => handleToggleFavorite(selectedEntry)}
                    className="min-h-[44px] min-w-[44px] flex items-center justify-center"
                  >
                    <Star
                      className="h-5 w-5"
                      fill={(localFavorites.get(selectedEntry.customFoodId) ?? selectedEntry.isFavorite) ? "currentColor" : "none"}
                    />
                  </button>
                  <Button
                    onClick={() => handleShare(selectedEntry)}
                    variant="ghost"
                    size="icon"
                    className="min-h-[44px] min-w-[44px]"
                    aria-label="Share"
                    disabled={isSharing}
                  >
                    <Share2 className="h-5 w-5" />
                  </Button>
                  {shareCopied && (
                    <span className="text-xs text-green-600">Link copied!</span>
                  )}
                  {shareError && (
                    <span className="text-xs text-destructive">{shareError}</span>
                  )}
                </div>
                <Link
                  href={`/app/food-detail/${selectedEntry.id}`}
                  className="text-sm text-primary hover:underline min-h-[44px] flex items-center justify-center"
                >
                  View Full Details
                </Link>
              </div>
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
