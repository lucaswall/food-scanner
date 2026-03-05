import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeSelector } from "../time-selector";

describe("TimeSelector", () => {
  it("renders Now button and time input", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /now/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/select custom time/i)).toBeInTheDocument();
  });

  it("Now button is pressed when value is null", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /now/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("Now button is not pressed when value is set", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /now/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("calls onChange(null) when Now button is clicked", () => {
    const onChange = vi.fn();
    render(<TimeSelector value="14:30" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /now/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("calls onChange with time value when input changes", () => {
    const onChange = vi.fn();
    render(<TimeSelector value={null} onChange={onChange} />);
    const input = screen.getByLabelText(/select custom time/i);
    fireEvent.change(input, { target: { value: "09:30" } });
    expect(onChange).toHaveBeenCalledWith("09:30");
  });

  it("calls onChange(null) when input is cleared", () => {
    const onChange = vi.fn();
    render(<TimeSelector value="14:30" onChange={onChange} />);
    const input = screen.getByLabelText(/meal time: 14:30/i);
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("updates aria-label on time input when value changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TimeSelector value={null} onChange={onChange} />
    );
    expect(screen.getByLabelText(/select custom time/i)).toBeInTheDocument();

    rerender(<TimeSelector value="08:00" onChange={onChange} />);
    expect(screen.getByLabelText(/meal time: 08:00/i)).toBeInTheDocument();
  });

  it("respects disabled state on both controls", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: /now/i })).toBeDisabled();
    expect(screen.getByLabelText(/select custom time/i)).toBeDisabled();
  });

  it("sets time input value from prop", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    const input = screen.getByLabelText(/meal time: 14:30/i) as HTMLInputElement;
    expect(input.value).toBe("14:30");
  });
});
