"use client";

import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import type { ClaudeUsageResponse } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

function formatCost(costStr: string): string {
  const cost = parseFloat(costStr);
  return `$${cost.toFixed(2)}`;
}

export function ClaudeUsageSection() {
  const { data, error, isLoading } = useSWR<ClaudeUsageResponse>(
    "/api/claude-usage",
    apiFetcher
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-6" data-testid="claude-usage-loading">
        <Skeleton className="h-6 w-40 mb-4" />
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Claude API Usage</h2>
        <p className="text-sm text-muted-foreground">Unable to load usage data. Please try again later.</p>
        <p className="text-xs text-muted-foreground mt-2">{error.message}</p>
      </div>
    );
  }

  if (!data?.months?.length) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Claude API Usage</h2>
        <p className="text-sm text-muted-foreground">No usage data available</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold mb-4">Claude API Usage</h2>
      <div className="space-y-4">
        {data.months.map((month) => (
          <div
            key={month.month}
            className="flex flex-col gap-2 p-4 rounded-lg border bg-muted/50"
          >
            <h3 className="font-medium text-base">{formatMonth(month.month)}</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Requests:</span>
                <span className="ml-2 font-mono">{formatNumber(month.totalRequests)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Cost:</span>
                <span className="ml-2 font-mono">{formatCost(month.totalCostUsd)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Input tokens:</span>
                <span className="ml-2 font-mono">{formatNumber(month.totalInputTokens)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Output tokens:</span>
                <span className="ml-2 font-mono">{formatNumber(month.totalOutputTokens)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
