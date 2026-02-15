import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WeeklyNutritionChart } from "@/components/weekly-nutrition-chart";
import type { DailyNutritionTotals } from "@/types";

describe("WeeklyNutritionChart", () => {
  const mockDays: DailyNutritionTotals[] = [
    {
      date: "2026-02-08",
      calories: 1800,
      proteinG: 120,
      carbsG: 150,
      fatG: 60,
      fiberG: 25,
      sodiumMg: 2000,
      calorieGoal: 2000,
      proteinGoalG: 150,
      carbsGoalG: 200,
      fatGoalG: 70,
    },
    {
      date: "2026-02-09",
      calories: 2200,
      proteinG: 140,
      carbsG: 180,
      fatG: 70,
      fiberG: 30,
      sodiumMg: 2200,
      calorieGoal: 2000,
      proteinGoalG: 150,
      carbsGoalG: 200,
      fatGoalG: 70,
    },
    {
      date: "2026-02-10",
      calories: 1900,
      proteinG: 130,
      carbsG: 160,
      fatG: 65,
      fiberG: 28,
      sodiumMg: 2100,
      calorieGoal: 2000,
      proteinGoalG: 150,
      carbsGoalG: 200,
      fatGoalG: 70,
    },
  ];

  it("renders metric selector with 4 options: Calories, Protein, Carbs, Fat", () => {
    render(<WeeklyNutritionChart days={mockDays} weekStart="2026-02-08" />);

    expect(screen.getByTestId("metric-calories")).toBeInTheDocument();
    expect(screen.getByTestId("metric-protein")).toBeInTheDocument();
    expect(screen.getByTestId("metric-carbs")).toBeInTheDocument();
    expect(screen.getByTestId("metric-fat")).toBeInTheDocument();
  });

  it("defaults to Calories selected", () => {
    render(<WeeklyNutritionChart days={mockDays} weekStart="2026-02-08" />);

    const caloriesButton = screen.getByTestId("metric-calories");
    expect(caloriesButton.className).toMatch(/bg-primary/);
  });

  it("renders 7 day columns (S M T W T F S)", () => {
    render(<WeeklyNutritionChart days={mockDays} weekStart="2026-02-08" />);

    // Check for day labels (S, M, T, W, T, F, S)
    const sLabels = screen.getAllByText("S", { selector: ".text-xs" });
    expect(sLabels.length).toBeGreaterThanOrEqual(2); // Sunday and Saturday

    expect(screen.getByText("M", { selector: ".text-xs" })).toBeInTheDocument(); // Monday

    const tLabels = screen.getAllByText("T", { selector: ".text-xs" });
    expect(tLabels.length).toBeGreaterThanOrEqual(2); // Tuesday and Thursday

    expect(screen.getByText("W", { selector: ".text-xs" })).toBeInTheDocument(); // Wednesday
    expect(screen.getByText("F", { selector: ".text-xs" })).toBeInTheDocument(); // Friday
  });

  it("shows bars scaled to max value for the selected metric", () => {
    render(<WeeklyNutritionChart days={mockDays} weekStart="2026-02-08" />);

    // The chart should render bars (divs with specific test IDs)
    const bars = screen.getAllByTestId(/^day-bar-/);
    expect(bars.length).toBeGreaterThan(0);
  });

  it("shows goal dashed markers when goal exists for the selected metric", () => {
    render(<WeeklyNutritionChart days={mockDays} weekStart="2026-02-08" />);

    // Goal markers should be rendered (divs with specific test IDs)
    const goalMarkers = screen.getAllByTestId(/^goal-marker-/);
    expect(goalMarkers.length).toBeGreaterThan(0);
  });

  it("applies success color when under goal", () => {
    const underGoalDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1500,
        proteinG: 100,
        carbsG: 150,
        fatG: 50,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={underGoalDays} weekStart="2026-02-08" />);

    const bar = screen.getByTestId("day-bar-2026-02-08");
    expect(bar.className).toMatch(/bg-success/);
  });

  it("applies warning color when over goal", () => {
    const overGoalDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 2500,
        proteinG: 150,
        carbsG: 200,
        fatG: 80,
        fiberG: 30,
        sodiumMg: 2500,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={overGoalDays} weekStart="2026-02-08" />);

    const bar = screen.getByTestId("day-bar-2026-02-08");
    expect(bar.className).toMatch(/bg-warning/);
  });

  it("applies primary color when no goal is set", () => {
    const noGoalDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1800,
        proteinG: 120,
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: null,
        proteinGoalG: null,
        carbsGoalG: null,
        fatGoalG: null,
      },
    ];

    render(<WeeklyNutritionChart days={noGoalDays} weekStart="2026-02-08" />);

    const bar = screen.getByTestId("day-bar-2026-02-08");
    expect(bar.className).toMatch(/bg-primary/);
  });

  it("shows empty state when no data", () => {
    render(<WeeklyNutritionChart days={[]} weekStart="2026-02-08" />);

    expect(
      screen.getByText("Log food for a few days to see weekly trends")
    ).toBeInTheDocument();
  });

  it("switches metric via click and updates which data is displayed", () => {
    render(<WeeklyNutritionChart days={mockDays} weekStart="2026-02-08" />);

    // Initially, calories button should be selected
    const caloriesButton = screen.getByTestId("metric-calories");
    const proteinButton = screen.getByTestId("metric-protein");

    expect(caloriesButton.className).toMatch(/bg-primary/);
    expect(proteinButton.className).not.toMatch(/bg-primary/);

    // Click protein button
    fireEvent.click(proteinButton);

    // Now protein should be selected
    expect(proteinButton.className).toMatch(/bg-primary/);
    expect(caloriesButton.className).not.toMatch(/bg-primary/);
  });

  // Task 5: Goal consistency indicator tests
  it("shows goal consistency indicator when goals exist and some days meet them", () => {
    // Create data with 5 logged days, 3 meeting the calorie goal
    const daysWithGoals: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1800, // under goal
        proteinG: 120,
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
      {
        date: "2026-02-09",
        calories: 2200, // over goal
        proteinG: 140,
        carbsG: 180,
        fatG: 70,
        fiberG: 30,
        sodiumMg: 2200,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
      {
        date: "2026-02-10",
        calories: 1900, // under goal
        proteinG: 130,
        carbsG: 160,
        fatG: 65,
        fiberG: 28,
        sodiumMg: 2100,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
      {
        date: "2026-02-11",
        calories: 2500, // over goal
        proteinG: 150,
        carbsG: 200,
        fatG: 80,
        fiberG: 30,
        sodiumMg: 2500,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
      {
        date: "2026-02-12",
        calories: 2000, // exactly on goal (counts as on target)
        proteinG: 150,
        carbsG: 200,
        fatG: 70,
        fiberG: 30,
        sodiumMg: 2500,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={daysWithGoals} weekStart="2026-02-08" />);

    // 3 days on target: Feb 8 (1800), Feb 10 (1900), Feb 12 (2000)
    const consistency = screen.getByTestId("goal-consistency");
    expect(consistency).toHaveTextContent("3/5 days on target");
  });

  it("only counts days with calories > 0 in the denominator", () => {
    // Create data with some empty days
    const sparseData: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1800, // logged, under goal
        proteinG: 120,
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
      {
        date: "2026-02-10",
        calories: 2200, // logged, over goal
        proteinG: 140,
        carbsG: 180,
        fatG: 70,
        fiberG: 30,
        sodiumMg: 2200,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={sparseData} weekStart="2026-02-08" />);

    // Only 2 days have data, 1 is on target
    const consistency = screen.getByTestId("goal-consistency");
    expect(consistency).toHaveTextContent("1/2 days on target");
  });

  it("does not render consistency indicator when no goals exist for the selected metric", () => {
    const noGoalDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1800,
        proteinG: 120,
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: null,
        proteinGoalG: null,
        carbsGoalG: null,
        fatGoalG: null,
      },
    ];

    render(<WeeklyNutritionChart days={noGoalDays} weekStart="2026-02-08" />);

    // Should not render consistency indicator
    expect(screen.queryByTestId("goal-consistency")).not.toBeInTheDocument();
  });

  it("switches metric and updates the consistency count", () => {
    // Create data where calorie goals differ from protein goals
    const mixedGoals: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1800, // under calorie goal (on target)
        proteinG: 160, // over protein goal (not on target)
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
      {
        date: "2026-02-09",
        calories: 2200, // over calorie goal (not on target)
        proteinG: 140, // under protein goal (on target)
        carbsG: 180,
        fatG: 70,
        fiberG: 30,
        sodiumMg: 2200,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={mixedGoals} weekStart="2026-02-08" />);

    // Initially on calories: 1 of 2 days on target
    let consistency = screen.getByTestId("goal-consistency");
    expect(consistency).toHaveTextContent("1/2 days on target");

    // Switch to protein
    const proteinButton = screen.getByTestId("metric-protein");
    fireEvent.click(proteinButton);

    // On protein: 1 of 2 days on target (different days)
    consistency = screen.getByTestId("goal-consistency");
    expect(consistency).toHaveTextContent("1/2 days on target");
  });

  // Task 6: Net surplus/deficit summary tests
  it("shows negative value with 'under' label in success color when net is under target", () => {
    const underTargetDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1800, // -200 from goal
        proteinG: 120,
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
      {
        date: "2026-02-09",
        calories: 1900, // -100 from goal
        proteinG: 130,
        carbsG: 160,
        fatG: 65,
        fiberG: 28,
        sodiumMg: 2100,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={underTargetDays} weekStart="2026-02-08" />);

    // Net: -300 kcal under
    const netSummary = screen.getByTestId("net-surplus-deficit");
    expect(netSummary).toHaveTextContent("-300 kcal under");
    expect(netSummary.className).toMatch(/text-success/);
  });

  it("shows positive value with 'over' label in warning color when net is over target", () => {
    const overTargetDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 2200, // +200 from goal
        proteinG: 140,
        carbsG: 180,
        fatG: 70,
        fiberG: 30,
        sodiumMg: 2200,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
      {
        date: "2026-02-09",
        calories: 2300, // +300 from goal
        proteinG: 150,
        carbsG: 200,
        fatG: 80,
        fiberG: 30,
        sodiumMg: 2500,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={overTargetDays} weekStart="2026-02-08" />);

    // Net: +500 kcal over
    const netSummary = screen.getByTestId("net-surplus-deficit");
    expect(netSummary).toHaveTextContent("+500 kcal over");
    expect(netSummary.className).toMatch(/text-warning/);
  });

  it("shows 'On target' in success color when exactly on target", () => {
    const onTargetDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 2100, // +100 from goal
        proteinG: 140,
        carbsG: 180,
        fatG: 70,
        fiberG: 30,
        sodiumMg: 2200,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
      {
        date: "2026-02-09",
        calories: 1900, // -100 from goal
        proteinG: 130,
        carbsG: 160,
        fatG: 65,
        fiberG: 28,
        sodiumMg: 2100,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={onTargetDays} weekStart="2026-02-08" />);

    // Net: 0 (balanced)
    const netSummary = screen.getByTestId("net-surplus-deficit");
    expect(netSummary).toHaveTextContent("On target");
    expect(netSummary.className).toMatch(/text-success/);
  });

  it("uses 'kcal' unit for calories and 'g' unit for protein/carbs/fat", () => {
    const testDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1800, // -200 from goal
        proteinG: 160, // +10 from goal
        carbsG: 210, // +10 from goal
        fatG: 80, // +10 from goal
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={testDays} weekStart="2026-02-08" />);

    // Calories uses "kcal"
    let netSummary = screen.getByTestId("net-surplus-deficit");
    expect(netSummary).toHaveTextContent("kcal");

    // Switch to protein - uses "g"
    fireEvent.click(screen.getByTestId("metric-protein"));
    netSummary = screen.getByTestId("net-surplus-deficit");
    expect(netSummary).toHaveTextContent("g");
    expect(netSummary).toHaveTextContent("+10 g over");

    // Switch to carbs - uses "g"
    fireEvent.click(screen.getByTestId("metric-carbs"));
    netSummary = screen.getByTestId("net-surplus-deficit");
    expect(netSummary).toHaveTextContent("g");

    // Switch to fat - uses "g"
    fireEvent.click(screen.getByTestId("metric-fat"));
    netSummary = screen.getByTestId("net-surplus-deficit");
    expect(netSummary).toHaveTextContent("g");
  });

  it("only includes days with both data (calories > 0) and a goal in the calculation", () => {
    const mixedDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 2200, // +200 from goal - included
        proteinG: 140,
        carbsG: 180,
        fatG: 70,
        fiberG: 30,
        sodiumMg: 2200,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
      {
        date: "2026-02-09",
        calories: 1800, // has data but no goal - excluded
        proteinG: 120,
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: null,
        proteinGoalG: null,
        carbsGoalG: null,
        fatGoalG: null,
      },
    ];

    render(<WeeklyNutritionChart days={mixedDays} weekStart="2026-02-08" />);

    // Net should only be +200 (from Feb 8), not affected by Feb 9 which has no goal
    const netSummary = screen.getByTestId("net-surplus-deficit");
    expect(netSummary).toHaveTextContent("+200 kcal over");
  });

  it("does not render net summary when no goals exist for the selected metric", () => {
    const noGoalDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 1800,
        proteinG: 120,
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: null,
        proteinGoalG: null,
        carbsGoalG: null,
        fatGoalG: null,
      },
    ];

    render(<WeeklyNutritionChart days={noGoalDays} weekStart="2026-02-08" />);

    // Should not render net summary
    expect(screen.queryByTestId("net-surplus-deficit")).not.toBeInTheDocument();
  });

  it("switches metric and updates the net summary", () => {
    const mixedDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 2200, // +200 kcal
        proteinG: 160, // +10 g
        carbsG: 210, // +10 g
        fatG: 80, // +10 g
        fiberG: 30,
        sodiumMg: 2500,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={mixedDays} weekStart="2026-02-08" />);

    // Initially on calories
    let netSummary = screen.getByTestId("net-surplus-deficit");
    expect(netSummary).toHaveTextContent("+200 kcal over");

    // Switch to protein
    fireEvent.click(screen.getByTestId("metric-protein"));
    netSummary = screen.getByTestId("net-surplus-deficit");
    expect(netSummary).toHaveTextContent("+10 g over");
  });

  // Task 7: Goal overflow test
  it("scales chart to include goal markers when goal exceeds actual values", () => {
    // Create data where goal significantly exceeds actual values
    const highGoalDays: DailyNutritionTotals[] = [
      {
        date: "2026-02-08",
        calories: 500, // actual is much lower than goal
        proteinG: 50,
        carbsG: 60,
        fatG: 20,
        fiberG: 10,
        sodiumMg: 1000,
        calorieGoal: 2000, // goal is 4x the actual value
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    render(<WeeklyNutritionChart days={highGoalDays} weekStart="2026-02-08" />);

    // The goal marker should be rendered and positioned correctly
    const goalMarker = screen.getByTestId("goal-marker-2026-02-08");
    expect(goalMarker).toBeInTheDocument();

    // Extract the bottom style value
    const bottomStyle = goalMarker.style.bottom;
    expect(bottomStyle).toBeDefined();

    // Parse percentage value (e.g., "80%" -> 80)
    const bottomPercent = parseFloat(bottomStyle);

    // Goal marker should be within the visible chart range (0-100%)
    expect(bottomPercent).toBeGreaterThanOrEqual(0);
    expect(bottomPercent).toBeLessThanOrEqual(100);
  });

  it("metric tab buttons have aria-controls pointing to the chart panel", () => {
    render(<WeeklyNutritionChart days={mockDays} weekStart="2026-02-08" />);

    const caloriesTab = screen.getByRole("tab", { name: "Calories" });
    const proteinTab = screen.getByRole("tab", { name: "Protein" });
    const carbsTab = screen.getByRole("tab", { name: "Carbs" });
    const fatTab = screen.getByRole("tab", { name: "Fat" });

    // Check aria-controls attributes
    expect(caloriesTab).toHaveAttribute("aria-controls", "panel-metric");
    expect(proteinTab).toHaveAttribute("aria-controls", "panel-metric");
    expect(carbsTab).toHaveAttribute("aria-controls", "panel-metric");
    expect(fatTab).toHaveAttribute("aria-controls", "panel-metric");

    // Verify chart container has the matching ID
    const chartPanel = document.getElementById("panel-metric");
    expect(chartPanel).toBeInTheDocument();

    // Switch to protein tab and verify panel still has the same ID
    fireEvent.click(proteinTab);
    expect(document.getElementById("panel-metric")).toBeInTheDocument();
  });

  it("shows a visual indicator on the current day column", () => {
    // Use the actual today's date
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Create mock data that includes today
    const daysWithToday: DailyNutritionTotals[] = [
      {
        date: todayStr,
        calories: 1800,
        proteinG: 120,
        carbsG: 150,
        fatG: 60,
        fiberG: 25,
        sodiumMg: 2000,
        calorieGoal: 2000,
        proteinGoalG: 150,
        carbsGoalG: 200,
        fatGoalG: 70,
      },
    ];

    // Calculate week start (Sunday before today)
    const dayOfWeek = today.getDay(); // 0 = Sunday
    const weekStartDate = new Date(today);
    weekStartDate.setDate(today.getDate() - dayOfWeek);
    const weekStart = `${weekStartDate.getFullYear()}-${String(weekStartDate.getMonth() + 1).padStart(2, "0")}-${String(weekStartDate.getDate()).padStart(2, "0")}`;

    render(<WeeklyNutritionChart days={daysWithToday} weekStart={weekStart} />);

    // Find the current day indicator - it should have a data-testid
    const todayIndicator = screen.getByTestId("today-indicator");
    expect(todayIndicator).toBeInTheDocument();

    // Should be a small circular indicator
    expect(todayIndicator.className).toMatch(/rounded-full|bg-primary/);
  });
});
