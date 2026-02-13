"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Skeleton } from "@/components/ui/skeleton";
import type { FastingResponse } from "@/types";

interface FastingCardProps {
  date: string;
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatTime12Hour(time24: string): string {
  const [hours, minutes] = time24.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${hours12}:${minutes.toString().padStart(2, "0")} ${period}`;
}

function calculateLiveDuration(lastMealTime: string, startDate: string): number {
  const startDateTime = new Date(`${startDate}T${lastMealTime}`);
  const now = new Date();
  const diffMs = now.getTime() - startDateTime.getTime();
  return Math.floor(diffMs / 60000);
}

export function FastingCard({ date }: FastingCardProps) {
  const { data, error, isLoading } = useSWR<FastingResponse>(
    `/api/fasting?date=${date}`,
    apiFetcher
  );

  // Force re-renders every minute for live mode
  const [, setTick] = useState(0);

  const liveDuration = data?.live
    ? calculateLiveDuration(data.live.lastMealTime, data.live.startDate)
    : null;

  useEffect(() => {
    if (!data?.live) return;
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, [data?.live]);

  if (isLoading) {
    return (
      <div
        data-testid="fasting-skeleton"
        className="rounded-lg border bg-card p-4 space-y-2"
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm text-destructive">Error loading fasting data</p>
      </div>
    );
  }

  if (!data?.window) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <p className="text-sm text-muted-foreground">Log a meal to start tracking your fasting window</p>
      </div>
    );
  }

  const { window, live } = data;

  // Live mode
  if (live && liveDuration !== null) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Fasting</span>
          <div
            data-testid="fasting-live-dot"
            className="w-2 h-2 rounded-full bg-success animate-pulse"
          />
        </div>
        <div className="text-2xl font-bold">{formatDuration(liveDuration)}</div>
        <p className="text-sm text-muted-foreground">
          Since {formatTime12Hour(window.lastMealTime)}
        </p>
      </div>
    );
  }

  // Completed fast
  if (window.durationMinutes !== null && window.firstMealTime !== null) {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-2">
        <span className="text-sm font-medium">Fasting</span>
        <div className="text-2xl font-bold">
          {formatDuration(window.durationMinutes)}
        </div>
        <p className="text-sm text-muted-foreground">
          {formatTime12Hour(window.lastMealTime)} → {formatTime12Hour(window.firstMealTime)}
        </p>
      </div>
    );
  }

  // Ongoing fast (not today, no live mode)
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">No completed fasting window for this date</p>
    </div>
  );
}
