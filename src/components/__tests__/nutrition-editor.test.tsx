import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NutritionEditor } from "../nutrition-editor";
import type { FoodAnalysis } from "@/types";

// Mock ResizeObserver for any Radix UI components
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  document.body.innerHTML = "";
});

const mockAnalysis: FoodAnalysis = {
  food_name: "Test Food",
  portion_size_g: 100,
  calories: 150,
  protein_g: 10,
  carbs_g: 20,
  fat_g: 5,
  fiber_g: 3,
  sodium_mg: 200,
  confidence: "high",
  notes: "Test notes for the food item",
};

describe("NutritionEditor", () => {
  it("renders all editable FoodAnalysis fields as inputs", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    // Check for all editable fields
    expect(screen.getByLabelText(/food name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/portion.*g/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/calories/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/protein/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/carbs/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fat/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fiber/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sodium/i)).toBeInTheDocument();
  });

  it("displays current values in the inputs", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    expect(screen.getByLabelText(/food name/i)).toHaveValue("Test Food");
    expect(screen.getByLabelText(/portion.*g/i)).toHaveValue(100);
    expect(screen.getByLabelText(/calories/i)).toHaveValue(150);
    expect(screen.getByLabelText(/protein/i)).toHaveValue(10);
    expect(screen.getByLabelText(/carbs/i)).toHaveValue(20);
    expect(screen.getByLabelText(/fat/i)).toHaveValue(5);
    expect(screen.getByLabelText(/fiber/i)).toHaveValue(3);
    expect(screen.getByLabelText(/sodium/i)).toHaveValue(200);
  });

  it("calls onChange with updated FoodAnalysis when food_name changes", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const nameInput = screen.getByLabelText(/food name/i);
    fireEvent.change(nameInput, { target: { value: "Updated Food" } });

    expect(onChange).toHaveBeenCalledWith({
      ...mockAnalysis,
      food_name: "Updated Food",
    });
  });

  it("calls onChange with updated FoodAnalysis when calories changes", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const caloriesInput = screen.getByLabelText(/calories/i);
    fireEvent.change(caloriesInput, { target: { value: "200" } });

    expect(onChange).toHaveBeenCalledWith({
      ...mockAnalysis,
      calories: 200,
    });
  });

  it("calls onChange with updated FoodAnalysis when protein changes", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const proteinInput = screen.getByLabelText(/protein/i);
    fireEvent.change(proteinInput, { target: { value: "15" } });

    expect(onChange).toHaveBeenCalledWith({
      ...mockAnalysis,
      protein_g: 15,
    });
  });

  it("displays confidence as read-only (not editable)", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    // Confidence should be displayed but not as an input
    expect(screen.getByText(/high/i)).toBeInTheDocument();

    // There should be no input field for confidence (only the indicator div)
    const confidenceInputs = screen.queryAllByRole("textbox").filter(
      (el) => el.id?.includes("confidence") || el.getAttribute("name")?.includes("confidence")
    );
    expect(confidenceInputs).toHaveLength(0);
  });

  it("displays notes as read-only", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    // Notes should be displayed
    expect(screen.getByText("Test notes for the food item")).toBeInTheDocument();
  });

  it("disables all inputs when disabled prop is true", () => {
    const onChange = vi.fn();
    render(
      <NutritionEditor value={mockAnalysis} onChange={onChange} disabled />
    );

    expect(screen.getByLabelText(/food name/i)).toBeDisabled();
    expect(screen.getByLabelText(/portion.*g/i)).toBeDisabled();
    expect(screen.getByLabelText(/calories/i)).toBeDisabled();
    expect(screen.getByLabelText(/protein/i)).toBeDisabled();
    expect(screen.getByLabelText(/carbs/i)).toBeDisabled();
    expect(screen.getByLabelText(/fat/i)).toBeDisabled();
    expect(screen.getByLabelText(/fiber/i)).toBeDisabled();
    expect(screen.getByLabelText(/sodium/i)).toBeDisabled();
  });

  it("rejects negative numbers for portion_size_g", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const portionInput = screen.getByLabelText(/portion.*g/i);
    fireEvent.change(portionInput, { target: { value: "-10" } });

    // Should not call onChange with negative value
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ portion_size_g: -10 })
    );
  });

  it("rejects negative numbers for calories", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const caloriesInput = screen.getByLabelText(/calories/i);
    fireEvent.change(caloriesInput, { target: { value: "-50" } });

    // Should not call onChange with negative value
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ calories: -50 })
    );
  });

  it("accepts zero for nutrition values", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const fiberInput = screen.getByLabelText(/fiber/i);
    fireEvent.change(fiberInput, { target: { value: "0" } });

    expect(onChange).toHaveBeenCalledWith({
      ...mockAnalysis,
      fiber_g: 0,
    });
  });

  it("shows confidence indicator with correct color", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator).toHaveClass("bg-green-500");
  });

  it("shows medium confidence with yellow indicator", () => {
    const onChange = vi.fn();
    const mediumConfidence = { ...mockAnalysis, confidence: "medium" as const };
    render(<NutritionEditor value={mediumConfidence} onChange={onChange} />);

    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator).toHaveClass("bg-yellow-500");
  });

  it("shows low confidence with red indicator", () => {
    const onChange = vi.fn();
    const lowConfidence = { ...mockAnalysis, confidence: "low" as const };
    render(<NutritionEditor value={lowConfidence} onChange={onChange} />);

    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator).toHaveClass("bg-red-500");
  });

  it("confidence indicator has accessible label", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator).toHaveAttribute("aria-label", "Confidence: high");
  });
});
