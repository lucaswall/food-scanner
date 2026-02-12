import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WeeklyFastingChart } from "../weekly-fasting-chart";
import type { FastingWindow } from "@/types";

afterEach(() => {
  cleanup();
});

describe("WeeklyFastingChart", () => {
  it("renders 7 day slots from Sunday to Saturday", () => {
    const windows: FastingWindow[] = [];
    render(<WeeklyFastingChart windows={windows} weekStart="2026-02-09" />);

    // Should show all 7 day labels (Sun–Sat)
    expect(screen.getByText("Sun")).toBeInTheDocument();
    expect(screen.getByText("Mon")).toBeInTheDocument();
    expect(screen.getByText("Tue")).toBeInTheDocument();
    expect(screen.getByText("Wed")).toBeInTheDocument();
    expect(screen.getByText("Thu")).toBeInTheDocument();
    expect(screen.getByText("Fri")).toBeInTheDocument();
    expect(screen.getByText("Sat")).toBeInTheDocument();
  });

  it("shows '—' for days with no fasting data", () => {
    const windows: FastingWindow[] = [];
    const { container } = render(<WeeklyFastingChart windows={windows} weekStart="2026-02-09" />);

    // All 7 slots should show em dash
    const emDashes = container.querySelectorAll('[data-testid^="fasting-duration-"]');
    expect(emDashes).toHaveLength(7);
    emDashes.forEach((el) => {
      expect(el.textContent).toBe("—");
    });
  });

  it("displays fasting durations for days with data", () => {
    const windows: FastingWindow[] = [
      {
        date: "2026-02-09", // Sunday
        lastMealTime: "20:00:00",
        firstMealTime: "10:00:00",
        durationMinutes: 840, // 14h 0m
      },
      {
        date: "2026-02-11", // Tuesday
        lastMealTime: "21:00:00",
        firstMealTime: "09:00:00",
        durationMinutes: 720, // 12h 0m
      },
    ];

    render(<WeeklyFastingChart windows={windows} weekStart="2026-02-09" />);

    // Sunday: 14h 0m
    expect(screen.getByTestId("fasting-duration-2026-02-09")).toHaveTextContent("14h 0m");

    // Monday: no data
    expect(screen.getByTestId("fasting-duration-2026-02-10")).toHaveTextContent("—");

    // Tuesday: 12h 0m
    expect(screen.getByTestId("fasting-duration-2026-02-11")).toHaveTextContent("12h 0m");
  });

  it("formats whole hours without minutes suffix", () => {
    const windows: FastingWindow[] = [
      {
        date: "2026-02-09",
        lastMealTime: "20:00:00",
        firstMealTime: "08:00:00",
        durationMinutes: 720, // 12h 0m
      },
    ];

    render(<WeeklyFastingChart windows={windows} weekStart="2026-02-09" />);

    expect(screen.getByTestId("fasting-duration-2026-02-09")).toHaveTextContent("12h 0m");
  });

  it("formats hours and minutes correctly", () => {
    const windows: FastingWindow[] = [
      {
        date: "2026-02-09",
        lastMealTime: "20:30:00",
        firstMealTime: "10:15:00",
        durationMinutes: 825, // 13h 45m
      },
    ];

    render(<WeeklyFastingChart windows={windows} weekStart="2026-02-09" />);

    expect(screen.getByTestId("fasting-duration-2026-02-09")).toHaveTextContent("13h 45m");
  });

  it("shows '—' for ongoing fasts (null durationMinutes)", () => {
    const windows: FastingWindow[] = [
      {
        date: "2026-02-09",
        lastMealTime: "20:00:00",
        firstMealTime: null,
        durationMinutes: null,
      },
    ];

    render(<WeeklyFastingChart windows={windows} weekStart="2026-02-09" />);

    expect(screen.getByTestId("fasting-duration-2026-02-09")).toHaveTextContent("—");
  });

  it("matches windows to correct day-of-week slot", () => {
    // Week starting Sunday 2026-02-09 (Sun, Mon, Tue, Wed, Thu, Fri, Sat)
    const windows: FastingWindow[] = [
      {
        date: "2026-02-09", // Sunday
        lastMealTime: "20:00:00",
        firstMealTime: "10:00:00",
        durationMinutes: 840,
      },
      {
        date: "2026-02-13", // Thursday
        lastMealTime: "21:00:00",
        firstMealTime: "09:00:00",
        durationMinutes: 720,
      },
      {
        date: "2026-02-15", // Saturday
        lastMealTime: "22:00:00",
        firstMealTime: "08:00:00",
        durationMinutes: 600,
      },
    ];

    render(<WeeklyFastingChart windows={windows} weekStart="2026-02-09" />);

    // Sunday (2026-02-09)
    expect(screen.getByTestId("fasting-duration-2026-02-09")).toHaveTextContent("14h 0m");

    // Monday (2026-02-10) - no data
    expect(screen.getByTestId("fasting-duration-2026-02-10")).toHaveTextContent("—");

    // Tuesday (2026-02-11) - no data
    expect(screen.getByTestId("fasting-duration-2026-02-11")).toHaveTextContent("—");

    // Wednesday (2026-02-12) - no data
    expect(screen.getByTestId("fasting-duration-2026-02-12")).toHaveTextContent("—");

    // Thursday (2026-02-13)
    expect(screen.getByTestId("fasting-duration-2026-02-13")).toHaveTextContent("12h 0m");

    // Friday (2026-02-14) - no data
    expect(screen.getByTestId("fasting-duration-2026-02-14")).toHaveTextContent("—");

    // Saturday (2026-02-15)
    expect(screen.getByTestId("fasting-duration-2026-02-15")).toHaveTextContent("10h 0m");
  });

  it("handles weeks starting on different days", () => {
    // Week starting Monday 2026-02-10
    const windows: FastingWindow[] = [
      {
        date: "2026-02-10", // Monday (but this is the first day, which is Sunday slot)
        lastMealTime: "20:00:00",
        firstMealTime: "10:00:00",
        durationMinutes: 840,
      },
    ];

    render(<WeeklyFastingChart windows={windows} weekStart="2026-02-10" />);

    // First slot (Sunday) should have the data for 2026-02-10
    expect(screen.getByTestId("fasting-duration-2026-02-10")).toHaveTextContent("14h 0m");
  });

  it("correctly handles full week of data", () => {
    const windows: FastingWindow[] = [
      { date: "2026-02-09", lastMealTime: "20:00:00", firstMealTime: "10:00:00", durationMinutes: 840 },
      { date: "2026-02-10", lastMealTime: "21:00:00", firstMealTime: "09:00:00", durationMinutes: 720 },
      { date: "2026-02-11", lastMealTime: "22:00:00", firstMealTime: "08:00:00", durationMinutes: 600 },
      { date: "2026-02-12", lastMealTime: "20:30:00", firstMealTime: "10:30:00", durationMinutes: 840 },
      { date: "2026-02-13", lastMealTime: "21:30:00", firstMealTime: "09:30:00", durationMinutes: 720 },
      { date: "2026-02-14", lastMealTime: "22:30:00", firstMealTime: "08:30:00", durationMinutes: 600 },
      { date: "2026-02-15", lastMealTime: "20:15:00", firstMealTime: "10:15:00", durationMinutes: 840 },
    ];

    render(<WeeklyFastingChart windows={windows} weekStart="2026-02-09" />);

    // All 7 days should have durations
    expect(screen.getByTestId("fasting-duration-2026-02-09")).toHaveTextContent("14h 0m");
    expect(screen.getByTestId("fasting-duration-2026-02-10")).toHaveTextContent("12h 0m");
    expect(screen.getByTestId("fasting-duration-2026-02-11")).toHaveTextContent("10h 0m");
    expect(screen.getByTestId("fasting-duration-2026-02-12")).toHaveTextContent("14h 0m");
    expect(screen.getByTestId("fasting-duration-2026-02-13")).toHaveTextContent("12h 0m");
    expect(screen.getByTestId("fasting-duration-2026-02-14")).toHaveTextContent("10h 0m");
    expect(screen.getByTestId("fasting-duration-2026-02-15")).toHaveTextContent("14h 0m");
  });
});
