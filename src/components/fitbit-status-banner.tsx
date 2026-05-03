"use client";

import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { FitbitHealthStatus } from "@/types";

export function FitbitStatusBanner() {
  const { data, error, isLoading } = useSWR<FitbitHealthStatus>(
    "/api/fitbit/health",
    apiFetcher,
  );

  if (isLoading || error || !data) return null;

  if (data.status === "healthy") return null;

  if (data.status === "needs_setup") {
    return (
      <Alert variant="default" className="border-warning bg-warning/10">
        <AlertCircle className="h-4 w-4 text-warning" />
        <AlertDescription className="flex items-center justify-between gap-4">
          <span className="text-sm text-warning-foreground">
            Set up Fitbit to start logging food
          </span>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/app/setup-fitbit">Set up Fitbit</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (data.status === "scope_mismatch") {
    return (
      <Alert variant="default" className="border-warning bg-warning/10">
        <AlertCircle className="h-4 w-4 text-warning" />
        <AlertDescription className="flex items-center justify-between gap-4">
          <span className="text-sm text-warning-foreground">
            Reconnect Fitbit to grant new permissions
          </span>
          <form action="/api/auth/fitbit" method="POST">
            <Button variant="outline" size="sm" type="submit" className="shrink-0">
              Reconnect
            </Button>
          </form>
        </AlertDescription>
      </Alert>
    );
  }

  // status === "needs_reconnect"
  return (
    <Alert variant="default" className="border-warning bg-warning/10">
      <AlertCircle className="h-4 w-4 text-warning" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span className="text-sm text-warning-foreground">
          Fitbit disconnected
        </span>
        <form action="/api/auth/fitbit" method="POST">
          <Button variant="outline" size="sm" type="submit" className="shrink-0">
            Reconnect
          </Button>
        </form>
      </AlertDescription>
    </Alert>
  );
}
