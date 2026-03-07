import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfidenceBadge } from "../confidence-badge";
import { confidenceExplanations } from "@/lib/confidence";

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

  it("renders AlertTriangle with destructive color for low confidence", () => {
    render(<ConfidenceBadge confidence="low" />);
    const icon = screen.getByTestId("confidence-icon-alert");
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass("text-destructive");
  });

  it("renders AlertTriangle with warning color for medium confidence", () => {
    render(<ConfidenceBadge confidence="medium" />);
    const icon = screen.getByTestId("confidence-icon-alert");
    expect(icon).toHaveClass("text-warning");
  });

  it("shows confidence indicator dot with correct color", () => {
    render(<ConfidenceBadge confidence="high" />);
    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator).toHaveClass("bg-success");
  });

  it("shows confidence text label", () => {
    render(<ConfidenceBadge confidence="high" />);
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("indicator div does NOT have aria-label (text label is already visible)", () => {
    render(<ConfidenceBadge confidence="high" />);
    const indicator = screen.getByTestId("confidence-indicator");
    expect(indicator).not.toHaveAttribute("aria-label");
  });

  it("shows explanation on click (popover)", async () => {
    const user = userEvent.setup();
    render(<ConfidenceBadge confidence="medium" />);

    const trigger = screen.getByTestId("confidence-trigger");
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText(confidenceExplanations.medium)).toBeInTheDocument();
    });
  });

  it("shows high confidence explanation on click", async () => {
    const user = userEvent.setup();
    render(<ConfidenceBadge confidence="high" />);

    const trigger = screen.getByTestId("confidence-trigger");
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText(confidenceExplanations.high)).toBeInTheDocument();
    });
  });

  it("shows low confidence explanation on click", async () => {
    const user = userEvent.setup();
    render(<ConfidenceBadge confidence="low" />);

    const trigger = screen.getByTestId("confidence-trigger");
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByText(confidenceExplanations.low)).toBeInTheDocument();
    });
  });

  it("tooltip trigger button has 44px minimum touch target", () => {
    render(<ConfidenceBadge confidence="high" />);
    const trigger = screen.getByTestId("confidence-trigger");
    expect(trigger).toHaveClass("min-h-[44px]");
  });
});
