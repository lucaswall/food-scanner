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

  describe("FOO-434: skeleton matches page layout", () => {
    it("renders tab bar skeleton", () => {
      render(<Loading />);
      const tabBar = screen.getByTestId("skeleton-tab-bar");
      expect(tabBar).toBeInTheDocument();
    });

    it("renders search input skeleton", () => {
      render(<Loading />);
      const searchInput = screen.getByTestId("skeleton-search-input");
      expect(searchInput).toBeInTheDocument();
    });
  });
});
