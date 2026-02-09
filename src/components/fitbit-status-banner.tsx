"use client";

import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

interface SessionResponse {
  email: string | null;
  fitbitConnected: boolean;
  hasFitbitCredentials: boolean;
  expiresAt: number;
}

export function FitbitStatusBanner() {
  const { data, error, isLoading } = useSWR<SessionResponse>(
    "/api/auth/session",
    apiFetcher,
  );

  if (isLoading || error || !data) return null;

  const { fitbitConnected, hasFitbitCredentials } = data;

  // Transitional state: tokens exist but no credentials → will break on refresh
  if (fitbitConnected && !hasFitbitCredentials) {
    return (
      <Alert variant="default" className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
        <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
        <AlertDescription className="flex items-center justify-between gap-4">
          <span className="text-sm text-amber-900 dark:text-amber-100">
            Set up Fitbit credentials to keep logging food
          </span>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/app/setup-fitbit">Set up now</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // If everything is connected, don't show the banner
  if (fitbitConnected) return null;

  // Case 1: No credentials at all → redirect to setup page
  if (!hasFitbitCredentials) {
    return (
      <Alert variant="default" className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
        <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
        <AlertDescription className="flex items-center justify-between gap-4">
          <span className="text-sm text-amber-900 dark:text-amber-100">
            Set up Fitbit to start logging food
          </span>
          <Button variant="outline" size="sm" asChild className="shrink-0">
            <Link href="/app/setup-fitbit">Set up Fitbit</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  // Case 2: Has credentials but not connected → reconnect flow
  return (
    <Alert variant="default" className="border-amber-500 bg-amber-50 dark:bg-amber-950/20">
      <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <span className="text-sm text-amber-900 dark:text-amber-100">
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
