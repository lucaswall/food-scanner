import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LogDateHint } from "../log-date-hint";

describe("LogDateHint", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 14, 9, 30));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when date is null", () => {
    const { container } = render(<LogDateHint date={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when date is undefined", () => {
    const { container } = render(<LogDateHint date={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when date is today", () => {
    const { container } = render(<LogDateHint date="2026-09-14" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Yesterday for yesterday's date", () => {
    render(<LogDateHint date="2026-09-13" />);
    expect(screen.getByTestId("log-date-hint")).toHaveTextContent("Logging for Yesterday");
  });

  it("shows a formatted date for older dates", () => {
    render(<LogDateHint date="2026-09-10" />);
    expect(screen.getByTestId("log-date-hint")).toHaveTextContent("Logging for Thu, Sep 10");
  });

  it("shows future dates too", () => {
    render(<LogDateHint date="2026-09-15" />);
    expect(screen.getByTestId("log-date-hint")).toHaveTextContent("Logging for Tue, Sep 15");
  });
});
