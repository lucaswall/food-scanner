import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnalysisResult } from "../analysis-result";
import type { FoodAnalysis } from "@/types";

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
});
