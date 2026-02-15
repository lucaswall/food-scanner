"use client";

import { useState } from "react";
import { DailyDashboard } from "@/components/daily-dashboard";
import { WeeklyDashboard } from "@/components/weekly-dashboard";

type DashboardView = "daily" | "weekly";

export function DashboardShell() {
  const [view, setView] = useState<DashboardView>("daily");

  return (
    <div className="space-y-6">
      {/* Segmented control */}
      <div role="tablist" className="flex gap-1 p-1 bg-muted rounded-full">
        <button
          role="tab"
          aria-selected={view === "daily"}
          aria-controls="panel-daily"
          onClick={() => setView("daily")}
          className={`flex-1 rounded-full px-4 py-2 text-sm font-medium transition-colors min-h-[44px] ${
            view === "daily"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Daily
        </button>
        <button
          role="tab"
          aria-selected={view === "weekly"}
          aria-controls="panel-weekly"
          onClick={() => setView("weekly")}
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
      <div id={view === "daily" ? "panel-daily" : "panel-weekly"}>
        {view === "daily" ? <DailyDashboard /> : <WeeklyDashboard />}
      </div>
    </div>
  );
}
