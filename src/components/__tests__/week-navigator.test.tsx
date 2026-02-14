import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekNavigator } from "@/components/week-navigator";

vi.mock("@/lib/date-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date-utils")>();
  return {
    ...actual,
    getTodayDate: () => "2026-02-12", // Wednesday
    getWeekBounds: (date: string) => {
      // Feb 12, 2026 is in the week of Feb 8-14
      if (date === "2026-02-12") {
        return { start: "2026-02-08", end: "2026-02-14" };
      }
      // Feb 1, 2026 is in the week of Feb 1-7
      if (date === "2026-02-01") {
        return { start: "2026-02-01", end: "2026-02-07" };
      }
      // Default fallback
      const d = new Date(date + "T00:00:00Z");
      const dayOfWeek = d.getUTCDay();
      const startDate = new Date(d);
      startDate.setUTCDate(d.getUTCDate() - dayOfWeek);
      const endDate = new Date(d);
      endDate.setUTCDate(d.getUTCDate() + (6 - dayOfWeek));
      return {
        start: startDate.toISOString().slice(0, 10),
        end: endDate.toISOString().slice(0, 10),
      };
    },
    formatWeekRange: (start: string, end: string) => {
      if (start === "2026-02-08" && end === "2026-02-14") return "Feb 8 – 14";
      if (start === "2026-02-01" && end === "2026-02-07") return "Feb 1 – 7";
      if (start === "2026-02-15" && end === "2026-02-21") return "Feb 15 – 21";
      if (start === "2026-01-25" && end === "2026-01-31") return "Jan 25 – 31";
      return `${start} – ${end}`;
    },
    addWeeks: (date: string, weeks: number) => {
      const d = new Date(date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + weeks * 7);
      return d.toISOString().slice(0, 10);
    },
  };
});

describe("WeekNavigator", () => {
  it("renders the week range label using formatWeekRange", () => {
    render(
      <WeekNavigator
        weekStart="2026-02-08"
        onWeekChange={() => {}}
      />
    );

    expect(screen.getByText("Feb 8 – 14", { selector: ".font-medium" })).toBeInTheDocument();
  });

  it("calls onWeekChange with previous week start when left arrow clicked", async () => {
    const user = userEvent.setup();
    const onWeekChange = vi.fn();

    render(
      <WeekNavigator
        weekStart="2026-02-08"
        onWeekChange={onWeekChange}
        earliestDate="2026-01-01"
      />
    );

    const leftArrow = screen.getByLabelText("Previous week");
    await user.click(leftArrow);

    expect(onWeekChange).toHaveBeenCalledWith("2026-02-01");
  });

  it("disables left arrow when earliestDate is null", () => {
    render(
      <WeekNavigator
        weekStart="2026-02-08"
        onWeekChange={() => {}}
      />
    );

    const leftArrow = screen.getByLabelText("Previous week");
    expect(leftArrow).toBeDisabled();
  });

  it("disables left arrow when current week contains earliestDate", () => {
    render(
      <WeekNavigator
        weekStart="2026-02-08"
        onWeekChange={() => {}}
        earliestDate="2026-02-10"
      />
    );

    const leftArrow = screen.getByLabelText("Previous week");
    expect(leftArrow).toBeDisabled();
  });

  it("enables left arrow when earliestDate is before current week", () => {
    render(
      <WeekNavigator
        weekStart="2026-02-08"
        onWeekChange={() => {}}
        earliestDate="2026-01-15"
      />
    );

    const leftArrow = screen.getByLabelText("Previous week");
    expect(leftArrow).not.toBeDisabled();
  });

  it("calls onWeekChange with next week start when right arrow clicked", async () => {
    const user = userEvent.setup();
    const onWeekChange = vi.fn();

    render(
      <WeekNavigator
        weekStart="2026-02-01"
        onWeekChange={onWeekChange}
      />
    );

    const rightArrow = screen.getByLabelText("Next week");
    await user.click(rightArrow);

    expect(onWeekChange).toHaveBeenCalledWith("2026-02-08");
  });

  it("disables right arrow when weekStart is the current week", () => {
    // Current week is Feb 8-14, 2026 (today is Feb 12)
    render(
      <WeekNavigator
        weekStart="2026-02-08"
        onWeekChange={() => {}}
      />
    );

    const rightArrow = screen.getByLabelText("Next week");
    expect(rightArrow).toBeDisabled();
  });

  it("enables right arrow when weekStart is a past week", () => {
    // Feb 1-7, 2026 is before the current week (Feb 8-14)
    render(
      <WeekNavigator
        weekStart="2026-02-01"
        onWeekChange={() => {}}
      />
    );

    const rightArrow = screen.getByLabelText("Next week");
    expect(rightArrow).not.toBeDisabled();
  });

  it("has touch targets at least 44x44px for mobile", () => {
    render(
      <WeekNavigator
        weekStart="2026-02-08"
        onWeekChange={() => {}}
      />
    );

    const leftArrow = screen.getByLabelText("Previous week");
    const rightArrow = screen.getByLabelText("Next week");

    expect(leftArrow.className).toMatch(/min-(h|w)-\[44px\]/);
    expect(rightArrow.className).toMatch(/min-(h|w)-\[44px\]/);
  });
});
