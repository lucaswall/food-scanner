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
});
