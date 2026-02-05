"use client";

import { useState, useEffect, useCallback, useTransition } from "react";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && ["light", "dark", "system"].includes(stored)) {
    return stored as Theme;
  }
  return "system";
}

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.remove("light", "dark");

  if (theme === "system") {
    root.classList.add(getSystemTheme());
  } else {
    root.classList.add(theme);
  }
}

export function useTheme() {
  // Always start with "system" on server and initial client render for consistent hydration
  const [theme, setThemeState] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);
  const [, startTransition] = useTransition();

  // On mount, read from localStorage and update state
  useEffect(() => {
    const storedTheme = getStoredTheme();
    applyTheme(storedTheme);

    startTransition(() => {
      setThemeState(storedTheme);
      setMounted(true);
    });
  }, []);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (!mounted || theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme, mounted]);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
    applyTheme(newTheme);
  }, []);

  return { theme, setTheme };
}
