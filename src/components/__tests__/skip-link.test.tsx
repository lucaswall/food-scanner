import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SkipLink } from "../skip-link";

describe("SkipLink", () => {
  it("renders with default props", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: /skip to main content/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "#main-content");
  });

  it("renders with custom href", () => {
    render(<SkipLink href="#custom-target" />);
    const link = screen.getByRole("link", { name: /skip to main content/i });
    expect(link).toHaveAttribute("href", "#custom-target");
  });

  it("renders with custom children", () => {
    render(<SkipLink>Skip navigation</SkipLink>);
    const link = screen.getByRole("link", { name: /skip navigation/i });
    expect(link).toBeInTheDocument();
  });

  it("is visually hidden by default with sr-only class", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: /skip to main content/i });
    expect(link).toHaveClass("sr-only");
  });

  it("becomes visible on focus with focus:not-sr-only class", () => {
    render(<SkipLink />);
    const link = screen.getByRole("link", { name: /skip to main content/i });
    expect(link).toHaveClass("focus:not-sr-only");
  });
});
