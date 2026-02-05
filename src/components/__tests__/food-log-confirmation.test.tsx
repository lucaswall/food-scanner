import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FoodLogConfirmation } from "../food-log-confirmation";
import type { FoodLogResponse } from "@/types";

const mockResponse: FoodLogResponse = {
  success: true,
  fitbitFoodId: 12345,
  fitbitLogId: 67890,
  reusedFood: false,
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
});
