import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeSelector } from "../time-selector";

describe("TimeSelector", () => {
  it("renders Now button and hour/minute selects", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /now/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Hour")).toBeInTheDocument();
    expect(screen.getByLabelText("Minute")).toBeInTheDocument();
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

  it("selects show HH:MM placeholders when no value", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    const hourSelect = screen.getByLabelText("Hour") as HTMLSelectElement;
    const minuteSelect = screen.getByLabelText("Minute") as HTMLSelectElement;
    expect(hourSelect.value).toBe("");
    expect(minuteSelect.value).toBe("");
  });

  it("selects show correct values when time is set", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    const hourSelect = screen.getByLabelText("Hour") as HTMLSelectElement;
    const minuteSelect = screen.getByLabelText("Minute") as HTMLSelectElement;
    expect(hourSelect.value).toBe("14");
    expect(minuteSelect.value).toBe("30");
  });

  it("calls onChange with time when hour is changed", () => {
    const onChange = vi.fn();
    render(<TimeSelector value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Hour"), { target: { value: "09" } });
    expect(onChange).toHaveBeenCalledWith("09:00");
  });

  it("calls onChange with time when minute is changed", () => {
    const onChange = vi.fn();
    render(<TimeSelector value="14:30" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Minute"), {
      target: { value: "45" },
    });
    expect(onChange).toHaveBeenCalledWith("14:45");
  });

  it("defaults to current hour when minute changed with no prior value", () => {
    const onChange = vi.fn();
    const currentHour = String(new Date().getHours()).padStart(2, "0");
    render(<TimeSelector value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Minute"), {
      target: { value: "15" },
    });
    expect(onChange).toHaveBeenCalledWith(`${currentHour}:15`);
  });

  it("respects disabled state on all controls", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: /now/i })).toBeDisabled();
    expect(screen.getByLabelText("Hour")).toBeDisabled();
    expect(screen.getByLabelText("Minute")).toBeDisabled();
  });

  it("has 24 hour options", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    const hourSelect = screen.getByLabelText("Hour");
    // 24 hours + 1 placeholder
    expect(hourSelect.querySelectorAll("option")).toHaveLength(25);
  });

  it("has 5-minute interval options", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    const minuteSelect = screen.getByLabelText("Minute");
    // 12 intervals (0, 5, 10, ... 55) + 1 placeholder
    expect(minuteSelect.querySelectorAll("option")).toHaveLength(13);
  });
});
