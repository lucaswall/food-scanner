"use client";

import { useState, useCallback } from "react";
import useSWR from "swr";
import { Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { NutritionLabelDetailSheet } from "@/components/nutrition-label-detail-sheet";
import { apiFetcher, invalidateLabelCaches } from "@/lib/swr";
import type { NutritionLabel } from "@/types";

export function NutritionLabels() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NutritionLabel | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<NutritionLabel | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const apiUrl = debouncedSearch.length >= 2
    ? `/api/nutrition-labels?q=${encodeURIComponent(debouncedSearch)}`
    : "/api/nutrition-labels";

  const { data, error, isLoading, mutate } = useSWR<NutritionLabel[]>(
    apiUrl,
    apiFetcher,
  );

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    if (debounceTimer) clearTimeout(debounceTimer);
    const timer = setTimeout(() => {
      setDebouncedSearch(value);
    }, 300);
    setDebounceTimer(timer);
  }, [debounceTimer]);

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    try {
      await fetch(`/api/nutrition-labels/${deleteTarget.id}`, { method: "DELETE" });
      await invalidateLabelCaches();
      await mutate();
    } catch {
      // error handled silently; list will refresh on next load
    } finally {
      setDeleteTarget(null);
    }
  }

  function openDetail(label: NutritionLabel) {
    setSelectedLabel(label);
    setDetailOpen(true);
  }

  function handleDetailDelete(label: NutritionLabel) {
    setDetailOpen(false);
    setDeleteTarget(label);
  }

  const labels = data ?? [];

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-destructive">{error.message || "Failed to load labels"}</p>
        <Button variant="outline" className="mt-4 min-h-[44px]" onClick={() => mutate()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <Input
          type="search"
          placeholder="Search labels..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="min-h-[44px]"
        />

        {labels.length === 0 && !debouncedSearch && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="font-medium">No nutrition labels yet</p>
            <p className="text-sm text-muted-foreground">
              Labels are automatically saved when you scan packaged products during food analysis.
            </p>
          </div>
        )}

        {labels.length === 0 && debouncedSearch && (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">No results</p>
          </div>
        )}

        {labels.length > 0 && (
          <div className="flex flex-col gap-3">
            {labels.map((label) => (
              <div key={label.id} className="flex items-center gap-2 rounded-lg border bg-card p-3">
                <button
                  type="button"
                  className="flex flex-1 flex-col gap-0.5 text-left min-w-0"
                  onClick={() => openDetail(label)}
                  aria-label={label.productName}
                >
                  <p className="text-xs text-muted-foreground truncate">{label.brand}</p>
                  <p className="text-sm font-medium truncate">
                    {label.productName}
                    {label.variant && (
                      <span className="font-normal text-muted-foreground"> — {label.variant}</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {label.calories} cal · {label.servingSizeLabel}
                  </p>
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-[44px] min-w-[44px] shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${label.productName}`}
                  onClick={() => setDeleteTarget(label)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this label?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <NutritionLabelDetailSheet
        label={selectedLabel}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onDelete={handleDetailDelete}
      />
    </>
  );
}
