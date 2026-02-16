import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiniNutritionCard } from "../mini-nutrition-card";
import type { FoodAnalysis } from "@/types";

const mockAnalysis: FoodAnalysis = {
  food_name: "Chicken breast",
  amount: 150,
  unit_id: 147, // grams
  calories: 248,
  protein_g: 46,
  carbs_g: 0,
  fat_g: 5,
  fiber_g: 0,
  sodium_mg: 110,
  saturated_fat_g: null,
  trans_fat_g: null,
  sugars_g: null,
  calories_from_fat: null,
  confidence: "high",
  notes: "Grilled chicken breast",
  description: "A grilled chicken breast on a plate",
  keywords: ["chicken", "breast", "grilled"],
};

describe("MiniNutritionCard", () => {
  it("renders food name", () => {
    render(<MiniNutritionCard analysis={mockAnalysis} />);

    expect(screen.getByText("Chicken breast")).toBeInTheDocument();
  });

  it("renders serving size with correct unit label", () => {
    render(<MiniNutritionCard analysis={mockAnalysis} />);

    expect(screen.getByText("150g")).toBeInTheDocument();
  });

  it("renders calories prominently", () => {
    render(<MiniNutritionCard analysis={mockAnalysis} />);

    expect(screen.getByText("248")).toBeInTheDocument();
    expect(screen.getByText("cal")).toBeInTheDocument();
  });

  it("renders macros in horizontal row", () => {
    render(<MiniNutritionCard analysis={mockAnalysis} />);

    // Check that P, C, F values are present
    expect(screen.getByText(/P: 46g/)).toBeInTheDocument();
    expect(screen.getByText(/C: 0g/)).toBeInTheDocument();
    expect(screen.getByText(/F: 5g/)).toBeInTheDocument();
  });

  it("highlights changed values when previousAnalysis is provided", () => {
    const previousAnalysis: FoodAnalysis = {
      ...mockAnalysis,
      calories: 200,
      protein_g: 40,
    };

    const { container } = render(
      <MiniNutritionCard
        analysis={mockAnalysis}
        previousAnalysis={previousAnalysis}
      />
    );

    // Changed values should have font-semibold class
    const caloriesElement = container.querySelector('[class*="font-semibold"]');
    expect(caloriesElement).toBeInTheDocument();
  });

  it("renders correct unit label for cups", () => {
    const cupsAnalysis: FoodAnalysis = {
      ...mockAnalysis,
      amount: 2,
      unit_id: 91, // cups
    };

    render(<MiniNutritionCard analysis={cupsAnalysis} />);

    expect(screen.getByText("2 cups")).toBeInTheDocument();
  });
});
