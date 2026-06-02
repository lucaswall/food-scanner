import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FoodEntryCard } from "../food-entry-card";

const defaultProps = {
  foodName: "Chicken Salad",
  calories: 350,
  proteinG: 25,
  carbsG: 15,
  fatG: 20,
  unitId: "serving" as const,
  amount: 1,
};

describe("FoodEntryCard", () => {
  it("renders food name", () => {
    render(<FoodEntryCard {...defaultProps} />);
    expect(screen.getByText("Chicken Salad")).toBeInTheDocument();
  });

  it("renders calories", () => {
    render(<FoodEntryCard {...defaultProps} />);
    expect(screen.getByText(/350 cal/)).toBeInTheDocument();
  });

  it("renders serving unit label for ServingUnit string — '1 serving'", () => {
    render(<FoodEntryCard {...defaultProps} />);
    expect(screen.getByText(/1 serving/)).toBeInTheDocument();
  });

  it("renders '150g' for unitId='g' amount=150", () => {
    render(<FoodEntryCard {...defaultProps} unitId="g" amount={150} />);
    expect(screen.getByText(/150g/)).toBeInTheDocument();
  });

  it("renders '2 slices' for unitId='slice' amount=2", () => {
    render(<FoodEntryCard {...defaultProps} unitId="slice" amount={2} />);
    expect(screen.getByText(/2 slices/)).toBeInTheDocument();
  });

  it("renders meal type label when mealTypeId is provided", () => {
    render(<FoodEntryCard {...defaultProps} mealTypeId={3} />);
    expect(screen.getByText(/Lunch/)).toBeInTheDocument();
  });

  it("renders macros", () => {
    render(<FoodEntryCard {...defaultProps} />);
    expect(screen.getByText(/P:25g/)).toBeInTheDocument();
    expect(screen.getByText(/C:15g/)).toBeInTheDocument();
    expect(screen.getByText(/F:20g/)).toBeInTheDocument();
  });

  it("renders favorite button when actions='favorite'", () => {
    render(<FoodEntryCard {...defaultProps} actions="favorite" />);
    expect(screen.getByLabelText("Toggle favorite")).toBeInTheDocument();
  });

  it("renders edit/delete buttons when actions='edit-delete'", () => {
    render(<FoodEntryCard {...defaultProps} actions="edit-delete" />);
    expect(screen.getByLabelText("Edit Chicken Salad")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete Chicken Salad")).toBeInTheDocument();
  });

  it("calls onClick when food card button is clicked", () => {
    const onClick = vi.fn();
    render(<FoodEntryCard {...defaultProps} onClick={onClick} />);
    screen.getByRole("button", { name: /Chicken Salad/ }).click();
    expect(onClick).toHaveBeenCalled();
  });
});
