import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NutritionEditor } from "../nutrition-editor";
import type { FoodAnalysis } from "@/types";
import { FITBIT_UNITS } from "@/types";

// Mock ResizeObserver for any Radix UI components
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
});

const mockAnalysis: FoodAnalysis = {
  food_name: "Test Food",
  amount: 100,
  unit_id: 147,
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

    expect(screen.getByLabelText(/food name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/calories/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/protein/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/carbs/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fat/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fiber/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/sodium/i)).toBeInTheDocument();
  });

  it("renders amount input field", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const amountInput = screen.getByLabelText(/portion/i);
    expect(amountInput).toBeInTheDocument();
    expect(amountInput).toHaveValue(100);
  });

  it("renders unit dropdown with common Fitbit units", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const unitSelect = screen.getByLabelText(/unit/i);
    expect(unitSelect).toBeInTheDocument();

    // Verify all units are options
    for (const key of Object.keys(FITBIT_UNITS)) {
      const unit = FITBIT_UNITS[key as keyof typeof FITBIT_UNITS];
      expect(unitSelect).toContainHTML(`value="${unit.id}"`);
    }
  });

  it("unit dropdown shows current unit as selected", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={{ ...mockAnalysis, unit_id: 91 }} onChange={onChange} />);

    const unitSelect = screen.getByLabelText(/unit/i) as HTMLSelectElement;
    expect(unitSelect.value).toBe("91");
  });

  it("changing amount input calls onChange with new amount", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const amountInput = screen.getByLabelText(/portion/i);
    fireEvent.change(amountInput, { target: { value: "200" } });

    expect(onChange).toHaveBeenCalledWith({
      ...mockAnalysis,
      amount: 200,
    });
  });

  it("changing unit dropdown calls onChange with new unit_id", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const unitSelect = screen.getByLabelText(/unit/i);
    fireEvent.change(unitSelect, { target: { value: "91" } });

    expect(onChange).toHaveBeenCalledWith({
      ...mockAnalysis,
      unit_id: 91,
    });
  });

  it("amount input rejects negative values", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const amountInput = screen.getByLabelText(/portion/i);
    fireEvent.change(amountInput, { target: { value: "-10" } });

    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ amount: -10 })
    );
  });

  it("displays current values in the inputs", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    expect(screen.getByLabelText(/food name/i)).toHaveValue("Test Food");
    expect(screen.getByLabelText(/portion/i)).toHaveValue(100);
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

  it("displays confidence as read-only (not editable)", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    expect(screen.getByText(/high/i)).toBeInTheDocument();

    const confidenceInputs = screen.queryAllByRole("textbox").filter(
      (el) => el.id?.includes("confidence") || el.getAttribute("name")?.includes("confidence")
    );
    expect(confidenceInputs).toHaveLength(0);
  });

  it("displays notes as read-only", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    expect(screen.getByText("Test notes for the food item")).toBeInTheDocument();
  });

  it("disables all inputs when disabled prop is true", () => {
    const onChange = vi.fn();
    render(
      <NutritionEditor value={mockAnalysis} onChange={onChange} disabled />
    );

    expect(screen.getByLabelText(/food name/i)).toBeDisabled();
    expect(screen.getByLabelText(/portion/i)).toBeDisabled();
    expect(screen.getByLabelText(/unit/i)).toBeDisabled();
    expect(screen.getByLabelText(/calories/i)).toBeDisabled();
    expect(screen.getByLabelText(/protein/i)).toBeDisabled();
    expect(screen.getByLabelText(/carbs/i)).toBeDisabled();
    expect(screen.getByLabelText(/fat/i)).toBeDisabled();
    expect(screen.getByLabelText(/fiber/i)).toBeDisabled();
    expect(screen.getByLabelText(/sodium/i)).toBeDisabled();
  });

  it("rejects negative numbers for calories", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    const caloriesInput = screen.getByLabelText(/calories/i);
    fireEvent.change(caloriesInput, { target: { value: "-50" } });

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

  describe("confidence tooltip", () => {
    it("shows tooltip on hover with explanation text", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

      const confidenceTrigger = screen.getByTestId("confidence-trigger");
      await user.hover(confidenceTrigger);

      await waitFor(() => {
        const tooltip = screen.getByRole("tooltip");
        expect(tooltip).toBeInTheDocument();
        expect(tooltip).toHaveTextContent(/confidence/i);
      });
    });
  });

  it("does not render Small/Medium/Large preset buttons", () => {
    const onChange = vi.fn();
    render(<NutritionEditor value={mockAnalysis} onChange={onChange} />);

    expect(screen.queryByRole("button", { name: /small/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /medium/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /large/i })).not.toBeInTheDocument();
  });

  describe("accessible confidence indicator", () => {
    it("shows CheckCircle icon for high confidence", () => {
      const onChange = vi.fn();
      render(<NutritionEditor value={{ ...mockAnalysis, confidence: "high" }} onChange={onChange} />);

      expect(screen.getByTestId("confidence-icon-check")).toBeInTheDocument();
    });

    it("shows AlertTriangle icon for medium confidence", () => {
      const onChange = vi.fn();
      render(<NutritionEditor value={{ ...mockAnalysis, confidence: "medium" }} onChange={onChange} />);

      expect(screen.getByTestId("confidence-icon-alert")).toBeInTheDocument();
    });

    it("shows AlertTriangle icon for low confidence", () => {
      const onChange = vi.fn();
      render(<NutritionEditor value={{ ...mockAnalysis, confidence: "low" }} onChange={onChange} />);

      expect(screen.getByTestId("confidence-icon-alert")).toBeInTheDocument();
    });
  });
});
