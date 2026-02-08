import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardPreview } from "../dashboard-preview";

describe("DashboardPreview", () => {
  it("renders 'Coming Soon' text", () => {
    render(<DashboardPreview />);
    expect(screen.getByText("Coming Soon")).toBeInTheDocument();
  });

  it("renders a calorie ring mockup element", () => {
    render(<DashboardPreview />);
    expect(screen.getByTestId("calorie-ring")).toBeInTheDocument();
  });

  it("renders macro progress bar mockup elements", () => {
    render(<DashboardPreview />);
    expect(screen.getByText("Protein")).toBeInTheDocument();
    expect(screen.getByText("Carbs")).toBeInTheDocument();
    expect(screen.getByText("Fat")).toBeInTheDocument();
  });

  it("has blur styling on the content container", () => {
    render(<DashboardPreview />);
    const calorieRing = screen.getByTestId("calorie-ring");
    // The parent of calorie-ring's parent should have blur class
    const blurContainer = calorieRing.closest(".blur-sm");
    expect(blurContainer).toBeInTheDocument();
  });
});
