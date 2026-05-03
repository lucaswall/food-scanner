import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { TargetsCard } from "../targets-card";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const TEST_DATE = "2026-05-03";

function renderTargetsCard(date = TEST_DATE) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TargetsCard date={date} />
    </SWRConfig>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TargetsCard", () => {
  it("shows skeleton while loading", () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderTargetsCard();
    expect(screen.getByTestId("targets-card-skeleton")).toBeInTheDocument();
  });

  it("renders nothing when goals are null (no data yet)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: null }),
    });
    const { container } = renderTargetsCard();
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it("renders calorie + macro targets when status is ok", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            calories: 2200,
            proteinG: 140,
            carbsG: 220,
            fatG: 80,
            status: "ok",
            audit: {
              rmr: 1600,
              activityKcal: 450,
              tdee: 2050,
              weightKg: 75,
              bmiTier: "normal",
              goalType: "maintenance",
            },
          },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText("2,200 cal/day")).toBeInTheDocument();
      expect(screen.getByText("P:140g")).toBeInTheDocument();
      expect(screen.getByText("C:220g")).toBeInTheDocument();
      expect(screen.getByText("F:80g")).toBeInTheDocument();
    });
  });

  it("audit math is collapsed by default", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            calories: 2200,
            proteinG: 140,
            carbsG: 220,
            fatG: 80,
            status: "ok",
            audit: { rmr: 1600, activityKcal: 450, tdee: 2050, weightKg: 75, bmiTier: "normal", goalType: "maintenance" },
          },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText("2,200 cal/day")).toBeInTheDocument();
    });
    // Audit details should not be visible when collapsed
    expect(screen.queryByText(/RMR:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/TDEE:/i)).not.toBeInTheDocument();
  });

  it("expand toggle shows audit math details", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            calories: 2200,
            proteinG: 140,
            carbsG: 220,
            fatG: 80,
            status: "ok",
            audit: { rmr: 1600, activityKcal: 450, tdee: 2050, weightKg: 75, bmiTier: "normal", goalType: "maintenance" },
          },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText("2,200 cal/day")).toBeInTheDocument();
    });
    const expandBtn = screen.getByRole("button", { name: /show calculation details/i });
    await user.click(expandBtn);
    expect(screen.getByText(/RMR: 1600 kcal/)).toBeInTheDocument();
    expect(screen.getByText(/Activity: 450 kcal/)).toBeInTheDocument();
    expect(screen.getByText(/TDEE: 2050 kcal/)).toBeInTheDocument();
    expect(screen.getByText(/Weight: 75kg \(normal\)/)).toBeInTheDocument();
    expect(screen.getByText(/Goal: maintenance/)).toBeInTheDocument();
  });

  it("expand toggle has at least 44px touch target", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            calories: 2200, proteinG: 140, carbsG: 220, fatG: 80,
            status: "ok",
            audit: { rmr: 1600, activityKcal: 450, tdee: 2050, weightKg: 75, bmiTier: "normal", goalType: "maintenance" },
          },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText("2,200 cal/day")).toBeInTheDocument();
    });
    const expandBtn = screen.getByRole("button", { name: /show calculation details/i });
    expect(expandBtn).toHaveClass("min-h-[44px]");
  });

  it("collapse toggle hides audit math details after expand", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            calories: 2200, proteinG: 140, carbsG: 220, fatG: 80,
            status: "ok",
            audit: { rmr: 1600, activityKcal: 450, tdee: 2050, weightKg: 75, bmiTier: "normal", goalType: "maintenance" },
          },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText("2,200 cal/day")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /show calculation details/i }));
    expect(screen.getByText(/RMR: 1600 kcal/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /hide calculation details/i }));
    expect(screen.queryByText(/RMR:/i)).not.toBeInTheDocument();
  });

  it("renders pending message when status is partial", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            calories: null, proteinG: null, carbsG: null, fatG: null,
            status: "partial",
          },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText(/targets pending — waiting for fitbit activity/i)).toBeInTheDocument();
    });
  });

  it("renders no_weight blocked message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            calories: null, proteinG: null, carbsG: null, fatG: null,
            status: "blocked", reason: "no_weight",
          },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText(/log your weight in fitbit/i)).toBeInTheDocument();
    });
  });

  it("renders sex_unset blocked message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            calories: null, proteinG: null, carbsG: null, fatG: null,
            status: "blocked", reason: "sex_unset",
          },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText(/biological sex/i)).toBeInTheDocument();
    });
  });

  it("renders scope_mismatch blocked message", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            calories: null, proteinG: null, carbsG: null, fatG: null,
            status: "blocked", reason: "scope_mismatch",
          },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText(/reconnect fitbit/i)).toBeInTheDocument();
    });
  });

  it("shows retry button on error", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Server error" },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
  });

  it("retry button refetches on click", async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ success: false, error: { code: "INTERNAL_ERROR", message: "Error" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              calories: 2000, proteinG: 130, carbsG: 200, fatG: 70,
              status: "ok",
              audit: { rmr: 1500, activityKcal: 400, tdee: 1900, weightKg: 70, bmiTier: "normal", goalType: "maintenance" },
            },
          }),
      });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => {
      expect(screen.getByText("2,000 cal/day")).toBeInTheDocument();
    });
  });

  it("fetches with clientDate query param matching the prop", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: null }),
    });
    renderTargetsCard("2026-03-15");
    await waitFor(() => {
      const call = mockFetch.mock.calls[0];
      expect(call[0]).toContain("clientDate=2026-03-15");
    });
  });

  it("does not render expand button when audit is absent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            calories: 2200, proteinG: 140, carbsG: 220, fatG: 80,
            status: "ok",
            // no audit block
          },
        }),
    });
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText("2,200 cal/day")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /show calculation details/i })).not.toBeInTheDocument();
  });
});
