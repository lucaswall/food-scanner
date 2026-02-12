"use client";

import { useEffect } from "react";

interface AppRefreshGuardProps {
  children: React.ReactNode;
}

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const LAST_ACTIVE_KEY = "app-refresh-guard:lastActive";
const LAST_DATE_KEY = "app-refresh-guard:lastDate";

export function AppRefreshGuard({ children }: AppRefreshGuardProps) {
  useEffect(() => {
    // Initialize localStorage on mount
    const now = Date.now();
    const dateString = new Date(now).toDateString();
    localStorage.setItem(LAST_ACTIVE_KEY, String(now));
    localStorage.setItem(LAST_DATE_KEY, dateString);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Tab is hidden - record current timestamp and date
        const now = Date.now();
        const dateString = new Date(now).toDateString();
        localStorage.setItem(LAST_ACTIVE_KEY, String(now));
        localStorage.setItem(LAST_DATE_KEY, dateString);
      } else if (document.visibilityState === "visible") {
        // Tab is visible - check if we should reload
        const storedTimestamp = localStorage.getItem(LAST_ACTIVE_KEY);
        const storedDateString = localStorage.getItem(LAST_DATE_KEY);

        if (!storedTimestamp || !storedDateString) {
          // Missing data - don't reload
          return;
        }

        const now = Date.now();
        const currentDateString = new Date(now).toDateString();
        const elapsed = now - Number(storedTimestamp);

        const dateChanged = currentDateString !== storedDateString;
        const elapsedOverFourHours = elapsed > FOUR_HOURS_MS;

        if (dateChanged && elapsedOverFourHours) {
          // Both conditions met - reload the app
          window.location.href = "/app";
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return <>{children}</>;
}
