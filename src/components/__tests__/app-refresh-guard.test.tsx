import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AppRefreshGuard } from "@/components/app-refresh-guard";

// Mock Date.now
let mockNow = Date.now();
vi.spyOn(Date, "now").mockImplementation(() => mockNow);

describe("AppRefreshGuard", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();

    // Reset Date.now mock
    mockNow = Date.now();

    // Mock window.location to prevent actual navigation
    Object.defineProperty(window, "location", {
      writable: true,
      value: { href: "" },
    });
  });

  it("renders children correctly", () => {
    render(
      <AppRefreshGuard>
        <div data-testid="child-content">App content</div>
      </AppRefreshGuard>
    );

    expect(screen.getByTestId("child-content")).toBeInTheDocument();
    expect(screen.getByText("App content")).toBeInTheDocument();
  });

  it("initializes localStorage on mount with current timestamp and date", () => {
    const testTime = new Date("2026-02-10T10:00:00Z").getTime();
    mockNow = testTime;

    render(
      <AppRefreshGuard>
        <div>Content</div>
      </AppRefreshGuard>
    );

    expect(localStorage.getItem("app-refresh-guard:lastActive")).toBe(String(testTime));
    expect(localStorage.getItem("app-refresh-guard:lastDate")).toBe(
      new Date(testTime).toDateString()
    );
  });

  it("updates localStorage when tab becomes hidden", () => {
    const initialTime = new Date("2026-02-10T10:00:00Z").getTime();
    mockNow = initialTime;

    render(
      <AppRefreshGuard>
        <div>Content</div>
      </AppRefreshGuard>
    );

    // Simulate time passing
    const laterTime = new Date("2026-02-10T11:00:00Z").getTime();
    mockNow = laterTime;

    // Tab becomes hidden
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(localStorage.getItem("app-refresh-guard:lastActive")).toBe(String(laterTime));
    expect(localStorage.getItem("app-refresh-guard:lastDate")).toBe(
      new Date(laterTime).toDateString()
    );
  });

  it("does NOT reload when elapsed < 4 hours even if date changed", () => {
    const initialTime = new Date("2026-02-10T23:00:00Z").getTime();
    mockNow = initialTime;

    render(
      <AppRefreshGuard>
        <div>Content</div>
      </AppRefreshGuard>
    );

    // Tab becomes hidden
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Simulate 2 hours passing AND date change (23:00 → 01:00 next day)
    const laterTime = new Date("2026-02-11T01:00:00Z").getTime();
    mockNow = laterTime;

    // Tab becomes visible
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should NOT reload (only 2 hours elapsed, need 4+)
    expect(window.location.href).toBe("");
  });

  it("does NOT reload when date has NOT changed even if 5 hours elapsed", () => {
    const initialTime = new Date("2026-02-10T08:00:00Z").getTime();
    mockNow = initialTime;

    render(
      <AppRefreshGuard>
        <div>Content</div>
      </AppRefreshGuard>
    );

    // Tab becomes hidden
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Simulate 5 hours passing, SAME date
    const laterTime = new Date("2026-02-10T13:00:00Z").getTime();
    mockNow = laterTime;

    // Tab becomes visible
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should NOT reload (same date)
    expect(window.location.href).toBe("");
  });

  it("DOES reload when both conditions met: 4+ hours AND date changed", () => {
    // Use times that are guaranteed to be on different dates in any timezone
    const initialTime = new Date("2026-02-10T12:00:00Z").getTime();
    mockNow = initialTime;

    render(
      <AppRefreshGuard>
        <div>Content</div>
      </AppRefreshGuard>
    );

    // Verify localStorage was initialized on mount
    const expectedInitialDate = new Date(initialTime).toDateString();
    expect(localStorage.getItem("app-refresh-guard:lastActive")).toBe(String(initialTime));
    expect(localStorage.getItem("app-refresh-guard:lastDate")).toBe(expectedInitialDate);

    // Tab becomes hidden
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Verify localStorage was updated when hidden (should still be initial time since we haven't advanced mockNow yet)
    expect(localStorage.getItem("app-refresh-guard:lastActive")).toBe(String(initialTime));

    // Simulate 2 days passing (48 hours) - definitely both conditions met
    const laterTime = new Date("2026-02-12T12:00:00Z").getTime();
    mockNow = laterTime;

    // Verify conditions will be met
    const laterDate = new Date(laterTime).toDateString();
    const elapsed = laterTime - initialTime;
    expect(laterDate).not.toBe(expectedInitialDate); // Dates should be different
    expect(elapsed).toBeGreaterThan(4 * 60 * 60 * 1000); // Should be >4 hours

    // Tab becomes visible
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should reload
    expect(window.location.href).toBe("/app");
  });

  it("handles missing localStorage data gracefully (treats as no reload needed)", () => {
    const initialTime = new Date("2026-02-10T10:00:00Z").getTime();
    mockNow = initialTime;

    render(
      <AppRefreshGuard>
        <div>Content</div>
      </AppRefreshGuard>
    );

    // Manually clear localStorage to simulate corruption
    localStorage.clear();

    // Simulate date/time change
    const laterTime = new Date("2026-02-11T15:00:00Z").getTime();
    mockNow = laterTime;

    // Tab becomes visible
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Should NOT reload (missing data = no reload)
    expect(window.location.href).toBe("");
  });
});
