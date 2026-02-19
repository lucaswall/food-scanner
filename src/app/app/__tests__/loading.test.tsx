import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Loading from "@/app/app/loading";

describe("/app loading skeleton", () => {
  it("renders heading skeleton in header row with action skeletons", () => {
    render(<Loading />);
    const heading = screen.getByTestId("skeleton-heading");
    expect(heading).toBeInTheDocument();

    const headerRow = heading.parentElement as HTMLElement;
    expect(headerRow).toHaveClass("flex", "items-center", "justify-between");

    const actions = screen.getByTestId("skeleton-actions");
    expect(actions).toBeInTheDocument();
    expect(actions.parentElement).toBe(headerRow);
  });

  it("renders toggle skeleton for Daily/Weekly segmented control", () => {
    render(<Loading />);
    const toggle = screen.getByTestId("skeleton-toggle");
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveClass("h-11", "rounded-full");
  });

  it("renders dashboard preview skeleton", () => {
    render(<Loading />);
    const preview = screen.getByTestId("skeleton-preview");
    expect(preview).toBeInTheDocument();
  });

  it("uses correct container layout", () => {
    const { container } = render(<Loading />);
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv).toHaveClass("min-h-screen", "px-4", "py-6");
  });
});
