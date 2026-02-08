import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Loading from "@/app/app/analyze/loading";

describe("/app/analyze loading skeleton", () => {
  it("renders heading skeleton", () => {
    render(<Loading />);
    const heading = screen.getByTestId("skeleton-heading");
    expect(heading).toBeInTheDocument();
  });

  it("renders photo capture area skeleton", () => {
    render(<Loading />);
    const photo = screen.getByTestId("skeleton-photo");
    expect(photo).toBeInTheDocument();
  });

  it("renders description input skeleton", () => {
    render(<Loading />);
    const input = screen.getByTestId("skeleton-input");
    expect(input).toBeInTheDocument();
  });

  it("renders analyze button skeleton", () => {
    render(<Loading />);
    const button = screen.getByTestId("skeleton-button");
    expect(button).toBeInTheDocument();
  });

  it("uses correct container layout", () => {
    const { container } = render(<Loading />);
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv).toHaveClass("min-h-screen", "px-4", "py-6");
  });
});
