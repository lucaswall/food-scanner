"use client";

import { useEffect } from "react";
import { preload } from "swr";
import { apiFetcher } from "@/lib/swr";
import { getTodayDate } from "@/lib/date-utils";

export function DashboardPrefetch() {
  useEffect(() => {
    const today = getTodayDate();
    preload("/api/common-foods?tab=recent&limit=10", apiFetcher);
    preload("/api/food-history?limit=20", apiFetcher);
    preload(`/api/nutrition-summary?date=${today}`, apiFetcher);
    preload(`/api/nutrition-goals?clientDate=${today}`, apiFetcher);
    preload(`/api/lumen-goals?date=${today}`, apiFetcher);
    preload("/api/earliest-entry", apiFetcher);
  }, []);
  return null;
}
