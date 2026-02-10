import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CalorieRing } from "../calorie-ring";

afterEach(() => {
  cleanup();
});

describe("CalorieRing", () => {
  it("renders an SVG with a circle element", () => {
    render(<CalorieRing calories={1200} goal={2000} />);
    const svg = screen.getByTestId("calorie-ring-svg");
    expect(svg).toBeInTheDocument();
    expect(svg.tagName).toBe("svg");

    const circles = svg.querySelectorAll("circle");
    expect(circles.length).toBeGreaterThanOrEqual(1);
  });

  it("shows consumed/goal text in center", () => {
    render(<CalorieRing calories={1200} goal={2000} />);
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("/ 2,000 cal")).toBeInTheDocument();
  });

  it("formats large numbers with commas", () => {
    render(<CalorieRing calories={12345} goal={20000} />);
    expect(screen.getByText("12,345")).toBeInTheDocument();
    expect(screen.getByText("/ 20,000 cal")).toBeInTheDocument();
  });

  it("shows progress visually via stroke-dasharray/stroke-dashoffset", () => {
    const { container } = render(<CalorieRing calories={1000} goal={2000} />);
    const progressCircle = container.querySelector('[data-testid="calorie-ring-progress"]');

    expect(progressCircle).toBeInTheDocument();
    expect(progressCircle).toHaveAttribute("stroke-dasharray");
    expect(progressCircle).toHaveAttribute("stroke-dashoffset");
  });

  it("at 0% progress, the progress arc has full dashoffset (invisible)", () => {
    const { container } = render(<CalorieRing calories={0} goal={2000} />);
    const progressCircle = container.querySelector('[data-testid="calorie-ring-progress"]');

    const dashArray = progressCircle?.getAttribute("stroke-dasharray");
    const dashOffset = progressCircle?.getAttribute("stroke-dashoffset");

    // At 0%, dashoffset should equal dasharray (full circle hidden)
    expect(dashOffset).toBe(dashArray);
  });

  it("at 100%+ progress, the arc is fully drawn", () => {
    const { container } = render(<CalorieRing calories={2000} goal={2000} />);
    const progressCircle = container.querySelector('[data-testid="calorie-ring-progress"]');

    const dashOffset = progressCircle?.getAttribute("stroke-dashoffset");

    // At 100%, dashoffset should be 0 (full circle visible)
    expect(dashOffset).toBe("0");
  });

  it("at 50% progress, the arc is half drawn", () => {
    const { container } = render(<CalorieRing calories={1000} goal={2000} />);
    const progressCircle = container.querySelector('[data-testid="calorie-ring-progress"]');

    const dashArray = progressCircle?.getAttribute("stroke-dasharray");
    const dashOffset = progressCircle?.getAttribute("stroke-dashoffset");

    // At 50%, dashoffset should be half of dasharray
    if (dashArray && dashOffset) {
      const arrayValue = parseFloat(dashArray);
      const offsetValue = parseFloat(dashOffset);
      expect(offsetValue).toBeCloseTo(arrayValue * 0.5, 1);
    }
  });

  it("handles edge case: goal=0 gracefully (no division by zero)", () => {
    const { container } = render(<CalorieRing calories={1000} goal={0} />);

    expect(screen.getByText("1,000")).toBeInTheDocument();
    expect(screen.getByText("/ 0 cal")).toBeInTheDocument();

    // Should not crash, and progress circle should exist
    const progressCircle = container.querySelector('[data-testid="calorie-ring-progress"]');
    expect(progressCircle).toBeInTheDocument();
  });

  it("caps progress over 100% at full circle", () => {
    const { container } = render(<CalorieRing calories={3000} goal={2000} />);
    const progressCircle = container.querySelector('[data-testid="calorie-ring-progress"]');

    const dashOffset = progressCircle?.getAttribute("stroke-dashoffset");

    // Even at 150%, dashoffset should be 0 (capped at 100%)
    expect(dashOffset).toBe("0");
  });

  it("has minimum size appropriate for mobile", () => {
    render(<CalorieRing calories={1200} goal={2000} />);
    const svg = screen.getByTestId("calorie-ring-svg");

    // Should have reasonable viewBox for ~128px default size
    expect(svg).toHaveAttribute("viewBox");
  });

  describe("budget marker", () => {
    it("renders a marker when budget prop is provided", () => {
      const { container } = render(<CalorieRing calories={1000} goal={2000} budget={1500} />);
      const marker = container.querySelector('[data-testid="budget-marker"]');
      expect(marker).toBeInTheDocument();
    });

    it("does not render a marker when budget prop is undefined", () => {
      const { container } = render(<CalorieRing calories={1000} goal={2000} />);
      const marker = container.querySelector('[data-testid="budget-marker"]');
      expect(marker).not.toBeInTheDocument();
    });

    it("caps marker at goal position when budget exceeds goal", () => {
      const { container } = render(<CalorieRing calories={1000} goal={2000} budget={2500} />);
      const marker = container.querySelector('[data-testid="budget-marker"]');

      // Marker should be positioned at 100% (goal position)
      // For a budget of 2500 (125% of goal), should cap at goal (2000)
      expect(marker).toBeInTheDocument();

      // At budgetPosition=1 (100%), marker completes full circle back to SVG 3 o'clock
      // Same coordinates as 0%: x1=114, y1=64, x2=126, y2=64
      const x1 = marker?.getAttribute("x1");
      const y1 = marker?.getAttribute("y1");
      const x2 = marker?.getAttribute("x2");
      const y2 = marker?.getAttribute("y2");

      expect(parseFloat(x1 ?? "0")).toBeCloseTo(114, 1);
      expect(parseFloat(y1 ?? "0")).toBeCloseTo(64, 1);
      expect(parseFloat(x2 ?? "0")).toBeCloseTo(126, 1);
      expect(parseFloat(y2 ?? "0")).toBeCloseTo(64, 1);
    });

    it("positions marker at start when budget is 0", () => {
      const { container } = render(<CalorieRing calories={1000} goal={2000} budget={0} />);
      const marker = container.querySelector('[data-testid="budget-marker"]');
      expect(marker).toBeInTheDocument();

      // At budgetPosition=0, marker should be at SVG 3 o'clock (rightmost)
      // After CSS -rotate-90, this appears at 12 o'clock on screen
      // Expected coordinates: x1=114, y1=64, x2=126, y2=64 (horizontal line at right)
      const x1 = marker?.getAttribute("x1");
      const y1 = marker?.getAttribute("y1");
      const x2 = marker?.getAttribute("x2");
      const y2 = marker?.getAttribute("y2");

      expect(parseFloat(x1 ?? "0")).toBeCloseTo(114, 1);
      expect(parseFloat(y1 ?? "0")).toBeCloseTo(64, 1);
      expect(parseFloat(x2 ?? "0")).toBeCloseTo(126, 1);
      expect(parseFloat(y2 ?? "0")).toBeCloseTo(64, 1);
    });

    it("positions marker at 50% of goal at SVG 9 o'clock", () => {
      const { container } = render(<CalorieRing calories={500} goal={2000} budget={1000} />);
      const marker = container.querySelector('[data-testid="budget-marker"]');
      expect(marker).toBeInTheDocument();

      // At budgetPosition=0.5 (50%), marker should be at SVG 9 o'clock (leftmost)
      // After CSS -rotate-90, this appears at 6 o'clock on screen
      // Expected coordinates: x1=14, y1=64, x2=2, y2=64 (horizontal line at left)
      const x1 = marker?.getAttribute("x1");
      const y1 = marker?.getAttribute("y1");
      const x2 = marker?.getAttribute("x2");
      const y2 = marker?.getAttribute("y2");

      expect(parseFloat(x1 ?? "0")).toBeCloseTo(14, 1);
      expect(parseFloat(y1 ?? "0")).toBeCloseTo(64, 1);
      expect(parseFloat(x2 ?? "0")).toBeCloseTo(2, 1);
      expect(parseFloat(y2 ?? "0")).toBeCloseTo(64, 1);
    });

    it("positions marker at start when budget is negative", () => {
      const { container } = render(<CalorieRing calories={1000} goal={2000} budget={-100} />);
      const marker = container.querySelector('[data-testid="budget-marker"]');
      expect(marker).toBeInTheDocument();
    });
  });
});
