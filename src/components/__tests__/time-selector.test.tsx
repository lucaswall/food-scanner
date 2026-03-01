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
  it("renders a trigger button", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("displays 'Now' in trigger when value is null", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByText("Now")).toBeInTheDocument();
  });

  it("displays selected time in trigger when value is set", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    expect(screen.getByText("14:30")).toBeInTheDocument();
  });

  it("respects disabled state", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("has correct aria-label when value is null", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Meal time: Now"
    );
  });

  it("has correct aria-label when value is set", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    expect(screen.getByRole("button")).toHaveAttribute(
      "aria-label",
      "Meal time: 14:30"
    );
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

  it("has a hidden time input for native picker", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    const input = document.querySelector("input[type='time']");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-hidden", "true");
  });

  it("calls onChange when hidden time input changes", () => {
    const onChange = vi.fn();
    render(<TimeSelector value={null} onChange={onChange} />);
    const input = document.querySelector("input[type='time']") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "09:30" } });
    expect(onChange).toHaveBeenCalledWith("09:30");
  });

  it("sets hidden time input value from prop", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    const input = document.querySelector("input[type='time']") as HTMLInputElement;
    expect(input.value).toBe("14:30");
  });
});
