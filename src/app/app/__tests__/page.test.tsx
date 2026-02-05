import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

// Mock iron-session
vi.mock("iron-session", () => ({
  getIronSession: vi.fn().mockResolvedValue({
    sessionId: "test-session",
    email: "wall.lucas@gmail.com",
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
  }),
}));

// Mock next/headers
vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
  }),
}));

const { default: AppPage } = await import("@/app/app/page");

describe("/app page", () => {
  it("renders 'Food Scanner' heading", async () => {
    const jsx = await AppPage();
    render(jsx);
    expect(screen.getByText("Food Scanner")).toBeInTheDocument();
  });

  it("renders link to /settings", async () => {
    const jsx = await AppPage();
    render(jsx);
    const link = screen.getByRole("link", { name: /settings/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/settings");
  });

  it("settings button has proper aria-label", async () => {
    const jsx = await AppPage();
    render(jsx);
    const button = screen.getByRole("link", { name: /settings/i });
    expect(button).toHaveAttribute("aria-label", "Settings");
  });

  it("settings button meets 44px touch target", async () => {
    const jsx = await AppPage();
    render(jsx);
    const button = screen.getByRole("link", { name: /settings/i });
    expect(button).toHaveClass("min-h-[44px]");
    expect(button).toHaveClass("min-w-[44px]");
  });

  describe("skip link", () => {
    it("renders skip link that is focusable", async () => {
      const jsx = await AppPage();
      render(jsx);
      const skipLink = screen.getByRole("link", { name: /skip to main content/i });
      expect(skipLink).toBeInTheDocument();
      expect(skipLink).toHaveAttribute("href", "#main-content");
    });

    it("skip link is visually hidden but focusable", async () => {
      const jsx = await AppPage();
      render(jsx);
      const skipLink = screen.getByRole("link", { name: /skip to main content/i });
      // Check for sr-only class (visually hidden) but it should become visible on focus
      expect(skipLink).toHaveClass("sr-only");
      expect(skipLink).toHaveClass("focus:not-sr-only");
    });

    it("main content has correct id for skip link target", async () => {
      const jsx = await AppPage();
      render(jsx);
      const mainElement = screen.getByRole("main");
      expect(mainElement).toHaveAttribute("id", "main-content");
    });
  });
});
