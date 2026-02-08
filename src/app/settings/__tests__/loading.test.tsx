import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Loading from "@/app/settings/loading";

describe("/settings loading skeleton", () => {
  it("renders back button skeleton", () => {
    render(<Loading />);
    const backButton = screen.getByTestId("skeleton-back-button");
    expect(backButton).toBeInTheDocument();
  });

  it("renders heading skeleton", () => {
    render(<Loading />);
    const heading = screen.getByTestId("skeleton-heading");
    expect(heading).toBeInTheDocument();
  });

  it("renders settings card skeleton", () => {
    render(<Loading />);
    const settingsCard = screen.getByTestId("skeleton-settings-card");
    expect(settingsCard).toBeInTheDocument();
  });

  it("renders appearance card skeleton", () => {
    render(<Loading />);
    const appearanceCard = screen.getByTestId("skeleton-appearance-card");
    expect(appearanceCard).toBeInTheDocument();
  });

  it("uses settings centering layout", () => {
    const { container } = render(<Loading />);
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv).toHaveClass("flex", "min-h-screen", "items-center", "justify-center", "px-4");
  });
});
