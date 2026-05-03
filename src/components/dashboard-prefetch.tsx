"use client";

import { useEffect } from "react";
import { preload } from "swr";
import { apiFetcher } from "@/lib/swr";
import { getTodayDate } from "@/lib/date-utils";

export function DashboardPrefetch() {
  useEffect(() => {
    const today = getTodayDate();
    const swallow = () => {};
    preload("/api/common-foods?tab=recent&limit=10", apiFetcher).catch(swallow);
    preload("/api/food-history?limit=20", apiFetcher).catch(swallow);
    preload(`/api/nutrition-summary?date=${today}`, apiFetcher).catch(swallow);
    preload(`/api/nutrition-goals?clientDate=${today}`, apiFetcher).catch(swallow);
    preload("/api/earliest-entry", apiFetcher).catch(swallow);
  }, []);
  return null;
}
