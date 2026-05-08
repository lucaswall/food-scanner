import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { TargetsCard } from "../targets-card";
import type { NutritionGoals } from "@/types";

// Mock ACTIVITY_LEVEL_LABELS from macro-engine (added by Worker 1)
vi.mock("@/lib/macro-engine", () => ({
  ACTIVITY_LEVEL_LABELS: {
    sedentary: "Sedentary",
    light: "Light",
    moderate: "Moderate",
    very_active: "Very active",
    extra_active: "Extra active",
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const TEST_DATE = "2026-05-03";

// Local type that reflects the new NutritionGoalsAudit shape (Worker 1 updates these types).
// Using a relaxed type here so test fixtures work before type updates land.
type NewAudit = {
  rmr: number;
  palMultiplier?: number | null;
  tdee?: number | null;
  weightKg: string;
  weightLoggedDate: string | null;
  activityLevel?: string | null;
  goalWeightKg?: number | null;
  goalRateKgPerWeek?: number | null;
  deficitKcal?: number | null;
  direction?: string | null;
};

type GoalsData = Omit<NutritionGoals, "audit" | "reason"> & {
  audit?: NewAudit;
  reason?: string;
};

function goalsResponse(data: GoalsData) {
  return {
    ok: true,
    json: () => Promise.resolve({ success: true, data }),
  };
}

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
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: 2200,
        proteinG: 140,
        carbsG: 220,
        fatG: 80,
        status: "ok",
        audit: {
          rmr: 1760,
          palMultiplier: 1.375,
          tdee: 2420,
          weightKg: "75",
          weightLoggedDate: "2026-05-01",
          activityLevel: "light",
          goalWeightKg: 70,
          goalRateKgPerWeek: 0.5,
          deficitKcal: -550,
          direction: "LOSE",
        },
      })
    );
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText("2,200 cal/day")).toBeInTheDocument();
      expect(screen.getByText("P:140g")).toBeInTheDocument();
      expect(screen.getByText("C:220g")).toBeInTheDocument();
      expect(screen.getByText("F:80g")).toBeInTheDocument();
    });
  });

  // FOO-1045: no expand toggle — audit shown inline at all times
  it("does NOT render expand/hide toggle button", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: 2200,
        proteinG: 140,
        carbsG: 220,
        fatG: 80,
        status: "ok",
        audit: {
          rmr: 1760,
          palMultiplier: 1.375,
          tdee: 2420,
          weightKg: "75",
          weightLoggedDate: "2026-05-01",
          activityLevel: "light",
          goalWeightKg: 70,
          goalRateKgPerWeek: 0.5,
          deficitKcal: -550,
          direction: "LOSE",
        },
      })
    );
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText("2,200 cal/day")).toBeInTheDocument();
    });
    // No expand/hide toggle
    expect(
      screen.queryByRole("button", { name: /show calculation details/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /hide calculation details/i })
    ).not.toBeInTheDocument();
  });

  // FOO-1045: all audit fields visible inline when audit is fully populated
  it("renders all audit rows inline when audit is fully populated", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: 2200,
        proteinG: 140,
        carbsG: 220,
        fatG: 80,
        status: "ok",
        audit: {
          rmr: 1760,
          palMultiplier: 1.375,
          tdee: 2420,
          weightKg: "75",
          weightLoggedDate: "2026-05-01",
          activityLevel: "light",
          goalWeightKg: 70,
          goalRateKgPerWeek: 0.5,
          deficitKcal: -550,
          direction: "LOSE",
        },
      })
    );
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText(/RMR: 1760 kcal/)).toBeInTheDocument();
      expect(screen.getByText(/Activity: Light \(PAL ×1\.375\)/)).toBeInTheDocument();
      expect(screen.getByText(/TDEE: 2420 kcal/)).toBeInTheDocument();
      expect(screen.getByText(/Weight: 75 kg \(logged 2026-05-01\)/)).toBeInTheDocument();
      expect(screen.getByText(/Goal weight: 70 kg/)).toBeInTheDocument();
      expect(screen.getByText(/Goal rate: 0\.5 kg\/week/)).toBeInTheDocument();
      expect(screen.getByText(/-550 kcal\/day · LOSE/)).toBeInTheDocument();
    });
  });

  // FOO-1045: GAIN direction shows positive sign
  it("formats positive deficit (surplus/GAIN) with + prefix", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: 2750,
        proteinG: 150,
        carbsG: 280,
        fatG: 90,
        status: "ok",
        audit: {
          rmr: 1760,
          palMultiplier: 1.375,
          tdee: 2420,
          weightKg: "70",
          weightLoggedDate: "2026-05-01",
          activityLevel: "light",
          goalWeightKg: 75,
          goalRateKgPerWeek: 0.3,
          deficitKcal: 330,
          direction: "GAIN",
        },
      })
    );
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText(/\+330 kcal\/day · GAIN/)).toBeInTheDocument();
    });
  });

  // FOO-1045: MAINTAIN direction shows zero
  it("formats zero deficit (MAINTAIN) without sign", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: 2420,
        proteinG: 140,
        carbsG: 240,
        fatG: 85,
        status: "ok",
        audit: {
          rmr: 1760,
          palMultiplier: 1.375,
          tdee: 2420,
          weightKg: "75",
          weightLoggedDate: "2026-05-01",
          activityLevel: "light",
          goalWeightKg: 75,
          goalRateKgPerWeek: 0,
          deficitKcal: 0,
          direction: "MAINTAIN",
        },
      })
    );
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText(/0 kcal\/day · MAINTAIN/)).toBeInTheDocument();
    });
  });

  // FOO-1045: past rows written by old engine only have rmr + weightKg;
  // new columns (palMultiplier, tdee, activityLevel, etc.) are null → skip those rows.
  it("renders only non-null audit rows for past rows missing new audit fields", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: 2000,
        proteinG: 130,
        carbsG: 200,
        fatG: 70,
        status: "ok",
        audit: {
          rmr: 1600,
          palMultiplier: null,
          tdee: null,
          weightKg: "75",
          weightLoggedDate: "2026-03-01",
          activityLevel: null,
          goalWeightKg: null,
          goalRateKgPerWeek: null,
          deficitKcal: null,
          direction: null,
        },
      })
    );
    renderTargetsCard();
    await waitFor(() => {
      // Only RMR and Weight rows render
      expect(screen.getByText(/RMR: 1600 kcal/)).toBeInTheDocument();
      expect(screen.getByText(/Weight: 75 kg \(logged 2026-03-01\)/)).toBeInTheDocument();
    });
    // New fields must not render
    expect(screen.queryByText(/Activity:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/TDEE:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Goal weight:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Goal rate:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Deficit:/)).not.toBeInTheDocument();
  });

  // FOO-1045: weight logged date absent → show "no log date"
  it("shows 'no log date' when weightLoggedDate is null", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: 2000,
        proteinG: 130,
        carbsG: 200,
        fatG: 70,
        status: "ok",
        audit: {
          rmr: 1600,
          palMultiplier: 1.375,
          tdee: 2200,
          weightKg: "72",
          weightLoggedDate: null,
          activityLevel: "light",
          goalWeightKg: 70,
          goalRateKgPerWeek: 0.5,
          deficitKcal: -550,
          direction: "LOSE",
        },
      })
    );
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText(/Weight: 72 kg \(no log date\)/)).toBeInTheDocument();
    });
  });

  // FOO-1045: new blocked reason
  it("renders goals_not_set blocked message", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        status: "blocked",
        reason: "goals_not_set",
      })
    );
    renderTargetsCard();
    await waitFor(() => {
      expect(
        screen.getByText(/Set up your daily goals in Settings to enable targets\./i)
      ).toBeInTheDocument();
    });
  });

  it("renders no_weight blocked message", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        status: "blocked",
        reason: "no_weight",
      })
    );
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText(/log your weight in fitbit/i)).toBeInTheDocument();
    });
  });

  it("renders sex_unset blocked message", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        status: "blocked",
        reason: "sex_unset",
      })
    );
    renderTargetsCard();
    await waitFor(() => {
      expect(screen.getByText(/biological sex/i)).toBeInTheDocument();
    });
  });

  it("renders scope_mismatch blocked message", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        status: "blocked",
        reason: "scope_mismatch",
      })
    );
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
        json: () =>
          Promise.resolve({ success: false, error: { code: "INTERNAL_ERROR", message: "Error" } }),
      })
      .mockResolvedValueOnce(
        goalsResponse({
          calories: 2000,
          proteinG: 130,
          carbsG: 200,
          fatG: 70,
          status: "ok",
          audit: {
            rmr: 1500,
            palMultiplier: 1.375,
            tdee: 2063,
            weightKg: "70",
            weightLoggedDate: "2026-05-01",
            activityLevel: "light",
            goalWeightKg: 68,
            goalRateKgPerWeek: 0.25,
            deficitKcal: -275,
            direction: "LOSE",
          },
        })
      );
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

  // weight-stale warning preserved
  it("shows weight-stale warning when weightStale is true", async () => {
    mockFetch.mockResolvedValueOnce(
      goalsResponse({
        calories: 2200,
        proteinG: 140,
        carbsG: 220,
        fatG: 80,
        status: "ok",
        weightStale: true,
        audit: {
          rmr: 1760,
          palMultiplier: 1.375,
          tdee: 2420,
          weightKg: "75",
          weightLoggedDate: "2026-04-01",
          activityLevel: "light",
          goalWeightKg: 70,
          goalRateKgPerWeek: 0.5,
          deficitKcal: -550,
          direction: "LOSE",
        },
      })
    );
    renderTargetsCard("2026-05-03");
    await waitFor(() => {
      expect(screen.getByText(/weight log is \d+ days old/i)).toBeInTheDocument();
    });
  });
});
