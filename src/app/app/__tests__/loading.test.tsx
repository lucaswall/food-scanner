import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Loading from "@/app/app/loading";

describe("/app loading skeleton", () => {
  it("renders heading skeleton", () => {
    render(<Loading />);
    const heading = screen.getByTestId("skeleton-heading");
    expect(heading).toBeInTheDocument();
  });

  it("renders two card skeletons in a grid", () => {
    render(<Loading />);
    const cards = screen.getAllByTestId("skeleton-card");
    expect(cards).toHaveLength(2);
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
