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

  it("does not render a budget marker", () => {
    const { container } = render(<CalorieRing calories={1000} goal={2000} />);
    const marker = container.querySelector('[data-testid="budget-marker"]');
    expect(marker).not.toBeInTheDocument();
  });

  describe("accessibility", () => {
    it("SVG has aria-hidden=true and a visually-hidden span describes the calories", () => {
      render(<CalorieRing calories={1200} goal={2000} />);

      const svg = screen.getByTestId("calorie-ring-svg");
      expect(svg).toHaveAttribute("aria-hidden", "true");

      // A visually-hidden sr-only span should exist with calorie text
      const srOnly = document.querySelector(".sr-only");
      expect(srOnly).toBeInTheDocument();
      expect(srOnly?.textContent).toMatch(/1200/);
      expect(srOnly?.textContent).toMatch(/2000/);
    });
  });

  describe("over-goal visual indicators", () => {
    it("calorie count has text-destructive class when over goal", () => {
      const { container } = render(<CalorieRing calories={2500} goal={2000} />);
      const calorieText = container.querySelector('.text-2xl');
      expect(calorieText).toHaveClass('text-destructive');
    });

    it("calorie count does not have text-destructive when below goal", () => {
      const { container } = render(<CalorieRing calories={1500} goal={2000} />);
      const calorieText = container.querySelector('.text-2xl');
      expect(calorieText).not.toHaveClass('text-destructive');
    });

    it("calorie count does not have text-destructive when exactly at goal", () => {
      const { container } = render(<CalorieRing calories={2000} goal={2000} />);
      const calorieText = container.querySelector('.text-2xl');
      expect(calorieText).not.toHaveClass('text-destructive');
    });

    it("calorie count does not have text-destructive when goal is zero", () => {
      const { container } = render(<CalorieRing calories={1000} goal={0} />);
      const calorieText = container.querySelector('.text-2xl');
      expect(calorieText).not.toHaveClass('text-destructive');
    });
  });
});
