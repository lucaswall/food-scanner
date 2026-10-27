import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ThemeProvider } from "../theme-provider";

type Listener = () => void;

let listeners: Listener[] = [];
let systemDark = false;

function installMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    get matches() {
      return systemDark;
    },
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: (_: string, l: Listener) => {
      listeners = listeners.filter((x) => x !== l);
    },
  })) as unknown as typeof window.matchMedia;
}

function fireSystemChange(dark: boolean) {
  systemDark = dark;
  act(() => listeners.forEach((l) => l()));
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    listeners = [];
    systemDark = false;
    localStorage.clear();
    document.documentElement.className = "";
    installMatchMedia();
  });

  afterEach(() => {
    cleanup();
  });

  it("applies the OS theme when no theme is stored", () => {
    systemDark = true;
    render(<ThemeProvider>x</ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("falls back to system for an invalid stored value", () => {
    localStorage.setItem("theme", "purple");
    render(<ThemeProvider>x</ThemeProvider>);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("purple")).toBe(false);
  });

  it("follows OS changes app-wide while the theme is 'system'", () => {
    render(<ThemeProvider>x</ThemeProvider>);
    expect(document.documentElement.classList.contains("light")).toBe(true);

    fireSystemChange(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("ignores OS changes when an explicit theme is stored", () => {
    localStorage.setItem("theme", "light");
    render(<ThemeProvider>x</ThemeProvider>);

    fireSystemChange(true);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("removes the OS listener on unmount", () => {
    const { unmount } = render(<ThemeProvider>x</ThemeProvider>);
    expect(listeners.length).toBe(1);
    unmount();
    expect(listeners.length).toBe(0);
  });
});
