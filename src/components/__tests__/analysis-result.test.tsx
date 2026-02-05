import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnalysisResult } from "../analysis-result";
import type { FoodAnalysis } from "@/types";

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

const mockAnalysis: FoodAnalysis = {
  food_name: "Empanada de carne",
  portion_size_g: 150,
  calories: 320,
  protein_g: 12,
  carbs_g: 28,
  fat_g: 18,
  fiber_g: 2,
  sodium_mg: 450,
  confidence: "high",
  notes: "Standard Argentine beef empanada, baked style",
};

describe("AnalysisResult", () => {
  it("displays all FoodAnalysis fields", () => {
    const onRetry = vi.fn();
    render(
      <AnalysisResult
        analysis={mockAnalysis}
        loading={false}
        error={null}
        onRetry={onRetry}
      />
    );

    // Check food name
    expect(screen.getByText("Empanada de carne")).toBeInTheDocument();

    // Check portion size
    expect(screen.getByText(/150g/)).toBeInTheDocument();

    // Check calories
    expect(screen.getByText(/320/)).toBeInTheDocument();

    // Check macros - use more specific patterns to avoid ambiguity
    expect(screen.getByText("12g")).toBeInTheDocument(); // protein
    expect(screen.getByText("28g")).toBeInTheDocument(); // carbs
    expect(screen.getByText("18g")).toBeInTheDocument(); // fat
    expect(screen.getByText("2g")).toBeInTheDocument(); // fiber
    expect(screen.getByText("450mg")).toBeInTheDocument(); // sodium
  });

  it("shows confidence indicator with correct color - high (green)", () => {
    const onRetry = vi.fn();
    render(
      <AnalysisResult
        analysis={{ ...mockAnalysis, confidence: "high" }}
        loading={false}
        error={null}
        onRetry={onRetry}
      />
    );

    const confidenceElement = screen.getByTestId("confidence-indicator");
    expect(confidenceElement).toHaveClass("bg-green-500");
  });

  it("shows confidence indicator with correct color - medium (yellow)", () => {
    const onRetry = vi.fn();
    render(
      <AnalysisResult
        analysis={{ ...mockAnalysis, confidence: "medium" }}
        loading={false}
        error={null}
        onRetry={onRetry}
      />
    );

    const confidenceElement = screen.getByTestId("confidence-indicator");
    expect(confidenceElement).toHaveClass("bg-yellow-500");
  });

  it("shows confidence indicator with correct color - low (red)", () => {
    const onRetry = vi.fn();
    render(
      <AnalysisResult
        analysis={{ ...mockAnalysis, confidence: "low" }}
        loading={false}
        error={null}
        onRetry={onRetry}
      />
    );

    const confidenceElement = screen.getByTestId("confidence-indicator");
    expect(confidenceElement).toHaveClass("bg-red-500");
  });

  it("displays notes/assumptions", () => {
    const onRetry = vi.fn();
    render(
      <AnalysisResult
        analysis={mockAnalysis}
        loading={false}
        error={null}
        onRetry={onRetry}
      />
    );

    expect(
      screen.getByText("Standard Argentine beef empanada, baked style")
    ).toBeInTheDocument();
  });

  it("shows loading state during analysis", () => {
    const onRetry = vi.fn();
    render(
      <AnalysisResult
        analysis={null}
        loading={true}
        error={null}
        onRetry={onRetry}
      />
    );

    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    expect(screen.getByText(/analyzing/i)).toBeInTheDocument();
  });

  describe("multi-step loading progress", () => {
    it("shows loadingStep text when provided", () => {
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={null}
          loading={true}
          error={null}
          onRetry={onRetry}
          loadingStep="Reading images..."
        />
      );

      expect(screen.getByText("Reading images...")).toBeInTheDocument();
    });

    it("shows different step texts", () => {
      const onRetry = vi.fn();
      const { rerender } = render(
        <AnalysisResult
          analysis={null}
          loading={true}
          error={null}
          onRetry={onRetry}
          loadingStep="Identifying food..."
        />
      );

      expect(screen.getByText("Identifying food...")).toBeInTheDocument();

      rerender(
        <AnalysisResult
          analysis={null}
          loading={true}
          error={null}
          onRetry={onRetry}
          loadingStep="Calculating nutrition..."
        />
      );

      expect(screen.getByText("Calculating nutrition...")).toBeInTheDocument();
    });

    it("falls back to generic message when loadingStep not provided", () => {
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={null}
          loading={true}
          error={null}
          onRetry={onRetry}
        />
      );

      expect(screen.getByText(/analyzing your food/i)).toBeInTheDocument();
    });
  });

  it("shows error state with retry button", () => {
    const onRetry = vi.fn();
    render(
      <AnalysisResult
        analysis={null}
        loading={false}
        error="Failed to analyze food image"
        onRetry={onRetry}
      />
    );

    expect(screen.getByText(/failed to analyze/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls onRetry when retry button is clicked", () => {
    const onRetry = vi.fn();
    render(
      <AnalysisResult
        analysis={null}
        loading={false}
        error="Failed to analyze food image"
        onRetry={onRetry}
      />
    );

    const retryButton = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retryButton);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when no analysis, not loading, and no error", () => {
    const onRetry = vi.fn();
    const { container } = render(
      <AnalysisResult
        analysis={null}
        loading={false}
        error={null}
        onRetry={onRetry}
      />
    );

    // Container should be empty or have minimal content
    expect(container.textContent).toBe("");
  });

  it("confidence indicator has accessible label", () => {
    const onRetry = vi.fn();
    render(
      <AnalysisResult
        analysis={mockAnalysis}
        loading={false}
        error={null}
        onRetry={onRetry}
      />
    );

    const confidenceElement = screen.getByTestId("confidence-indicator");
    expect(confidenceElement).toHaveAttribute("aria-label", "Confidence: high");
  });

  describe("confidence tooltip", () => {
    it("shows tooltip on hover with explanation text", async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={mockAnalysis}
          loading={false}
          error={null}
          onRetry={onRetry}
        />
      );

      const confidenceTrigger = screen.getByTestId("confidence-trigger");
      await user.hover(confidenceTrigger);

      await waitFor(() => {
        const tooltip = screen.getByRole("tooltip");
        expect(tooltip).toBeInTheDocument();
        expect(tooltip).toHaveTextContent(/confidence/i);
      });
    });

    it("tooltip explains high confidence", async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={{ ...mockAnalysis, confidence: "high" }}
          loading={false}
          error={null}
          onRetry={onRetry}
        />
      );

      const confidenceTrigger = screen.getByTestId("confidence-trigger");
      await user.hover(confidenceTrigger);

      await waitFor(() => {
        const tooltip = screen.getByRole("tooltip");
        expect(tooltip).toHaveTextContent(/certain|accurate/i);
      });
    });

    it("tooltip explains low confidence", async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={{ ...mockAnalysis, confidence: "low" }}
          loading={false}
          error={null}
          onRetry={onRetry}
        />
      );

      const confidenceTrigger = screen.getByTestId("confidence-trigger");
      await user.hover(confidenceTrigger);

      await waitFor(() => {
        const tooltip = screen.getByRole("tooltip");
        expect(tooltip).toHaveTextContent(/uncertain|verify/i);
      });
    });
  });

  describe("aria-live regions", () => {
    it("loading state has aria-live='assertive'", () => {
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={null}
          loading={true}
          error={null}
          onRetry={onRetry}
        />
      );

      const loadingContainer = screen.getByTestId("loading-spinner").closest("[aria-live]");
      expect(loadingContainer).toHaveAttribute("aria-live", "assertive");
    });

    it("error state has aria-live='polite'", () => {
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={null}
          loading={false}
          error="Test error"
          onRetry={onRetry}
        />
      );

      const errorContainer = screen.getByText("Test error").closest("[aria-live]");
      expect(errorContainer).toHaveAttribute("aria-live", "polite");
    });

    it("result state has aria-live='polite'", () => {
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={mockAnalysis}
          loading={false}
          error={null}
          onRetry={onRetry}
        />
      );

      const resultContainer = screen.getByText("Empanada de carne").closest("[aria-live]");
      expect(resultContainer).toHaveAttribute("aria-live", "polite");
    });
  });

  describe("accessible confidence indicator", () => {
    it("shows CheckCircle icon for high confidence", () => {
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={{ ...mockAnalysis, confidence: "high" }}
          loading={false}
          error={null}
          onRetry={onRetry}
        />
      );

      expect(screen.getByTestId("confidence-icon-check")).toBeInTheDocument();
    });

    it("shows AlertTriangle icon for medium confidence", () => {
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={{ ...mockAnalysis, confidence: "medium" }}
          loading={false}
          error={null}
          onRetry={onRetry}
        />
      );

      expect(screen.getByTestId("confidence-icon-alert")).toBeInTheDocument();
    });

    it("shows AlertTriangle icon for low confidence", () => {
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={{ ...mockAnalysis, confidence: "low" }}
          loading={false}
          error={null}
          onRetry={onRetry}
        />
      );

      expect(screen.getByTestId("confidence-icon-alert")).toBeInTheDocument();
    });

    it("still shows text label alongside icon", () => {
      const onRetry = vi.fn();
      render(
        <AnalysisResult
          analysis={{ ...mockAnalysis, confidence: "high" }}
          loading={false}
          error={null}
          onRetry={onRetry}
        />
      );

      expect(screen.getByText(/high/i)).toBeInTheDocument();
    });
  });
});
