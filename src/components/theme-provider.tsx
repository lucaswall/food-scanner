"use client";

import { useEffect } from "react";

interface ThemeProviderProps {
  children: React.ReactNode;
}

/**
 * ThemeProvider initializes the theme on mount by reading from localStorage.
 * Works in conjunction with the inline script in layout.tsx to prevent flash.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  useEffect(() => {
    const stored = localStorage.getItem("theme") || "system";
    const root = document.documentElement;
    root.classList.remove("light", "dark");

    if (stored === "system") {
      const systemDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      root.classList.add(systemDark ? "dark" : "light");
    } else {
      root.classList.add(stored);
    }
  }, []);

  return <>{children}</>;
}
