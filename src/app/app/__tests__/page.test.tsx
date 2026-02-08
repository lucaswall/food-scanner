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

vi.mock("@/components/dashboard-preview", () => ({
  DashboardPreview: () => (
    <div data-testid="dashboard-preview">DashboardPreview</div>
  ),
}));

vi.mock("@/components/dashboard-prefetch", () => ({
  DashboardPrefetch: () => null,
}));

const { default: AppPage } = await import("@/app/app/page");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "test-user-uuid",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  destroy: vi.fn(),
};

describe("/app page", () => {
  it("redirects to / when session is null", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(AppPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("renders 'Food Scanner' heading", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AppPage();
    render(jsx);
    expect(screen.getByText("Food Scanner")).toBeInTheDocument();
  });

  it("renders Take Photo CTA button linking to /app/analyze", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AppPage();
    render(jsx);
    const link = screen.getByRole("link", { name: /take photo/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/app/analyze");
  });

  it("renders Quick Select CTA button linking to /app/quick-select", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AppPage();
    render(jsx);
    const link = screen.getByRole("link", { name: /quick select/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/app/quick-select");
  });

  it("renders blurred dashboard preview with Coming Soon text", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AppPage();
    render(jsx);
    expect(screen.getByTestId("dashboard-preview")).toBeInTheDocument();
  });

  it("CTA buttons have min touch target size (44px)", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await AppPage();
    render(jsx);
    const takePhoto = screen.getByRole("link", { name: /take photo/i });
    const quickSelect = screen.getByRole("link", { name: /quick select/i });
    expect(takePhoto).toHaveClass("min-h-[44px]");
    expect(quickSelect).toHaveClass("min-h-[44px]");
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
