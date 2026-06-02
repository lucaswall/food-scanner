"use client";

import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { ReactNode } from "react";

interface SessionResponse {
  healthConnected: boolean;
}

interface HealthConnectGuardProps {
  children: ReactNode;
}

export function HealthConnectGuard({ children }: HealthConnectGuardProps) {
  const { data, error, isLoading, mutate } = useSWR<SessionResponse>(
    "/api/auth/session",
    apiFetcher,
  );

  if (isLoading) {
    return <div className="h-48 rounded-lg bg-muted animate-pulse" />;
  }

  if (error) {
    const isTimeout =
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return (
      <div
        className="flex flex-col items-center justify-center py-12 space-y-4 text-center"
        role="alert"
      >
        <p className="text-muted-foreground">
          {isTimeout
            ? "Request timed out. Please try again."
            : "Could not connect to session. Please try again."}
        </p>
        <Button variant="outline" className="min-h-[44px]" onClick={() => mutate()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  if (data.healthConnected) {
    return <>{children}</>;
  }

  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
      <p className="text-muted-foreground">
        Connect Google Health to start logging food
      </p>
      <Button asChild className="min-h-[44px]">
        <Link href="/app/connect-health">Connect Google Health</Link>
      </Button>
    </div>
  );
}
