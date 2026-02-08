import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Loading from "@/app/app/quick-select/loading";

describe("/app/quick-select loading skeleton", () => {
  it("renders heading skeleton", () => {
    render(<Loading />);
    const heading = screen.getByTestId("skeleton-heading");
    expect(heading).toBeInTheDocument();
  });

  it("renders three food card skeletons", () => {
    render(<Loading />);
    const cards = screen.getAllByTestId("skeleton-food-card");
    expect(cards).toHaveLength(3);
  });

  it("uses correct container layout", () => {
    const { container } = render(<Loading />);
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv).toHaveClass("min-h-screen", "px-4", "py-6");
  });
});
