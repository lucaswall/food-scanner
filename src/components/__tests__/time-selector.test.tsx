import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TimeSelector } from "../time-selector";

// Mock formatTimeFromDate to return a predictable time
vi.mock("@/lib/date-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date-utils")>();
  return {
    ...actual,
    formatTimeFromDate: () => "09:30",
  };
});

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

describe("TimeSelector", () => {
  it("renders Now button by default when value is null", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /now/i })).toBeInTheDocument();
  });

  it("shows current time as reference text in Now chip", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.getByText("09:30")).toBeInTheDocument();
  });

  it("does not show time input before Now is tapped", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(/meal time/i)).not.toBeInTheDocument();
  });

  it("tapping Now opens time picker input", () => {
    render(<TimeSelector value={null} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /now/i }));
    expect(screen.getByLabelText(/meal time/i)).toBeInTheDocument();
  });

  it("selecting a time calls onChange with HH:mm string", () => {
    const onChange = vi.fn();
    render(<TimeSelector value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /now/i }));
    fireEvent.change(screen.getByLabelText(/meal time/i), { target: { value: "09:30" } });
    expect(onChange).toHaveBeenCalledWith("09:30");
  });

  it("switching back to Now calls onChange with null", () => {
    const onChange = vi.fn();
    render(<TimeSelector value="09:30" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /now/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("displays passed value correctly in input (24h format)", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    expect(screen.getByLabelText(/meal time/i)).toHaveValue("14:30");
  });

  it("hides current time hint when custom time is selected", () => {
    render(<TimeSelector value="14:30" onChange={vi.fn()} />);
    // "09:30" is our mocked "current time" - should not appear as hint text
    expect(screen.queryByText("09:30")).not.toBeInTheDocument();
  });

  it("shows time input immediately when value is non-null", () => {
    render(<TimeSelector value="08:00" onChange={vi.fn()} />);
    expect(screen.getByLabelText(/meal time/i)).toBeInTheDocument();
  });
});
