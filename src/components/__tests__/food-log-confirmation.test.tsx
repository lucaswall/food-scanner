import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FoodLogConfirmation } from "../food-log-confirmation";
import type { FoodAnalysis, FoodLogResponse } from "@/types";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockResponse: FoodLogResponse = {
  success: true,
  fitbitFoodId: 12345,
  fitbitLogId: 67890,
  reusedFood: false,
};

const mockAnalysis: FoodAnalysis = {
  food_name: "Grilled Chicken Breast",
  amount: 200,
  unit_id: 147,
  calories: 330,
  protein_g: 42,
  carbs_g: 0,
  fat_g: 8,
  fiber_g: 0,
  sodium_mg: 120,
  confidence: "high",
  notes: "Grilled skinless chicken breast",
  description: "A grilled chicken breast on a plate with vegetables",
  keywords: ["chicken", "grilled"],
};

describe("FoodLogConfirmation", () => {
  it("displays success message with food name", () => {
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Grilled Chicken"
      />
    );

    expect(screen.getByText(/grilled chicken/i)).toBeInTheDocument();
    expect(screen.getByText(/logged/i)).toBeInTheDocument();
  });

  it("shows 'Created new food' when reusedFood is false", () => {
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
      />
    );

    expect(screen.getByText(/created new food/i)).toBeInTheDocument();
  });

  it("shows 'Reused existing food' when reusedFood is true", () => {
    const reusedResponse = { ...mockResponse, reusedFood: true };
    render(
      <FoodLogConfirmation
        response={reusedResponse}
        foodName="Test Food"
      />
    );

    expect(screen.getByText(/reused existing food/i)).toBeInTheDocument();
  });

  it("displays fitbitLogId", () => {
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
      />
    );

    expect(screen.getByText(/67890/)).toBeInTheDocument();
  });

  it("navigates to /app when Done button is clicked", () => {
    mockPush.mockClear();
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
      />
    );

    const button = screen.getByRole("button", { name: /done/i });
    fireEvent.click(button);

    expect(mockPush).toHaveBeenCalledWith("/app");
  });

  it("returns null when response is null", () => {
    const { container } = render(
      <FoodLogConfirmation
        response={null}
        foodName="Test Food"
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("displays a success checkmark icon", () => {
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
      />
    );

    // Check for checkmark icon (via test id or aria-label)
    expect(screen.getByTestId("success-icon")).toBeInTheDocument();
  });

  it("CheckCircle icon has aria-hidden='true'", () => {
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
      />
    );

    const icon = screen.getByTestId("success-icon");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  describe("aria-live region", () => {
    it("has aria-live='assertive' on success message container", () => {
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Test Food"
        />
      );

      const successContainer = screen.getByText(/logged successfully/i).closest("[aria-live]");
      expect(successContainer).toHaveAttribute("aria-live", "assertive");
    });
  });

  describe("nutrition facts card", () => {
    it("renders nutrition card when analysis prop is provided", () => {
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
        />
      );

      expect(screen.getByText("Nutrition Facts")).toBeInTheDocument();
    });

    it("displays food name in nutrition card", () => {
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
        />
      );

      expect(screen.getByText("Grilled Chicken Breast")).toBeInTheDocument();
    });

    it("displays amount with unit", () => {
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
        />
      );

      // 200g (unit_id 147 = g, no space)
      expect(screen.getByText("200g")).toBeInTheDocument();
    });

    it("displays calories", () => {
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
        />
      );

      expect(screen.getByText("330")).toBeInTheDocument();
    });

    it("displays macros (protein, carbs, fat, fiber, sodium)", () => {
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
        />
      );

      expect(screen.getByText("Protein")).toBeInTheDocument();
      expect(screen.getByText("42g")).toBeInTheDocument();
      expect(screen.getByText("Carbs")).toBeInTheDocument();
      // Both Carbs (0g) and Fiber (0g) render "0g"
      expect(screen.getAllByText("0g")).toHaveLength(2);
      expect(screen.getByText("Fat")).toBeInTheDocument();
      expect(screen.getByText("8g")).toBeInTheDocument();
      expect(screen.getByText("Fiber")).toBeInTheDocument();
      expect(screen.getByText("Sodium")).toBeInTheDocument();
      expect(screen.getByText("120mg")).toBeInTheDocument();
    });

    it("displays meal type label", () => {
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
        />
      );

      expect(screen.getByText("Dinner")).toBeInTheDocument();
    });

  // FOO-418: FoodLogConfirmation has no "Log Another" action
  it("renders Log Another button alongside Done button", () => {
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
      />
    );

    // Should have both buttons
    expect(screen.getByRole("button", { name: /log another/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
  });

  it("navigates to /app/analyze when Log Another button is clicked", () => {
    mockPush.mockClear();
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
      />
    );

    const logAnotherButton = screen.getByRole("button", { name: /log another/i });
    fireEvent.click(logAnotherButton);

    expect(mockPush).toHaveBeenCalledWith("/app/analyze");
  });

  it("Log Another button has primary variant and Done has outline variant", () => {
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
      />
    );

    const logAnotherButton = screen.getByRole("button", { name: /log another/i });
    const doneButton = screen.getByRole("button", { name: /done/i });

    // Log Another should be primary (default variant)
    expect(logAnotherButton).toHaveAttribute("data-variant", "default");
    // Done should be outline
    expect(doneButton).toHaveAttribute("data-variant", "outline");
  });

    it("does not render nutrition card when analysis is not provided", () => {
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Test Food"
        />
      );

      expect(screen.queryByText("Nutrition Facts")).not.toBeInTheDocument();
    });

    it("renders existing elements alongside nutrition card", () => {
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
        />
      );

      // Checkmark still present
      expect(screen.getByTestId("success-icon")).toBeInTheDocument();
      // Success message still present
      expect(screen.getByText(/logged successfully/i)).toBeInTheDocument();
      // Done button still present
      expect(screen.getByRole("button", { name: /done/i })).toBeInTheDocument();
    });
  });
});
