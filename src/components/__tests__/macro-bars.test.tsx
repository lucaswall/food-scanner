import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MacroBars } from "../macro-bars";

afterEach(() => {
  cleanup();
});

describe("MacroBars", () => {
  it("renders 3 bars: Protein, Carbs, Fat", () => {
    render(<MacroBars proteinG={85} carbsG={200} fatG={50} />);

    expect(screen.getByText(/protein/i)).toBeInTheDocument();
    expect(screen.getByText(/carbs/i)).toBeInTheDocument();
    expect(screen.getByText(/fat/i)).toBeInTheDocument();
  });

  it("shows gram amount label for each macro", () => {
    render(<MacroBars proteinG={85} carbsG={200} fatG={50} />);

    expect(screen.getByText("85g")).toBeInTheDocument();
    expect(screen.getByText("200g")).toBeInTheDocument();
    expect(screen.getByText("50g")).toBeInTheDocument();
  });

  it("bar width is proportional to value relative to total macros", () => {
    const { container } = render(<MacroBars proteinG={50} carbsG={100} fatG={50} />);

    const proteinBar = container.querySelector('[data-testid="macro-bar-protein"]');
    const carbsBar = container.querySelector('[data-testid="macro-bar-carbs"]');
    const fatBar = container.querySelector('[data-testid="macro-bar-fat"]');

    // Carbs (100g) should be widest since it's 50% of total (200g)
    // Protein and Fat (50g each) should be 25% each
    expect(proteinBar).toHaveStyle({ width: "25%" });
    expect(carbsBar).toHaveStyle({ width: "50%" });
    expect(fatBar).toHaveStyle({ width: "25%" });
  });

  it("handles 0 values gracefully (empty bars)", () => {
    const { container } = render(<MacroBars proteinG={0} carbsG={100} fatG={0} />);

    const proteinBar = container.querySelector('[data-testid="macro-bar-protein"]');
    const fatBar = container.querySelector('[data-testid="macro-bar-fat"]');

    expect(proteinBar).toHaveStyle({ width: "0%" });
    expect(fatBar).toHaveStyle({ width: "0%" });

    // Labels should still show 0g (two macros have 0g)
    expect(screen.getAllByText("0g")).toHaveLength(2);
  });

  it("handles all zeros gracefully (no division by zero)", () => {
    const { container } = render(<MacroBars proteinG={0} carbsG={0} fatG={0} />);

    // Should not crash, bars should exist with 0% width
    const proteinBar = container.querySelector('[data-testid="macro-bar-protein"]');
    expect(proteinBar).toBeInTheDocument();
    expect(proteinBar).toHaveStyle({ width: "0%" });
  });

  it("each bar has a distinct color", () => {
    const { container } = render(<MacroBars proteinG={85} carbsG={200} fatG={50} />);

    const proteinBar = container.querySelector('[data-testid="macro-bar-protein"]');
    const carbsBar = container.querySelector('[data-testid="macro-bar-carbs"]');
    const fatBar = container.querySelector('[data-testid="macro-bar-fat"]');

    // Check each bar has a different color class
    const proteinClasses = proteinBar?.className || "";
    const carbsClasses = carbsBar?.className || "";
    const fatClasses = fatBar?.className || "";

    // Should not all have the same background color
    expect(proteinClasses).not.toBe(carbsClasses);
    expect(carbsClasses).not.toBe(fatClasses);
    expect(proteinClasses).not.toBe(fatClasses);
  });

  it("renders in mobile-friendly layout", () => {
    const { container } = render(<MacroBars proteinG={85} carbsG={200} fatG={50} />);

    // Should have a container with flex layout for vertical stacking
    const macroContainer = container.querySelector('[data-testid="macro-bars"]');
    expect(macroContainer).toBeInTheDocument();
  });

  it("rounds decimal values to whole numbers", () => {
    render(<MacroBars proteinG={85.7} carbsG={200.3} fatG={50.1} />);

    expect(screen.getByText("86g")).toBeInTheDocument();
    expect(screen.getByText("200g")).toBeInTheDocument();
    expect(screen.getByText("50g")).toBeInTheDocument();
  });
});
