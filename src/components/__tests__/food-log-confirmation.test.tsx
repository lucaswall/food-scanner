import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FoodLogConfirmation } from "../food-log-confirmation";
import type { FoodAnalysis, FoodLogResponse } from "@/types";

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
  keywords: ["chicken", "grilled"],
};

describe("FoodLogConfirmation", () => {
  it("displays success message with food name", () => {
    const onReset = vi.fn();
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Grilled Chicken"
        onReset={onReset}
      />
    );

    expect(screen.getByText(/grilled chicken/i)).toBeInTheDocument();
    expect(screen.getByText(/logged/i)).toBeInTheDocument();
  });

  it("shows 'Created new food' when reusedFood is false", () => {
    const onReset = vi.fn();
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
        onReset={onReset}
      />
    );

    expect(screen.getByText(/created new food/i)).toBeInTheDocument();
  });

  it("shows 'Reused existing food' when reusedFood is true", () => {
    const onReset = vi.fn();
    const reusedResponse = { ...mockResponse, reusedFood: true };
    render(
      <FoodLogConfirmation
        response={reusedResponse}
        foodName="Test Food"
        onReset={onReset}
      />
    );

    expect(screen.getByText(/reused existing food/i)).toBeInTheDocument();
  });

  it("displays fitbitLogId", () => {
    const onReset = vi.fn();
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
        onReset={onReset}
      />
    );

    expect(screen.getByText(/67890/)).toBeInTheDocument();
  });

  it("has Log Another button that calls onReset", () => {
    const onReset = vi.fn();
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
        onReset={onReset}
      />
    );

    const button = screen.getByRole("button", { name: /log another/i });
    fireEvent.click(button);

    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("returns null when response is null", () => {
    const onReset = vi.fn();
    const { container } = render(
      <FoodLogConfirmation
        response={null}
        foodName="Test Food"
        onReset={onReset}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("displays a success checkmark icon", () => {
    const onReset = vi.fn();
    render(
      <FoodLogConfirmation
        response={mockResponse}
        foodName="Test Food"
        onReset={onReset}
      />
    );

    // Check for checkmark icon (via test id or aria-label)
    expect(screen.getByTestId("success-icon")).toBeInTheDocument();
  });

  describe("aria-live region", () => {
    it("has aria-live='assertive' on success message container", () => {
      const onReset = vi.fn();
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Test Food"
          onReset={onReset}
        />
      );

      const successContainer = screen.getByText(/logged successfully/i).closest("[aria-live]");
      expect(successContainer).toHaveAttribute("aria-live", "assertive");
    });
  });

  describe("nutrition facts card", () => {
    it("renders nutrition card when analysis prop is provided", () => {
      const onReset = vi.fn();
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
          onReset={onReset}
        />
      );

      expect(screen.getByText("Nutrition Facts")).toBeInTheDocument();
    });

    it("displays food name in nutrition card", () => {
      const onReset = vi.fn();
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
          onReset={onReset}
        />
      );

      expect(screen.getByText("Grilled Chicken Breast")).toBeInTheDocument();
    });

    it("displays amount with unit", () => {
      const onReset = vi.fn();
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
          onReset={onReset}
        />
      );

      // 200g (unit_id 147 = g, no space)
      expect(screen.getByText("200g")).toBeInTheDocument();
    });

    it("displays calories", () => {
      const onReset = vi.fn();
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
          onReset={onReset}
        />
      );

      expect(screen.getByText("330")).toBeInTheDocument();
    });

    it("displays macros (protein, carbs, fat, fiber, sodium)", () => {
      const onReset = vi.fn();
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
          onReset={onReset}
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
      const onReset = vi.fn();
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
          onReset={onReset}
        />
      );

      expect(screen.getByText("Dinner")).toBeInTheDocument();
    });

    it("does not render nutrition card when analysis is not provided", () => {
      const onReset = vi.fn();
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Test Food"
          onReset={onReset}
        />
      );

      expect(screen.queryByText("Nutrition Facts")).not.toBeInTheDocument();
    });

    it("renders existing elements alongside nutrition card", () => {
      const onReset = vi.fn();
      render(
        <FoodLogConfirmation
          response={mockResponse}
          foodName="Grilled Chicken Breast"
          analysis={mockAnalysis}
          mealTypeId={5}
          onReset={onReset}
        />
      );

      // Checkmark still present
      expect(screen.getByTestId("success-icon")).toBeInTheDocument();
      // Success message still present
      expect(screen.getByText(/logged successfully/i)).toBeInTheDocument();
      // Log Another button still present
      expect(screen.getByRole("button", { name: /log another/i })).toBeInTheDocument();
    });
  });
});
