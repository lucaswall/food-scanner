import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BottomNav } from "../bottom-nav";

const mockPathname = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
}));

describe("BottomNav", () => {
  it("renders five nav items (Home, Quick Select, Take Photo, History, Settings)", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Quick Select")).toBeInTheDocument();
    expect(screen.getByText("Take Photo")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
  });

  it("Home links to /app", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).toHaveAttribute("href", "/app");
  });

  it("Quick Select links to /app/quick-select", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const quickSelectLink = screen.getByRole("link", { name: /quick select/i });
    expect(quickSelectLink).toHaveAttribute("href", "/app/quick-select");
  });

  it("Take Photo links to /app/analyze", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const takePhotoLink = screen.getByRole("link", { name: /take photo/i });
    expect(takePhotoLink).toHaveAttribute("href", "/app/analyze");
  });

  it("History links to /app/history", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const historyLink = screen.getByRole("link", { name: /history/i });
    expect(historyLink).toHaveAttribute("href", "/app/history");
  });

  it("Settings links to /settings", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const settingsLink = screen.getByRole("link", { name: /settings/i });
    expect(settingsLink).toHaveAttribute("href", "/settings");
  });

  it("active route is visually highlighted with aria-current", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).toHaveAttribute("aria-current", "page");

    const historyLink = screen.getByRole("link", { name: /history/i });
    expect(historyLink).not.toHaveAttribute("aria-current");
  });

  it("History is active when on /app/history", () => {
    mockPathname.mockReturnValue("/app/history");
    render(<BottomNav />);

    const historyLink = screen.getByRole("link", { name: /history/i });
    expect(historyLink).toHaveAttribute("aria-current", "page");

    const homeLink = screen.getByRole("link", { name: /home/i });
    expect(homeLink).not.toHaveAttribute("aria-current");
  });

  it("Take Photo is active when on /app/analyze", () => {
    mockPathname.mockReturnValue("/app/analyze");
    render(<BottomNav />);

    const takePhotoLink = screen.getByRole("link", { name: /take photo/i });
    expect(takePhotoLink).toHaveAttribute("aria-current", "page");

    // Home should NOT be active on /app/analyze
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

  it("Settings is active when on /settings", () => {
    mockPathname.mockReturnValue("/settings");
    render(<BottomNav />);

    const settingsLink = screen.getByRole("link", { name: /settings/i });
    expect(settingsLink).toHaveAttribute("aria-current", "page");
  });

  it("all touch targets are at least 44x44px", () => {
    mockPathname.mockReturnValue("/app");
    render(<BottomNav />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);
    links.forEach((link) => {
      expect(link).toHaveClass("min-h-[44px]");
      expect(link).toHaveClass("min-w-[44px]");
    });
  });
});
