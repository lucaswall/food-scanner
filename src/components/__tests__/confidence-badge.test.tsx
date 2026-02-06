import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfidenceBadge } from "../confidence-badge";

// Mock ResizeObserver for Radix UI
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

describe("ConfidenceBadge", () => {
  it("renders CheckCircle icon for high confidence", () => {
    render(<ConfidenceBadge confidence="high" />);
    expect(screen.getByTestId("confidence-icon-check")).toBeInTheDocument();
  });

  it("renders AlertTriangle icon for medium confidence", () => {
    render(<ConfidenceBadge confidence="medium" />);
    expect(screen.getByTestId("confidence-icon-alert")).toBeInTheDocument();
  });

  it("renders AlertTriangle with red color for low confidence", () => {
    render(<ConfidenceBadge confidence="low" />);
    const icon = screen.getByTestId("confidence-icon-alert");
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass("text-red-500");
  });

  it("renders AlertTriangle with yellow color for medium confidence", () => {
    render(<ConfidenceBadge confidence="medium" />);
    const icon = screen.getByTestId("confidence-icon-alert");
    expect(icon).toHaveClass("text-yellow-500");
  });

  it("shows confidence indicator dot with correct color", () => {
    render(<ConfidenceBadge confidence="high" />);
    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator).toHaveClass("bg-green-500");
  });

  it("shows confidence text label", () => {
    render(<ConfidenceBadge confidence="high" />);
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("has accessible label on indicator", () => {
    render(<ConfidenceBadge confidence="medium" />);
    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator).toHaveAttribute("aria-label", "Confidence: medium");
  });

  it("shows tooltip with confidence explanation on hover", async () => {
    const user = userEvent.setup();
    render(<ConfidenceBadge confidence="high" />);

    const trigger = screen.getByTestId("confidence-trigger");
    await user.hover(trigger);

    await waitFor(() => {
      const tooltip = screen.getByRole("tooltip");
      expect(tooltip).toBeInTheDocument();
      expect(tooltip).toHaveTextContent(/certain/i);
    });
  });

  it("shows low confidence explanation in tooltip", async () => {
    const user = userEvent.setup();
    render(<ConfidenceBadge confidence="low" />);

    const trigger = screen.getByTestId("confidence-trigger");
    await user.hover(trigger);

    await waitFor(() => {
      const tooltip = screen.getByRole("tooltip");
      expect(tooltip).toHaveTextContent(/uncertain|verify/i);
    });
  });
});
