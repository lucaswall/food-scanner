import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FullSession } from "@/types";

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
}));

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    mockRedirect(...args);
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("@/components/dashboard-shell", () => ({
  DashboardShell: () => (
    <div data-testid="dashboard-shell">DashboardShell</div>
  ),
}));

vi.mock("@/components/dashboard-prefetch", () => ({
  DashboardPrefetch: () => null,
}));

vi.mock("@/components/fitbit-status-banner", () => ({
  FitbitStatusBanner: () => (
    <div data-testid="fitbit-status-banner">FitbitStatusBanner</div>
  ),
}));

const { default: AppPage } = await import("@/app/app/page");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "test-user-uuid",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

describe("/app page", () => {
  it("redirects to / when session is null", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(AppPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("does not render a heading element", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AppPage();
    render(jsx);
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("renders FitbitStatusBanner component", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AppPage();
    render(jsx);
    expect(screen.getByTestId("fitbit-status-banner")).toBeInTheDocument();
  });

  it("renders DashboardShell component", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AppPage();
    render(jsx);
    expect(screen.getByTestId("dashboard-shell")).toBeInTheDocument();
  });

  describe("skip link", () => {
    it("renders skip link that is focusable", async () => {
      mockGetSession.mockResolvedValue(validSession);
      const jsx = await AppPage();
      render(jsx);
      const skipLink = screen.getByRole("link", {
        name: /skip to main content/i,
      });
      expect(skipLink).toBeInTheDocument();
      expect(skipLink).toHaveAttribute("href", "#main-content");
    });

    it("skip link is visually hidden but focusable", async () => {
      mockGetSession.mockResolvedValue(validSession);
      const jsx = await AppPage();
      render(jsx);
      const skipLink = screen.getByRole("link", {
        name: /skip to main content/i,
      });
      expect(skipLink).toHaveClass("sr-only");
      expect(skipLink).toHaveClass("focus:not-sr-only");
    });

    it("main content has correct id for skip link target", async () => {
      mockGetSession.mockResolvedValue(validSession);
      const jsx = await AppPage();
      render(jsx);
      const mainElement = screen.getByRole("main");
      expect(mainElement).toHaveAttribute("id", "main-content");
    });
  });
});
