import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Loading from "@/app/app/history/loading";

describe("/app/history loading skeleton", () => {
  it("renders heading skeleton", () => {
    render(<Loading />);
    const heading = screen.getByTestId("skeleton-heading");
    expect(heading).toBeInTheDocument();
  });

  it("renders date picker skeleton", () => {
    render(<Loading />);
    const datePicker = screen.getByTestId("skeleton-date-picker");
    expect(datePicker).toBeInTheDocument();
  });

  it("renders three entry skeletons", () => {
    render(<Loading />);
    const entries = screen.getAllByTestId("skeleton-entry");
    expect(entries).toHaveLength(3);
  });

  it("uses correct container layout", () => {
    const { container } = render(<Loading />);
    const outerDiv = container.firstElementChild as HTMLElement;
    expect(outerDiv).toHaveClass("min-h-screen", "px-4", "py-6");
  });
});
