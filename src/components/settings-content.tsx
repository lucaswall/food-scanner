"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/use-theme";
import { Sun, Moon, Monitor } from "lucide-react";
import useSWR from "swr";
import { apiFetcher } from "@/lib/swr";
import type { NutritionLabel } from "@/types";
import { HealthProfileCard } from "@/components/health-profile-card";
import { DailyGoalsCard } from "@/components/daily-goals-card";
import { TargetsCard } from "@/components/targets-card";
import { getTodayDate } from "@/lib/date-utils";

interface SessionInfo {
  email: string | null;
  healthConnected: boolean;
  expiresAt: number;
}

export function SettingsContent() {
  const { data: session, error } = useSWR<SessionInfo, Error>(
    "/api/auth/session",
    apiFetcher,
    {
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 5000,
    }
  );
  const { theme, setTheme } = useTheme();

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best-effort logout — redirect anyway to clear client state
    }
    window.location.href = "/";
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        {error && (
          <p className="text-sm text-destructive">{error.message}</p>
        )}
        {session && (
          <div className="flex flex-col gap-1 text-sm">
            {session.email && <p className="text-muted-foreground">{session.email}</p>}
            <p>
              Google Health:{" "}
              <span
                className={
                  session.healthConnected
                    ? "text-success"
                    : "text-destructive"
                }
              >
                {session.healthConnected ? "Connected" : "Not connected"}
              </span>
            </p>
          </div>
        )}

        <Button asChild variant="outline" className="w-full min-h-[44px]">
          <Link href="/app/connect-health">
            {session?.healthConnected ? "Reconnect Google Health" : "Connect Google Health"}
          </Link>
        </Button>

        <Button
          variant="destructive"
          className="w-full"
          onClick={handleLogout}
        >
          Logout
        </Button>
      </div>

      <HealthProfileCard />

      <DailyGoalsCard />

      <DailyTargetsSection />

      <NutritionLabelsSection />

      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <div className="flex gap-2">
          <Button
            variant={theme === "light" ? "default" : "outline"}
            size="sm"
            className="flex-1 min-h-[44px]"
            onClick={() => setTheme("light")}
          >
            <Sun className="mr-2 h-4 w-4" />
            Light
          </Button>
          <Button
            variant={theme === "dark" ? "default" : "outline"}
            size="sm"
            className="flex-1 min-h-[44px]"
            onClick={() => setTheme("dark")}
          >
            <Moon className="mr-2 h-4 w-4" />
            Dark
          </Button>
          <Button
            variant={theme === "system" ? "default" : "outline"}
            size="sm"
            className="flex-1 min-h-[44px]"
            onClick={() => setTheme("system")}
          >
            <Monitor className="mr-2 h-4 w-4" />
            System
          </Button>
        </div>
      </div>
    </div>
  );
}

function DailyTargetsSection() {
  const [date, setDate] = useState(() => getTodayDate());
  const lastActiveRef = useRef<{ date: string; timestamp: number } | null>(null);
  useEffect(() => {
    lastActiveRef.current = { date: getTodayDate(), timestamp: Date.now() };
    const handler = () => {
      if (document.visibilityState === "hidden") {
        lastActiveRef.current = { date: getTodayDate(), timestamp: Date.now() };
      } else if (document.visibilityState === "visible") {
        if (lastActiveRef.current === null) return;
        const today = getTodayDate();
        const elapsed = Date.now() - lastActiveRef.current.timestamp;
        if (today !== lastActiveRef.current.date || elapsed > 3_600_000) {
          setDate(today);
        }
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Today&apos;s Targets</h2>
      <TargetsCard date={date} />
    </div>
  );
}

function NutritionLabelsSection() {
  const { data } = useSWR<NutritionLabel[]>(
    "/api/nutrition-labels",
    apiFetcher,
  );

  const labels = data ?? [];
  const count = labels.length;

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Nutrition Labels</h2>
      {count > 0 ? (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{count} saved {count === 1 ? "label" : "labels"}</p>
          <Button asChild variant="outline" size="sm" className="min-h-[44px]">
            <Link href="/app/labels">Manage</Link>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">No labels saved yet</p>
          <p className="text-xs text-muted-foreground">
            Labels are automatically saved when you scan packaged products.
          </p>
        </div>
      )}
    </div>
  );
}
