import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DashboardShell } from "@/components/dashboard-shell";

// Mock the child components
vi.mock("@/components/daily-dashboard", () => ({
  DailyDashboard: () => <div data-testid="daily-dashboard">Daily Dashboard</div>,
}));

vi.mock("@/components/weekly-dashboard", () => ({
  WeeklyDashboard: () => <div data-testid="weekly-dashboard">Weekly Dashboard</div>,
}));

describe("DashboardShell", () => {
  it("renders segmented control with Daily and Weekly options", () => {
    render(<DashboardShell />);

    expect(screen.getByRole("button", { name: "Daily" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Weekly" })).toBeInTheDocument();
  });

  it("defaults to daily view", () => {
    render(<DashboardShell />);

    expect(screen.getByTestId("daily-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("weekly-dashboard")).not.toBeInTheDocument();
  });

  it("switches to weekly view when Weekly button is clicked", async () => {
    const user = userEvent.setup();
    render(<DashboardShell />);

    const weeklyButton = screen.getByRole("button", { name: "Weekly" });
    await user.click(weeklyButton);

    expect(screen.getByTestId("weekly-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("daily-dashboard")).not.toBeInTheDocument();
  });

  it("switches back to daily view when Daily button is clicked", async () => {
    const user = userEvent.setup();
    render(<DashboardShell />);

    // Switch to weekly
    const weeklyButton = screen.getByRole("button", { name: "Weekly" });
    await user.click(weeklyButton);

    // Switch back to daily
    const dailyButton = screen.getByRole("button", { name: "Daily" });
    await user.click(dailyButton);

    expect(screen.getByTestId("daily-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("weekly-dashboard")).not.toBeInTheDocument();
  });

  it("has minimum 44px height for touch targets on segmented control buttons", () => {
    render(<DashboardShell />);

    const dailyButton = screen.getByRole("button", { name: "Daily" });
    const weeklyButton = screen.getByRole("button", { name: "Weekly" });

    // Check for min-h-[44px] class or similar
    expect(dailyButton.className).toMatch(/min-h-\[44px\]/);
    expect(weeklyButton.className).toMatch(/min-h-\[44px\]/);
  });

  it("applies active styling to the selected view button", () => {
    render(<DashboardShell />);

    const dailyButton = screen.getByRole("button", { name: "Daily" });
    const weeklyButton = screen.getByRole("button", { name: "Weekly" });

    // Daily should be active (has bg-primary or similar)
    expect(dailyButton.className).toMatch(/bg-primary/);
    // Weekly should be inactive (has text-muted-foreground or similar)
    expect(weeklyButton.className).toMatch(/text-muted-foreground/);
  });

  it("tab buttons have aria-controls pointing to their respective panels", async () => {
    const user = userEvent.setup();
    render(<DashboardShell />);

    const dailyButton = screen.getByRole("button", { name: "Daily" });
    const weeklyButton = screen.getByRole("button", { name: "Weekly" });

    // Check aria-controls attributes
    expect(dailyButton).toHaveAttribute("aria-controls", "panel-daily");
    expect(weeklyButton).toHaveAttribute("aria-controls", "panel-weekly");

    // Verify panels have matching IDs
    const dailyPanel = document.getElementById("panel-daily");
    expect(dailyPanel).toBeInTheDocument();
    expect(dailyPanel).toContainElement(screen.getByTestId("daily-dashboard"));

    // Switch to weekly view
    await user.click(weeklyButton);

    const weeklyPanel = document.getElementById("panel-weekly");
    expect(weeklyPanel).toBeInTheDocument();
    expect(weeklyPanel).toContainElement(screen.getByTestId("weekly-dashboard"));
  });
});
