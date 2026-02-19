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

  describe("with goals", () => {
    it("shows 'XX / YYg' format when all goals provided", () => {
      render(
        <MacroBars
          proteinG={85}
          carbsG={200}
          fatG={50}
          proteinGoal={100}
          carbsGoal={250}
          fatGoal={60}
        />
      );

      expect(screen.getByText("85 / 100g")).toBeInTheDocument();
      expect(screen.getByText("200 / 250g")).toBeInTheDocument();
      expect(screen.getByText("50 / 60g")).toBeInTheDocument();
    });

    it("bar width is consumed/goal*100% when goals provided", () => {
      const { container } = render(
        <MacroBars
          proteinG={50}
          carbsG={100}
          fatG={30}
          proteinGoal={100}
          carbsGoal={200}
          fatGoal={60}
        />
      );

      const proteinBar = container.querySelector('[data-testid="macro-bar-protein"]');
      const carbsBar = container.querySelector('[data-testid="macro-bar-carbs"]');
      const fatBar = container.querySelector('[data-testid="macro-bar-fat"]');

      // 50/100 = 50%, 100/200 = 50%, 30/60 = 50%
      expect(proteinBar).toHaveStyle({ width: "50%" });
      expect(carbsBar).toHaveStyle({ width: "50%" });
      expect(fatBar).toHaveStyle({ width: "50%" });
    });

    it("caps bar width at 100% when consumed exceeds goal", () => {
      const { container } = render(
        <MacroBars
          proteinG={150}
          carbsG={300}
          fatG={80}
          proteinGoal={100}
          carbsGoal={200}
          fatGoal={60}
        />
      );

      const proteinBar = container.querySelector('[data-testid="macro-bar-protein"]');
      const carbsBar = container.querySelector('[data-testid="macro-bar-carbs"]');
      const fatBar = container.querySelector('[data-testid="macro-bar-fat"]');

      // All exceed goals, should be capped at 100%
      expect(proteinBar).toHaveStyle({ width: "100%" });
      expect(carbsBar).toHaveStyle({ width: "100%" });
      expect(fatBar).toHaveStyle({ width: "100%" });

      // Labels should still show actual values
      expect(screen.getByText("150 / 100g")).toBeInTheDocument();
      expect(screen.getByText("300 / 200g")).toBeInTheDocument();
      expect(screen.getByText("80 / 60g")).toBeInTheDocument();
    });

    it("supports partial goals (only some macros have goals)", () => {
      const { container } = render(
        <MacroBars
          proteinG={50}
          carbsG={100}
          fatG={30}
          proteinGoal={100}
          carbsGoal={200}
        />
      );

      // Protein and carbs should show goal format
      expect(screen.getByText("50 / 100g")).toBeInTheDocument();
      expect(screen.getByText("100 / 200g")).toBeInTheDocument();

      // Fat should show regular format (no goal)
      expect(screen.getByText("30g")).toBeInTheDocument();

      // Protein and carbs bars should use goal-based width
      const proteinBar = container.querySelector('[data-testid="macro-bar-protein"]');
      const carbsBar = container.querySelector('[data-testid="macro-bar-carbs"]');
      expect(proteinBar).toHaveStyle({ width: "50%" });
      expect(carbsBar).toHaveStyle({ width: "50%" });

      // Fat bar should use relative-to-total width (30 / 180 = 16.67%)
      const fatBar = container.querySelector('[data-testid="macro-bar-fat"]');
      expect(fatBar).toHaveStyle({ width: "16.666666666666664%" });
    });

    it("backward compatibility: no goals = current relative behavior", () => {
      const { container } = render(<MacroBars proteinG={50} carbsG={100} fatG={50} />);

      // Should show gram-only format (note: protein and fat both show 50g)
      const gramLabels = screen.getAllByText("50g");
      expect(gramLabels).toHaveLength(2); // Protein and fat
      expect(screen.getByText("100g")).toBeInTheDocument();

      // Should use relative-to-total width
      const proteinBar = container.querySelector('[data-testid="macro-bar-protein"]');
      const carbsBar = container.querySelector('[data-testid="macro-bar-carbs"]');
      const fatBar = container.querySelector('[data-testid="macro-bar-fat"]');

      expect(proteinBar).toHaveStyle({ width: "25%" });
      expect(carbsBar).toHaveStyle({ width: "50%" });
      expect(fatBar).toHaveStyle({ width: "25%" });
    });

    it("handles zero goal gracefully", () => {
      const { container } = render(
        <MacroBars
          proteinG={50}
          carbsG={100}
          fatG={30}
          proteinGoal={0}
          carbsGoal={200}
          fatGoal={60}
        />
      );

      // Protein with zero goal should fall back to relative behavior
      const proteinBar = container.querySelector('[data-testid="macro-bar-protein"]');
      // 50 / 180 = 27.78%
      expect(proteinBar).toHaveStyle({ width: "27.77777777777778%" });

      // Should show gram-only format for protein (zero goal)
      expect(screen.getByText("50g")).toBeInTheDocument();

      // Carbs and fat should use goal-based width
      const carbsBar = container.querySelector('[data-testid="macro-bar-carbs"]');
      const fatBar = container.querySelector('[data-testid="macro-bar-fat"]');
      expect(carbsBar).toHaveStyle({ width: "50%" });
      expect(fatBar).toHaveStyle({ width: "50%" });
    });
  });

  describe("accessibility", () => {
    it("each bar div has role=progressbar with aria-valuenow, aria-valuemin, aria-valuemax, and aria-label", () => {
      const { container } = render(
        <MacroBars proteinG={50} carbsG={100} fatG={30} proteinGoal={100} carbsGoal={200} fatGoal={60} />
      );

      const proteinBar = container.querySelector('[data-testid="macro-bar-protein"]');
      const carbsBar = container.querySelector('[data-testid="macro-bar-carbs"]');
      const fatBar = container.querySelector('[data-testid="macro-bar-fat"]');

      // role=progressbar
      expect(proteinBar).toHaveAttribute("role", "progressbar");
      expect(carbsBar).toHaveAttribute("role", "progressbar");
      expect(fatBar).toHaveAttribute("role", "progressbar");

      // aria-valuemin / aria-valuemax
      expect(proteinBar).toHaveAttribute("aria-valuemin", "0");
      expect(proteinBar).toHaveAttribute("aria-valuemax", "100");
      expect(carbsBar).toHaveAttribute("aria-valuemin", "0");
      expect(carbsBar).toHaveAttribute("aria-valuemax", "100");
      expect(fatBar).toHaveAttribute("aria-valuemin", "0");
      expect(fatBar).toHaveAttribute("aria-valuemax", "100");

      // aria-valuenow reflects the percent (50/100=50%, 100/200=50%, 30/60=50%)
      expect(proteinBar).toHaveAttribute("aria-valuenow", "50");
      expect(carbsBar).toHaveAttribute("aria-valuenow", "50");
      expect(fatBar).toHaveAttribute("aria-valuenow", "50");

      // aria-label contains macro name and values
      expect(proteinBar?.getAttribute("aria-label")).toMatch(/protein/i);
      expect(carbsBar?.getAttribute("aria-label")).toMatch(/carbs/i);
      expect(fatBar?.getAttribute("aria-label")).toMatch(/fat/i);
    });
  });

  describe("over-goal visual indicators", () => {
    it("label has text-destructive class when consumed exceeds goal", () => {
      const { container } = render(
        <MacroBars
          proteinG={150}
          carbsG={300}
          fatG={80}
          proteinGoal={100}
          carbsGoal={200}
          fatGoal={60}
        />
      );

      // Find all labels - they should be the spans with tabular-nums class
      const labels = container.querySelectorAll('.tabular-nums');

      // Protein label (150 / 100g) should have text-destructive
      expect(labels[0]).toHaveClass('text-destructive');

      // Carbs label (300 / 200g) should have text-destructive
      expect(labels[1]).toHaveClass('text-destructive');

      // Fat label (80 / 60g) should have text-destructive
      expect(labels[2]).toHaveClass('text-destructive');
    });

    it("label does not have text-destructive when consumed is within goal", () => {
      const { container } = render(
        <MacroBars
          proteinG={50}
          carbsG={100}
          fatG={30}
          proteinGoal={100}
          carbsGoal={200}
          fatGoal={60}
        />
      );

      const labels = container.querySelectorAll('.tabular-nums');

      // All labels should have text-muted-foreground, not text-destructive
      expect(labels[0]).toHaveClass('text-muted-foreground');
      expect(labels[0]).not.toHaveClass('text-destructive');
      expect(labels[1]).toHaveClass('text-muted-foreground');
      expect(labels[1]).not.toHaveClass('text-destructive');
      expect(labels[2]).toHaveClass('text-muted-foreground');
      expect(labels[2]).not.toHaveClass('text-destructive');
    });

    it("label does not have text-destructive when exactly at goal", () => {
      const { container } = render(
        <MacroBars
          proteinG={100}
          carbsG={200}
          fatG={60}
          proteinGoal={100}
          carbsGoal={200}
          fatGoal={60}
        />
      );

      const labels = container.querySelectorAll('.tabular-nums');

      // At goal should use text-muted-foreground, not text-destructive
      expect(labels[0]).toHaveClass('text-muted-foreground');
      expect(labels[0]).not.toHaveClass('text-destructive');
    });

    it("label does not have text-destructive when no goal is set", () => {
      const { container } = render(
        <MacroBars
          proteinG={150}
          carbsG={300}
          fatG={80}
        />
      );

      const labels = container.querySelectorAll('.tabular-nums');

      // Without goals, should use text-muted-foreground, not text-destructive
      expect(labels[0]).toHaveClass('text-muted-foreground');
      expect(labels[0]).not.toHaveClass('text-destructive');
      expect(labels[1]).toHaveClass('text-muted-foreground');
      expect(labels[1]).not.toHaveClass('text-destructive');
      expect(labels[2]).toHaveClass('text-muted-foreground');
      expect(labels[2]).not.toHaveClass('text-destructive');
    });
  });
});
