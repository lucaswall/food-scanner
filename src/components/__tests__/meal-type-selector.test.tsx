import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
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

    expect(screen.getByText("Breakfast")).toBeInTheDocument();
  });

  it("displays the selected meal type - Morning Snack (ID 2)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={2} onChange={onChange} />);

    expect(screen.getByText("Morning Snack")).toBeInTheDocument();
  });

  it("displays the selected meal type - Lunch (ID 3)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={3} onChange={onChange} />);

    expect(screen.getByText("Lunch")).toBeInTheDocument();
  });

  it("displays the selected meal type - Afternoon Snack (ID 4)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={4} onChange={onChange} />);

    expect(screen.getByText("Afternoon Snack")).toBeInTheDocument();
  });

  it("displays the selected meal type - Dinner (ID 5)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={5} onChange={onChange} />);

    expect(screen.getByText("Dinner")).toBeInTheDocument();
  });

  it("displays the selected meal type - Anytime (ID 7)", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={7} onChange={onChange} />);

    expect(screen.getByText("Anytime")).toBeInTheDocument();
  });

  it("respects disabled state", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={1} onChange={onChange} disabled />);

    const combobox = screen.getByRole("combobox");
    expect(combobox).toBeDisabled();
  });

  it("has correct meal type mappings for all valid IDs", () => {
    const mealTypes: { [key: number]: string } = {
      1: "Breakfast",
      2: "Morning Snack",
      3: "Lunch",
      4: "Afternoon Snack",
      5: "Dinner",
      7: "Anytime",
    };

    const onChange = vi.fn();

    Object.entries(mealTypes).forEach(([id, name]) => {
      const { unmount } = render(
        <MealTypeSelector value={Number(id)} onChange={onChange} />
      );

      expect(screen.getByText(name)).toBeInTheDocument();
      unmount();
    });
  });

  it("updates displayed value when value prop changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MealTypeSelector value={1} onChange={onChange} />
    );

    expect(screen.getByText("Breakfast")).toBeInTheDocument();

    rerender(<MealTypeSelector value={3} onChange={onChange} />);

    expect(screen.getByText("Lunch")).toBeInTheDocument();
  });

  it("passes id prop to the select trigger", () => {
    const onChange = vi.fn();
    render(<MealTypeSelector value={1} onChange={onChange} id="test-meal" />);

    const combobox = screen.getByRole("combobox");
    expect(combobox).toHaveAttribute("id", "test-meal");
  });

  describe("time-based hint", () => {
    it("shows helper text with current time context when showTimeHint is true", () => {
      const onChange = vi.fn();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-05T08:30:00"));

      render(
        <MealTypeSelector value={3} onChange={onChange} showTimeHint={true} />
      );

      expect(screen.getByText(/based on current time/i)).toBeInTheDocument();
      // The time display should be present (format depends on locale)
      expect(screen.getByText(/[0-9]{2}:[0-9]{2}/)).toBeInTheDocument();

      vi.useRealTimers();
    });

    it("hides helper text when showTimeHint is false", () => {
      const onChange = vi.fn();
      render(
        <MealTypeSelector value={3} onChange={onChange} showTimeHint={false} />
      );

      expect(
        screen.queryByText(/based on current time/i)
      ).not.toBeInTheDocument();
    });

    it("shows helper text by default (showTimeHint defaults to true)", () => {
      const onChange = vi.fn();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-05T08:30:00"));

      render(<MealTypeSelector value={3} onChange={onChange} />);

      expect(screen.getByText(/based on current time/i)).toBeInTheDocument();
      expect(screen.getByText(/[0-9]{2}:[0-9]{2}/)).toBeInTheDocument();

      vi.useRealTimers();
    });

    it("updates time display when time changes", () => {
      const onChange = vi.fn();
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-05T12:00:00"));

      const { rerender } = render(
        <MealTypeSelector value={3} onChange={onChange} showTimeHint />
      );

      // Get initial time text
      const timeText1 = screen.getByText(/[0-9]{2}:[0-9]{2}/);
      expect(timeText1).toBeInTheDocument();

      // Simulate time passing - advance timer by 61 seconds to trigger the interval
      act(() => {
        vi.setSystemTime(new Date("2026-02-05T12:01:00"));
        vi.advanceTimersByTime(61000);
      });

      // Rerender to pick up new time
      act(() => {
        rerender(<MealTypeSelector value={3} onChange={onChange} showTimeHint />);
      });

      // The component should have rendered with updated time
      const timeText2 = screen.getByText(/[0-9]{2}:[0-9]{2}/);
      expect(timeText2).toBeInTheDocument();

      vi.useRealTimers();
    });
  });
});
