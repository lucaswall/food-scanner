"use client";

import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Skeleton } from "@/components/ui/skeleton";

interface HealthData {
  status: string;
  version: string;
  environment: string;
  fitbitMode: string;
  claudeModel: string;
}

export function AboutSection() {
  const { data, error, isLoading } = useSWR<HealthData>(
    "/api/health",
    apiFetcher
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-6" data-testid="about-section-loading">
        <Skeleton className="h-6 w-24 mb-4" />
        <div className="space-y-3">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">About</h2>
        <p className="text-sm text-muted-foreground">Unable to load app info. Please try again later.</p>
        <p className="text-xs text-muted-foreground mt-2">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold mb-4">About</h2>
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Version</span>
          <span className="font-mono">{data?.version}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Environment</span>
          <span>{data?.environment}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Fitbit Mode</span>
          <span>{data?.fitbitMode}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Claude Model</span>
          <span className="font-mono text-xs">{data?.claudeModel}</span>
        </div>
      </div>
      <div className="mt-4">
        <a
          href="https://github.com/lucaswall/food-scanner/releases"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center min-h-[44px] text-sm text-primary hover:underline"
        >
          View Releases
        </a>
      </div>
    </div>
  );
}
