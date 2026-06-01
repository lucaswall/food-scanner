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

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("@/components/skip-link", () => ({
  SkipLink: () => <a href="#main-content">Skip to main content</a>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, className, ...props }: { children: React.ReactNode; className?: string }) => (
    <button className={className} {...props}>{children}</button>
  ),
}));

const { default: ConnectHealthPage } = await import("@/app/app/connect-health/page");

const validSession: FullSession = {
  sessionId: "test-session",
  userId: "test-user-uuid",
  expiresAt: Date.now() + 86400000,
  healthConnected: false,
  destroy: vi.fn(),
};

describe("/app/connect-health page", () => {
  it("redirects to / when session is null", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(ConnectHealthPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("renders h1 'Connect Google Health'", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await ConnectHealthPage();
    render(jsx);
    expect(screen.getByRole("heading", { level: 1, name: /connect google health/i })).toBeInTheDocument();
  });

  it("renders SkipLink", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await ConnectHealthPage();
    render(jsx);
    expect(screen.getByText("Skip to main content")).toBeInTheDocument();
  });

  it("renders <main id='main-content'>", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await ConnectHealthPage();
    render(jsx);
    expect(document.getElementById("main-content")).toBeInTheDocument();
  });

  it("renders back link to /app", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await ConnectHealthPage();
    render(jsx);
    const backLink = screen.getByRole("link", { name: /back to food scanner/i });
    expect(backLink).toHaveAttribute("href", "/app");
  });

  it("renders a form that POSTs to /api/auth/google-health", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await ConnectHealthPage();
    const { container } = render(jsx);
    const form = container.querySelector("form");
    expect(form).toHaveAttribute("action", "/api/auth/google-health");
    expect(form).toHaveAttribute("method", "POST");
  });

  it("renders connect button with min-h-[44px]", async () => {
    mockGetSession.mockResolvedValue(validSession);
    const jsx = await ConnectHealthPage();
    render(jsx);
    const button = screen.getByRole("button", { name: /connect google health/i });
    expect(button).toBeInTheDocument();
    expect(button.className).toContain("min-h-[44px]");
  });
});
