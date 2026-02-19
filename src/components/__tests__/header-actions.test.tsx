import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HeaderActions } from "@/components/header-actions";

describe("HeaderActions", () => {
  it("renders two links with correct hrefs", () => {
    render(<HeaderActions />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);

    const chat = screen.getByRole("link", { name: "Chat" });
    expect(chat).toHaveAttribute("href", "/app/chat");

    const takePhoto = screen.getByRole("link", { name: "Take Photo" });
    expect(takePhoto).toHaveAttribute(
      "href",
      "/app/analyze?autoCapture=true"
    );
  });

  it("does not render a Quick Select link", () => {
    render(<HeaderActions />);
    expect(
      screen.queryByRole("link", { name: "Quick Select" })
    ).not.toBeInTheDocument();
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
