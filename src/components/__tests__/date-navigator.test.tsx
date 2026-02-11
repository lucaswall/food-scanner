import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateNavigator } from "@/components/date-navigator";

vi.mock("@/lib/date-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/date-utils")>();
  return {
    ...actual,
    getTodayDate: () => "2026-02-10",
    formatDisplayDate: (date: string) => {
      if (date === "2026-02-10") return "Today";
      if (date === "2026-02-09") return "Yesterday";
      return "Mon, Feb 8";
    },
    addDays: (date: string, days: number) => {
      const d = new Date(date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    },
  };
});

describe("DateNavigator", () => {
  it("renders the current date label using formatDisplayDate", () => {
    render(
      <DateNavigator
        selectedDate="2026-02-10"
        onDateChange={() => {}}
        earliestDate="2026-01-01"
      />
    );

    // Check for the main date label (font-medium class)
    expect(screen.getByText("Today", { selector: ".font-medium" })).toBeInTheDocument();
  });

  it("calls onDateChange with previous day when left arrow clicked", async () => {
    const user = userEvent.setup();
    const onDateChange = vi.fn();

    render(
      <DateNavigator
        selectedDate="2026-02-10"
        onDateChange={onDateChange}
        earliestDate="2026-01-01"
      />
    );

    const leftArrow = screen.getByLabelText("Previous day");
    await user.click(leftArrow);

    expect(onDateChange).toHaveBeenCalledWith("2026-02-09");
  });

  it("calls onDateChange with next day when right arrow clicked", async () => {
    const user = userEvent.setup();
    const onDateChange = vi.fn();

    render(
      <DateNavigator
        selectedDate="2026-02-09"
        onDateChange={onDateChange}
        earliestDate="2026-01-01"
      />
    );

    const rightArrow = screen.getByLabelText("Next day");
    await user.click(rightArrow);

    expect(onDateChange).toHaveBeenCalledWith("2026-02-10");
  });

  it("disables right arrow when selectedDate equals today", () => {
    render(
      <DateNavigator
        selectedDate="2026-02-10"
        onDateChange={() => {}}
        earliestDate="2026-01-01"
      />
    );

    const rightArrow = screen.getByLabelText("Next day");
    expect(rightArrow).toBeDisabled();
  });

  it("disables left arrow when selectedDate equals earliestDate", () => {
    render(
      <DateNavigator
        selectedDate="2026-01-01"
        onDateChange={() => {}}
        earliestDate="2026-01-01"
      />
    );

    const leftArrow = screen.getByLabelText("Previous day");
    expect(leftArrow).toBeDisabled();
  });

  it("disables left arrow when earliestDate is null", () => {
    render(
      <DateNavigator
        selectedDate="2026-02-08"
        onDateChange={() => {}}
        earliestDate={null}
      />
    );

    const leftArrow = screen.getByLabelText("Previous day");
    expect(leftArrow).toBeDisabled();
  });

  it("shows 'Today' label when viewing today via formatDisplayDate", () => {
    render(
      <DateNavigator
        selectedDate="2026-02-10"
        onDateChange={() => {}}
        earliestDate="2026-01-01"
      />
    );

    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("shows date label (not 'Today') when viewing a past date", () => {
    render(
      <DateNavigator
        selectedDate="2026-02-09"
        onDateChange={() => {}}
        earliestDate="2026-01-01"
      />
    );

    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
  });

  it("shows skeleton placeholder when isLoading is true", () => {
    render(
      <DateNavigator
        selectedDate="2026-02-10"
        onDateChange={() => {}}
        earliestDate="2026-01-01"
        isLoading={true}
      />
    );

    expect(screen.getByTestId("date-label-skeleton")).toBeInTheDocument();
  });

  it("has touch targets at least 44x44px for mobile", () => {
    render(
      <DateNavigator
        selectedDate="2026-02-10"
        onDateChange={() => {}}
        earliestDate="2026-01-01"
      />
    );

    const leftArrow = screen.getByLabelText("Previous day");
    const rightArrow = screen.getByLabelText("Next day");

    // Check that buttons have minimum touch target size via CSS classes or computed style
    expect(leftArrow.className).toMatch(/min-(h|w)-\[44px\]/);
    expect(rightArrow.className).toMatch(/min-(h|w)-\[44px\]/);
  });
});
