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

vi.mock("@/components/quick-select", () => ({
  QuickSelect: () => <div data-testid="quick-select">QuickSelect</div>,
}));

const { default: QuickSelectPage } = await import("@/app/app/quick-select/page");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "test-user-uuid",
  expiresAt: Date.now() + 86400000,
  fitbitConnected: true,
  hasFitbitCredentials: true,
  destroy: vi.fn(),
};

describe("/app/quick-select page", () => {
  it("redirects to / when session is null", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(QuickSelectPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("renders 'Quick Select' heading", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await QuickSelectPage();
    render(jsx);
    expect(screen.getByText("Quick Select")).toBeInTheDocument();
  });

  it("renders QuickSelect component", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await QuickSelectPage();
    render(jsx);
    expect(screen.getByTestId("quick-select")).toBeInTheDocument();
  });

  describe("skip link", () => {
    it("renders skip link that is focusable", async () => {
      mockGetSession.mockResolvedValue(validSession);
      const jsx = await QuickSelectPage();
      render(jsx);
      const skipLink = screen.getByRole("link", { name: /skip to main content/i });
      expect(skipLink).toBeInTheDocument();
      expect(skipLink).toHaveAttribute("href", "#main-content");
    });

    it("main content has correct id for skip link target", async () => {
      mockGetSession.mockResolvedValue(validSession);
      const jsx = await QuickSelectPage();
      render(jsx);
      const mainElement = screen.getByRole("main");
      expect(mainElement).toHaveAttribute("id", "main-content");
    });
  });
});
