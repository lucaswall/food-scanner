import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeaderActions } from "@/components/header-actions";

describe("HeaderActions", () => {
  it("renders a single link", () => {
    render(<HeaderActions />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
  });

  it("renders Settings link with href /settings", () => {
    render(<HeaderActions />);
    const settingsLink = screen.getByRole("link", { name: "Settings" });
    expect(settingsLink).toHaveAttribute("href", "/settings");
  });

  it("does not render a Chat link", () => {
    render(<HeaderActions />);
    expect(screen.queryByRole("link", { name: "Chat" })).not.toBeInTheDocument();
  });

  it("does not render a Take Photo link", () => {
    render(<HeaderActions />);
    expect(screen.queryByRole("link", { name: "Take Photo" })).not.toBeInTheDocument();
  });

  it("all links meet minimum touch target size", () => {
    render(<HeaderActions />);
    const links = screen.getAllByRole("link");
    for (const link of links) {
      expect(link).toHaveClass("min-h-[44px]", "min-w-[44px]");
    }
  });

  it("uses muted foreground styling for icons", () => {
    render(<HeaderActions />);
    const links = screen.getAllByRole("link");
    for (const link of links) {
      expect(link).toHaveClass("text-muted-foreground");
    }
  });
});
