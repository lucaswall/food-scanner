import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeSelector } from "../time-selector";

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

describe("TimeSelector", () => {
  it("renders a combobox trigger", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("displays 'Now' in trigger when value is null", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("displays selected time in trigger when value is set", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    expect(screen.getByText("14:30")).toBeInTheDocument();
  });

  it("does not show time input when value is null", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.queryByLabelText("Meal time")).not.toBeInTheDocument();
  });

  it("shows time input when value is set", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    expect(screen.getByLabelText("Meal time")).toBeInTheDocument();
    expect(screen.getByLabelText("Meal time")).toHaveValue("14:30");
  });

  it("calls onChange with time string when time input changes", () => {
    const onChange = vi.fn();
    render(<TimeSelector value="14:30" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Meal time"), {
      target: { value: "09:00" },
    });
    expect(onChange).toHaveBeenCalledWith("09:00");
  });

  it("calls onChange with null when time input is cleared", () => {
    const onChange = vi.fn();
    render(<TimeSelector value="14:30" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Meal time"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("respects disabled state on combobox", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("respects disabled state on time input", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} disabled />);
    expect(screen.getByLabelText("Meal time")).toBeDisabled();
  });

  it("updates trigger text when value changes from null to time", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TimeSelector value={null} onChange={onChange} />
    );
    expect(screen.getByText("Now")).toBeInTheDocument();

    rerender(<TimeSelector value="08:00" onChange={onChange} />);
    expect(screen.getByText("08:00")).toBeInTheDocument();
  });

  it("updates trigger text when value changes from time to null", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TimeSelector value="08:00" onChange={onChange} />
    );
    expect(screen.getByText("08:00")).toBeInTheDocument();

    rerender(<TimeSelector value={null} onChange={onChange} />);
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("hides time input when value is externally reset to null", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TimeSelector value="14:30" onChange={onChange} />
    );
    expect(screen.getByLabelText("Meal time")).toBeInTheDocument();

    rerender(<TimeSelector value={null} onChange={onChange} />);
    expect(screen.queryByLabelText("Meal time")).not.toBeInTheDocument();
  });

  it("has correct aria-label when value is null", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-label",
      "Meal time: Now"
    );
  });

  it("has correct aria-label when value is set", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveAttribute(
      "aria-label",
      "Meal time: 14:30"
    );
  });
});
