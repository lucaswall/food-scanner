"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Clock } from "lucide-react";
import { DailyDashboard } from "@/components/daily-dashboard";
import { WeeklyDashboard } from "@/components/weekly-dashboard";

type DashboardView = "daily" | "weekly";

export function DashboardShell() {
  const [view, setView] = useState<DashboardView>("daily");
  const [isPending, startTransition] = useTransition();

  return (
    <div className={`space-y-6${isPending ? " opacity-50" : ""}`}>
      {/* History link */}
      <Link
        href="/app/history"
        className="flex items-center gap-3 rounded-lg border bg-card p-4 min-h-[44px] text-card-foreground transition-colors hover:bg-accent"
      >
        <Clock className="h-5 w-5 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">History</p>
          <p className="text-xs text-muted-foreground">View past logged meals</p>
        </div>
      </Link>

      {/* Segmented control */}
      <div className="flex gap-1 p-1 bg-muted rounded-full">
        <button
          aria-controls="panel-dashboard"
          aria-pressed={view === "daily"}
          onClick={() => startTransition(() => setView("daily"))}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors min-h-[44px] ${
            view === "daily"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Daily
        </button>
        <button
          aria-controls="panel-dashboard"
          aria-pressed={view === "weekly"}
          onClick={() => startTransition(() => setView("weekly"))}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors min-h-[44px] ${
            view === "weekly"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Weekly
        </button>
      </div>

      {/* Conditional dashboard rendering */}
      <div id="panel-dashboard">
        {view === "daily" ? <DailyDashboard /> : <WeeklyDashboard />}
      </div>
    </div>
  );
}
