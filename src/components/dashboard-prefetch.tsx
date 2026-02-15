"use client";

import { useEffect } from "react";
import { preload } from "swr";
import { apiFetcher } from "@/lib/swr";

export function DashboardPrefetch() {
  useEffect(() => {
    preload("/api/common-foods?tab=recent&limit=10", apiFetcher);
    preload("/api/food-history?limit=20", apiFetcher);
  }, []);
  return null;
}
