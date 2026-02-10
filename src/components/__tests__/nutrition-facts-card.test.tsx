import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NutritionFactsCard } from "../nutrition-facts-card";

const defaultProps = {
  foodName: "Empanada de carne",
  calories: 320,
  proteinG: 12,
  carbsG: 28,
  fatG: 18,
  fiberG: 2,
  sodiumMg: 450,
  unitId: 147,
  amount: 150,
};

describe("NutritionFactsCard", () => {
  it("renders food name", () => {
    render(<NutritionFactsCard {...defaultProps} />);
    expect(screen.getByText("Empanada de carne")).toBeInTheDocument();
  });

  it("renders 'Nutrition Facts' heading", () => {
    render(<NutritionFactsCard {...defaultProps} />);
    expect(screen.getByText("Nutrition Facts")).toBeInTheDocument();
  });

  it("renders calories", () => {
    render(<NutritionFactsCard {...defaultProps} />);
    expect(screen.getByText("320")).toBeInTheDocument();
  });

  it("renders macros", () => {
    render(<NutritionFactsCard {...defaultProps} />);
    expect(screen.getByText("12g")).toBeInTheDocument(); // protein
    expect(screen.getByText("28g")).toBeInTheDocument(); // carbs
    expect(screen.getByText("18g")).toBeInTheDocument(); // fat
    expect(screen.getByText("2g")).toBeInTheDocument(); // fiber
    expect(screen.getByText("450mg")).toBeInTheDocument(); // sodium
  });

  it("renders serving info with unit label", () => {
    render(<NutritionFactsCard {...defaultProps} />);
    expect(screen.getByText("150g")).toBeInTheDocument();
  });

  it("renders meal type label when mealTypeId is provided", () => {
    render(<NutritionFactsCard {...defaultProps} mealTypeId={3} />);
    expect(screen.getByText("Lunch")).toBeInTheDocument();
  });

  it("does not render meal type when mealTypeId is omitted", () => {
    render(<NutritionFactsCard {...defaultProps} />);
    expect(screen.queryByText("Lunch")).not.toBeInTheDocument();
    expect(screen.queryByText("Breakfast")).not.toBeInTheDocument();
    expect(screen.queryByText("Dinner")).not.toBeInTheDocument();
  });

  describe("Tier 1 nutrients", () => {
    it("does not render extra rows when Tier 1 fields are null or undefined", () => {
      render(<NutritionFactsCard {...defaultProps} />);

      // Should NOT render Tier 1 nutrients when not provided
      expect(screen.queryByText("Saturated Fat")).not.toBeInTheDocument();
      expect(screen.queryByText("Trans Fat")).not.toBeInTheDocument();
      expect(screen.queryByText("Sugars")).not.toBeInTheDocument();
      expect(screen.queryByText("Calories from Fat")).not.toBeInTheDocument();
    });

    it("renders Saturated Fat indented under Fat when saturatedFatG is provided", () => {
      render(<NutritionFactsCard {...defaultProps} saturatedFatG={5} />);

      expect(screen.getByText("Saturated Fat")).toBeInTheDocument();
      expect(screen.getByText("5g")).toBeInTheDocument();

      // Check for indentation styling (pl-4 adds left padding)
      const saturatedFatRow = screen.getByText("Saturated Fat").closest("div");
      expect(saturatedFatRow?.className).toContain("pl-4");
    });

    it("renders Trans Fat indented under Fat when transFatG is provided", () => {
      render(<NutritionFactsCard {...defaultProps} transFatG={0.5} />);

      expect(screen.getByText("Trans Fat")).toBeInTheDocument();
      expect(screen.getByText("0.5g")).toBeInTheDocument();

      // Check for indentation styling
      const transFatRow = screen.getByText("Trans Fat").closest("div");
      expect(transFatRow?.className).toContain("pl-4");
    });

    it("renders Sugars indented under Carbs when sugarsG is provided", () => {
      render(<NutritionFactsCard {...defaultProps} sugarsG={8} />);

      expect(screen.getByText("Sugars")).toBeInTheDocument();
      expect(screen.getByText("8g")).toBeInTheDocument();

      // Check for indentation styling
      const sugarsRow = screen.getByText("Sugars").closest("div");
      expect(sugarsRow?.className).toContain("pl-4");
    });

    it("renders Calories from Fat when caloriesFromFat is provided", () => {
      render(<NutritionFactsCard {...defaultProps} caloriesFromFat={162} />);

      expect(screen.getByText(/Calories from Fat\s*162/i)).toBeInTheDocument();
    });

    it("renders all Tier 1 nutrients when all are provided", () => {
      render(
        <NutritionFactsCard
          {...defaultProps}
          saturatedFatG={5}
          transFatG={0.5}
          sugarsG={8}
          caloriesFromFat={162}
        />
      );

      expect(screen.getByText("Saturated Fat")).toBeInTheDocument();
      expect(screen.getByText("Trans Fat")).toBeInTheDocument();
      expect(screen.getByText("Sugars")).toBeInTheDocument();
      expect(screen.getByText(/Calories from Fat/i)).toBeInTheDocument();
    });

    it("does not render Tier 1 nutrients when values are null", () => {
      render(
        <NutritionFactsCard
          {...defaultProps}
          saturatedFatG={null}
          transFatG={null}
          sugarsG={null}
          caloriesFromFat={null}
        />
      );

      expect(screen.queryByText("Saturated Fat")).not.toBeInTheDocument();
      expect(screen.queryByText("Trans Fat")).not.toBeInTheDocument();
      expect(screen.queryByText("Sugars")).not.toBeInTheDocument();
      expect(screen.queryByText(/Calories from Fat/i)).not.toBeInTheDocument();
    });

    it("indented rows have muted text color", () => {
      render(
        <NutritionFactsCard
          {...defaultProps}
          saturatedFatG={5}
          sugarsG={8}
        />
      );

      const saturatedFatRow = screen.getByText("Saturated Fat").closest("div");
      const sugarsRow = screen.getByText("Sugars").closest("div");

      expect(saturatedFatRow?.className).toContain("text-muted-foreground");
      expect(sugarsRow?.className).toContain("text-muted-foreground");
    });
  });
});
