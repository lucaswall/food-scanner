"use client";

import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { HealthConnectionStatus } from "@/types";

export function HealthStatusBanner() {
  const { data, error, isLoading } = useSWR<HealthConnectionStatus>(
    "/api/health-status",
    apiFetcher,
  );

  if (isLoading || error || !data) return null;

  if (data.status === "healthy") return null;

  if (data.status === "needs_reconnect") {
    return (
      <Alert variant="default" className="border-warning bg-warning/10">
        <AlertCircle className="h-4 w-4 text-warning" />
        <AlertDescription className="flex items-center justify-between gap-4">
          <span className="text-sm text-foreground">
            Google Health disconnected
          </span>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/app/connect-health">Connect</Link>
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
          <span className="text-sm text-foreground">
            Google Health needs new permissions
          </span>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/app/connect-health">Reconnect</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
