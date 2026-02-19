import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FloatingActions } from "@/components/floating-actions";

describe("FloatingActions", () => {
  it("renders three links with correct hrefs", () => {
    render(<FloatingActions />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(3);

    const quickSelect = screen.getByRole("link", { name: "Quick Select" });
    expect(quickSelect).toHaveAttribute("href", "/app/quick-select");

    const takePhoto = screen.getByRole("link", { name: "Take Photo" });
    expect(takePhoto).toHaveAttribute("href", "/app/analyze?autoCapture=true");

    const chat = screen.getByRole("link", { name: "Chat" });
    expect(chat).toHaveAttribute("href", "/app/chat");
  });

  it("container has fixed positioning classes", () => {
    const { container } = render(<FloatingActions />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveClass("fixed", "bottom-[calc(5rem+env(safe-area-inset-bottom))]", "right-4", "z-[55]");
  });

  it("Quick Select button has primary styling and larger size", () => {
    render(<FloatingActions />);
    const quickSelect = screen.getByRole("link", { name: "Quick Select" });
    expect(quickSelect).toHaveClass("bg-primary");
    expect(quickSelect).toHaveClass("h-14", "w-14");
  });

  it("secondary buttons have card styling", () => {
    render(<FloatingActions />);
    const takePhoto = screen.getByRole("link", { name: "Take Photo" });
    const chat = screen.getByRole("link", { name: "Chat" });
    expect(takePhoto).toHaveClass("bg-card");
    expect(chat).toHaveClass("bg-card");
  });

  it("all buttons meet minimum touch target size", () => {
    render(<FloatingActions />);
    const links = screen.getAllByRole("link");
    for (const link of links) {
      expect(link).toHaveClass("min-h-[44px]", "min-w-[44px]");
    }
  });
});
