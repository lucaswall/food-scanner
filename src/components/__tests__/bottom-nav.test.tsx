import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BottomNav } from "../bottom-nav";

const mockPathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

describe("BottomNav", () => {
  it("renders four nav items (Home, Analyze, Quick Select, Chat)", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Analyze")).toBeInTheDocument();
    expect(screen.getByText("Quick Select")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("does NOT include History in the nav items", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    expect(screen.queryByText("History")).not.toBeInTheDocument();
  });

  it("Home links to /app", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).toHaveAttribute("href", "/app");
  });

  it("Analyze links to /app/analyze", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const analyzeLink = screen.getByRole("link", { name: /^analyze$/i });
    expect(analyzeLink).toHaveAttribute("href", "/app/analyze");
  });

  it("Quick Select links to /app/quick-select", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const quickSelectLink = screen.getByRole("link", { name: /quick select/i });
    expect(quickSelectLink).toHaveAttribute("href", "/app/quick-select");
  });

  it("Chat links to /app/chat", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const chatLink = screen.getByRole("link", { name: /^chat$/i });
    expect(chatLink).toHaveAttribute("href", "/app/chat");
  });

  it("active route is visually highlighted with aria-current", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).toHaveAttribute("aria-current", "page");

    const analyzeLink = screen.getByRole("link", { name: /^analyze$/i });
    expect(analyzeLink).not.toHaveAttribute("aria-current");
  });

  it("Analyze is active when on /app/analyze", () => {
    mockPathname.mockReturnValue("/app/analyze");
    render(<BottomNav />);

    const analyzeLink = screen.getByRole("link", { name: /^analyze$/i });
    expect(analyzeLink).toHaveAttribute("aria-current", "page");

    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).not.toHaveAttribute("aria-current");
  });

  it("Quick Select is active when on /app/quick-select", () => {
    mockPathname.mockReturnValue("/app/quick-select");
    render(<BottomNav />);

    const quickSelectLink = screen.getByRole("link", { name: /quick select/i });
    expect(quickSelectLink).toHaveAttribute("aria-current", "page");

    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).not.toHaveAttribute("aria-current");
  });

  it("Chat is active when on /app/chat", () => {
    mockPathname.mockReturnValue("/app/chat");
    render(<BottomNav />);

    const chatLink = screen.getByRole("link", { name: /^chat$/i });
    expect(chatLink).toHaveAttribute("aria-current", "page");

    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).not.toHaveAttribute("aria-current");
  });

  it("no nav item has aria-current when pathname is /settings", () => {
    mockPathname.mockReturnValue("/settings");
    render(<BottomNav />);

    const links = screen.getAllByRole("link");
    links.forEach((link) => {
      expect(link).not.toHaveAttribute("aria-current");
    });
  });

  it("nav has aria-label", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    expect(screen.getByRole("navigation")).toHaveAttribute(
      "aria-label",
      "Main navigation"
    );
  });

  it("nav item labels use text-xs font size", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const labels = screen.getAllByText(
      /^(Home|Analyze|Quick Select|Chat)$/
    );
    labels.forEach((label) => {
      expect(label).toHaveClass("text-xs");
    });
  });

  it("all touch targets are at least 44x44px", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    links.forEach((link) => {
      expect(link).toHaveClass("min-h-[44px]");
      expect(link).toHaveClass("min-w-[44px]");
    });
  });

  it("has landscape safe area insets for left and right", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const nav = screen.getByRole("navigation");
    expect(nav).toHaveClass("pl-[env(safe-area-inset-left)]");
    expect(nav).toHaveClass("pr-[env(safe-area-inset-right)]");
  });

  it("active indicator element exists within the nav", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    expect(screen.getByTestId("active-indicator")).toBeInTheDocument();
  });

  it("active indicator has a CSS transition class for smooth movement", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const indicator = screen.getByTestId("active-indicator");
    expect(indicator).toHaveClass("motion-safe:transition-transform");
  });

  it("active indicator position corresponds to Home (index 0) when on /app", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const indicator = screen.getByTestId("active-indicator");
    expect(indicator).toHaveStyle("transform: translateX(0%)");
  });

  it("active indicator position corresponds to Chat (index 3) when on /app/chat", () => {
    mockPathname.mockReturnValue("/app/chat");
    render(<BottomNav />);

    const indicator = screen.getByTestId("active-indicator");
    expect(indicator).toHaveStyle("transform: translateX(300%)");
  });

  it("active indicator width is 25%", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const indicator = screen.getByTestId("active-indicator");
    expect(indicator).toHaveStyle("width: 25%");
  });

  it("active indicator has no transform when on /settings (no active tab)", () => {
    mockPathname.mockReturnValue("/settings");
    render(<BottomNav />);

    const indicator = screen.getByTestId("active-indicator");
    expect(indicator).toHaveClass("opacity-0");
  });
});
