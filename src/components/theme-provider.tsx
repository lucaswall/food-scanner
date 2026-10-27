"use client";

import { useEffect } from "react";

interface ThemeProviderProps {
  children: React.ReactNode;
}

const THEMES = ["light", "dark", "system"];

function readStoredTheme(): string {
  const stored = localStorage.getItem("theme");
  return stored && THEMES.includes(stored) ? stored : "system";
}

function applyStoredTheme(mediaQuery: MediaQueryList) {
  const stored = readStoredTheme();
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(
    stored === "system" ? (mediaQuery.matches ? "dark" : "light") : stored,
  );
}

/**
 * ThemeProvider initializes the theme on mount by reading from localStorage and,
 * while the stored theme is "system", follows OS light/dark changes on every page.
 * Works in conjunction with the inline script in layout.tsx to prevent flash.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    applyStoredTheme(mediaQuery);

    // The stored value is re-read on each event so a theme change made in Settings
    // is respected without this component needing to know about it.
    const handleChange = () => {
      if (readStoredTheme() === "system") applyStoredTheme(mediaQuery);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return <>{children}</>;
}
