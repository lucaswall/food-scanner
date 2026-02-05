import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MealTypeSelector } from "../meal-type-selector";

// Mock ResizeObserver for Radix UI
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  // Clean up portals after each test
  document.body.innerHTML = "";
});

describe("MealTypeSelector", () => {
  it("renders a combobox trigger", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={1} onChange={onChange} />);

    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("displays the selected meal type - Breakfast (ID 1)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={1} onChange={onChange} />);

    expect(screen.getByRole("combobox")).toHaveTextContent("Breakfast");
  });

  it("displays the selected meal type - Morning Snack (ID 2)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={2} onChange={onChange} />);

    expect(screen.getByRole("combobox")).toHaveTextContent("Morning Snack");
  });

  it("displays the selected meal type - Lunch (ID 3)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={3} onChange={onChange} />);

    expect(screen.getByRole("combobox")).toHaveTextContent("Lunch");
  });

  it("displays the selected meal type - Afternoon Snack (ID 4)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={4} onChange={onChange} />);

    expect(screen.getByRole("combobox")).toHaveTextContent("Afternoon Snack");
  });

  it("displays the selected meal type - Dinner (ID 5)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={5} onChange={onChange} />);

    expect(screen.getByRole("combobox")).toHaveTextContent("Dinner");
  });

  it("displays the selected meal type - Anytime (ID 7)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={7} onChange={onChange} />);

    expect(screen.getByRole("combobox")).toHaveTextContent("Anytime");
  });

  it("respects disabled state", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={1} onChange={onChange} disabled />);

    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
  });

  it("has correct meal type mappings for all valid IDs", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MealTypeSelector value={1} onChange={onChange} />
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("Breakfast");

    rerender(<MealTypeSelector value={2} onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Morning Snack");

    rerender(<MealTypeSelector value={3} onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Lunch");

    rerender(<MealTypeSelector value={4} onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Afternoon Snack");

    rerender(<MealTypeSelector value={5} onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Dinner");

    rerender(<MealTypeSelector value={7} onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Anytime");
  });

  it("updates displayed value when value prop changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MealTypeSelector value={1} onChange={onChange} />
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("Breakfast");

    rerender(<MealTypeSelector value={5} onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Dinner");
  });
});
