"use client";

import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { ReactNode } from "react";

interface SessionResponse {
  fitbitConnected: boolean;
  hasFitbitCredentials: boolean;
}

interface FitbitSetupGuardProps {
  children: ReactNode;
}

export function FitbitSetupGuard({ children }: FitbitSetupGuardProps) {
  const { data, isLoading } = useSWR<SessionResponse>(
    "/api/auth/session",
    apiFetcher,
  );

  if (isLoading) {
    return <div className="h-48 rounded-lg bg-muted animate-pulse" />;
  }

  if (!data) return null;

  // Fully set up — render normally
  if (data.fitbitConnected && data.hasFitbitCredentials) {
    return <>{children}</>;
  }

  // No credentials → set up
  if (!data.hasFitbitCredentials) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
        <p className="text-muted-foreground">
          Set up your Fitbit credentials to start logging food
        </p>
        <Button asChild className="min-h-[44px]">
          <Link href="/app/setup-fitbit">Set up Fitbit</Link>
        </Button>
      </div>
    );
  }

  // Has credentials but no tokens → reconnect
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
      <p className="text-muted-foreground">
        Connect your Fitbit account to start logging food
      </p>
      <form action="/api/auth/fitbit" method="POST">
        <Button type="submit" className="min-h-[44px]">
          Connect Fitbit
        </Button>
      </form>
    </div>
  );
}
