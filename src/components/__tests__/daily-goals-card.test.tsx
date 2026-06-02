import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock ResizeObserver (needed for some components)
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// Hoist mocks referenced in factory functions
const { mockUseSWR, mockGlobalMutate, mockComputeMacroTargets } = vi.hoisted(() => ({
  mockUseSWR: vi.fn(),
  mockGlobalMutate: vi.fn(),
  mockComputeMacroTargets: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("swr", () => ({
  default: mockUseSWR,
  useSWRConfig: () => ({ mutate: mockGlobalMutate }),
}));

vi.mock("@/lib/swr", () => ({
  apiFetcher: vi.fn(),
  HEALTH_BACKED_SWR_CONFIG: {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 30 * 60 * 1000,
  },
}));

vi.mock("@/lib/macro-engine", () => ({
  computeMacroTargets: mockComputeMacroTargets,
  ACTIVITY_LEVEL_LABELS: {
    sedentary: "Sedentary",
    light: "Light",
    moderate: "Moderate",
    very_active: "Very active",
    extra_active: "Extra active",
  },
  PAL_BY_ACTIVITY_LEVEL: {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    very_active: 1.725,
    extra_active: 1.9,
  },
}));

// Sample data
const sampleSettings = {
  activityLevel: "light",
  goalWeightKg: 75.0,
  goalRateKgPerWeek: 0.5,
  sex: "MALE",
  weightGoalType: "LOSE",
};

const sampleProfile = {
  ageYears: 30,
  sex: "MALE",
  heightCm: 175,
  weightKg: 80,
  weightLoggedDate: "2026-05-07",
  goalType: "LOSE",
  lastSyncedAt: Date.now(),
};

const sampleEngineOutput = {
  targetKcal: 2200,
  proteinG: 160,
  carbsG: 250,
  fatG: 65,
  rmr: 1900,
  palMultiplier: 1.375,
  tdee: 2613,
  deficitKcal: -550,
  direction: "LOSE" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
  mockGlobalMutate.mockResolvedValue(undefined);

  // Default: both SWR fetches loaded
  mockUseSWR.mockImplementation((key: string) => {
    if (key === "/api/daily-goals-settings") {
      return { data: sampleSettings, error: null, isLoading: false, mutate: vi.fn() };
    }
    if (key === "/api/health-profile") {
      return { data: sampleProfile, error: null, isLoading: false, mutate: vi.fn() };
    }
    return { data: null, error: null, isLoading: true, mutate: vi.fn() };
  });

  mockComputeMacroTargets.mockReturnValue(sampleEngineOutput);
});

// Import after mocks are set up
const { DailyGoalsCard } = await import("@/components/daily-goals-card");

describe("DailyGoalsCard", () => {
  describe("Loading state", () => {
    it("renders Skeletons while settings SWR is loading", () => {
      mockUseSWR.mockImplementation((key: string) => {
        if (key === "/api/daily-goals-settings") {
          return { data: undefined, error: null, isLoading: true, mutate: vi.fn() };
        }
        return { data: sampleProfile, error: null, isLoading: false, mutate: vi.fn() };
      });

      render(<DailyGoalsCard />);

      // Skeletons should be visible, no form elements
      const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });

    it("renders Skeletons while profile SWR is loading", () => {
      mockUseSWR.mockImplementation((key: string) => {
        if (key === "/api/health-profile") {
          return { data: undefined, error: null, isLoading: true, mutate: vi.fn() };
        }
        return { data: sampleSettings, error: null, isLoading: false, mutate: vi.fn() };
      });

      render(<DailyGoalsCard />);

      const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("Initial values", () => {
    it("pre-fills form fields from saved settings", async () => {
      render(<DailyGoalsCard />);

      // Activity level radio should be active for "light"
      const lightRadio = screen.getByRole("radio", { name: /light/i });
      expect(lightRadio).toHaveAttribute("aria-checked", "true");

      // Goal weight input pre-filled
      const weightInput = screen.getByLabelText(/goal weight/i);
      expect((weightInput as HTMLInputElement).value).toBe("75");

      // Goal rate input pre-filled
      const rateInput = screen.getByLabelText(/goal rate/i);
      expect((rateInput as HTMLInputElement).value).toBe("0.5");
    });

    it("shows live target preview when all values present", async () => {
      render(<DailyGoalsCard />);

      await screen.findByText(/estimated daily target/i);
      expect(screen.getByText(/2200 kcal/i)).toBeInTheDocument();
    });
  });

  describe("Empty initial state", () => {
    it("shows unselected radios and empty inputs when all settings are null", () => {
      mockUseSWR.mockImplementation((key: string) => {
        if (key === "/api/daily-goals-settings") {
          return {
            data: { activityLevel: null, goalWeightKg: null, goalRateKgPerWeek: null },
            error: null,
            isLoading: false,
            mutate: vi.fn(),
          };
        }
        return { data: sampleProfile, error: null, isLoading: false, mutate: vi.fn() };
      });

      render(<DailyGoalsCard />);

      // All radios unchecked
      const radios = screen.getAllByRole("radio");
      for (const radio of radios) {
        expect(radio).toHaveAttribute("aria-checked", "false");
      }

      // Numeric inputs empty
      const weightInput = screen.getByLabelText(/goal weight/i) as HTMLInputElement;
      expect(weightInput.value).toBe("");
      const rateInput = screen.getByLabelText(/goal rate/i) as HTMLInputElement;
      expect(rateInput.value).toBe("");
    });

    it("does not show live target preview when settings are null", () => {
      mockUseSWR.mockImplementation((key: string) => {
        if (key === "/api/daily-goals-settings") {
          return {
            data: { activityLevel: null, goalWeightKg: null, goalRateKgPerWeek: null },
            error: null,
            isLoading: false,
            mutate: vi.fn(),
          };
        }
        return { data: sampleProfile, error: null, isLoading: false, mutate: vi.fn() };
      });

      render(<DailyGoalsCard />);

      expect(screen.queryByText(/estimated daily target/i)).toBeNull();
    });
  });

  describe("Live target preview", () => {
    it("shows — when computeMacroTargets throws INVALID_PROFILE_DATA", () => {
      mockComputeMacroTargets.mockImplementation(() => {
        throw new Error("INVALID_PROFILE_DATA");
      });

      render(<DailyGoalsCard />);

      // Shows the dash placeholder instead of kcal value
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("shows — when computeMacroTargets throws SEX_UNSET", () => {
      mockComputeMacroTargets.mockImplementation(() => {
        throw new Error("SEX_UNSET");
      });

      render(<DailyGoalsCard />);

      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });

  describe("Safety floor warning", () => {
    it("shows safety warning when computed target is below the male floor (1500)", () => {
      mockComputeMacroTargets.mockReturnValue({
        ...sampleEngineOutput,
        targetKcal: 1400,
      });

      render(<DailyGoalsCard />);

      const warning = screen.getByRole("alert");
      expect(warning.textContent).toMatch(/1400/);
      expect(warning.textContent).toMatch(/1500/);
      expect(warning.textContent).toMatch(/safe minimum/i);
    });

    it("shows safety warning below female floor (1200) for FEMALE sex setting", () => {
      // Floor now keys off the local sex SETTING (the form value), not the Health profile.
      mockUseSWR.mockImplementation((key: string) => {
        if (key === "/api/health-profile") {
          return { data: sampleProfile, error: null, isLoading: false, mutate: vi.fn() };
        }
        return {
          data: { ...sampleSettings, sex: "FEMALE" },
          error: null,
          isLoading: false,
          mutate: vi.fn(),
        };
      });
      mockComputeMacroTargets.mockReturnValue({
        ...sampleEngineOutput,
        targetKcal: 1100,
      });

      render(<DailyGoalsCard />);

      const warning = screen.getByRole("alert");
      expect(warning.textContent).toMatch(/1100/);
      expect(warning.textContent).toMatch(/1200/);
    });

    it("does NOT show safety warning when target is at or above the floor", () => {
      // Default mock returns 2200 kcal which is above all floors
      render(<DailyGoalsCard />);

      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("Save remains enabled when safety warning is shown", () => {
      mockComputeMacroTargets.mockReturnValue({
        ...sampleEngineOutput,
        targetKcal: 1100,
      });

      render(<DailyGoalsCard />);

      const saveButton = screen.getByRole("button", { name: /save/i });
      expect(saveButton).not.toBeDisabled();
    });
  });

  describe("Save flow", () => {
    it("PATCHes /api/daily-goals-settings with form values on Save click", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: sampleSettings,
          timestamp: Date.now(),
        }),
      });

      render(<DailyGoalsCard />);

      const saveButton = screen.getByRole("button", { name: /^save$/i });
      await user.click(saveButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/daily-goals-settings",
          expect.objectContaining({
            method: "PATCH",
            body: expect.stringContaining('"activityLevel":"light"'),
          }),
        );
      });
    });

    it("calls globalMutate for /api/nutrition-goals on successful save", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: sampleSettings,
          timestamp: Date.now(),
        }),
      });

      render(<DailyGoalsCard />);

      await user.click(screen.getByRole("button", { name: /^save$/i }));

      await waitFor(() => {
        expect(mockGlobalMutate).toHaveBeenCalled();
      });

      // The mutate predicate should match nutrition-goals keys
      const predicate = mockGlobalMutate.mock.calls[0][0] as (key: unknown) => boolean;
      expect(predicate("/api/nutrition-goals")).toBe(true);
      expect(predicate("/api/nutrition-goals/today")).toBe(true);
      expect(predicate("/api/other-endpoint")).toBe(false);
    });

    it("shows error message on non-200 response", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid" },
          timestamp: Date.now(),
        }),
      });

      render(<DailyGoalsCard />);

      await user.click(screen.getByRole("button", { name: /^save$/i }));

      await waitFor(() => {
        expect(screen.getByText(/could not save/i)).toBeInTheDocument();
      });
    });

    it("disables Save button and shows 'Saving…' while request is in flight", async () => {
      const user = userEvent.setup();
      let resolveRequest!: (value: unknown) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
      );

      render(<DailyGoalsCard />);

      const saveButton = screen.getByRole("button", { name: /^save$/i });
      await user.click(saveButton);

      // While in flight, button should be disabled
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
      });

      // Resolve the request inside act so React can flush state updates cleanly
      await act(async () => {
        resolveRequest({
          ok: true,
          json: async () => ({ success: true, data: sampleSettings, timestamp: Date.now() }),
        });
      });
    });
  });

  describe("Touch targets", () => {
    it("all radio buttons have min-height 44px class", () => {
      render(<DailyGoalsCard />);

      const radios = screen.getAllByRole("radio");
      for (const radio of radios) {
        const container = radio.closest("button") ?? radio;
        expect(container.className).toMatch(/min-h-\[44px\]/);
      }
    });
  });

  // FOO-1131: Save must be disabled when required fields are missing
  describe("Required fields guard (FOO-1131)", () => {
    it("disables Save when sex is null", () => {
      mockUseSWR.mockImplementation((key: string) => {
        if (key === "/api/daily-goals-settings") {
          return {
            data: { ...sampleSettings, sex: null },
            error: null,
            isLoading: false,
            mutate: vi.fn(),
          };
        }
        return { data: sampleProfile, error: null, isLoading: false, mutate: vi.fn() };
      });

      render(<DailyGoalsCard />);

      const saveButton = screen.getByRole("button", { name: /^save$/i });
      expect(saveButton).toBeDisabled();
    });

    it("disables Save when activityLevel is null", () => {
      mockUseSWR.mockImplementation((key: string) => {
        if (key === "/api/daily-goals-settings") {
          return {
            data: { ...sampleSettings, activityLevel: null },
            error: null,
            isLoading: false,
            mutate: vi.fn(),
          };
        }
        return { data: sampleProfile, error: null, isLoading: false, mutate: vi.fn() };
      });

      render(<DailyGoalsCard />);

      const saveButton = screen.getByRole("button", { name: /^save$/i });
      expect(saveButton).toBeDisabled();
    });

    it("shows accessible validation message when sex and activityLevel are both null", () => {
      mockUseSWR.mockImplementation((key: string) => {
        if (key === "/api/daily-goals-settings") {
          return {
            data: { activityLevel: null, goalWeightKg: null, goalRateKgPerWeek: null, sex: null, weightGoalType: null },
            error: null,
            isLoading: false,
            mutate: vi.fn(),
          };
        }
        return { data: sampleProfile, error: null, isLoading: false, mutate: vi.fn() };
      });

      render(<DailyGoalsCard />);

      // Should show an accessible message about required fields
      const message = screen.getByRole("alert");
      expect(message.textContent).toMatch(/sex.*activity|activity.*sex|required/i);
    });

    it("enables Save when both sex and activityLevel are set", () => {
      // Default mockUseSWR already has both set (sampleSettings has sex and activityLevel)
      render(<DailyGoalsCard />);

      const saveButton = screen.getByRole("button", { name: /^save$/i });
      expect(saveButton).not.toBeDisabled();
    });
  });

  // FOO-1132 / FOO-1141: a health-profile read failure must NOT blank the card.
  // The goal inputs are local settings (independent of the Google Health profile);
  // only the live target preview depends on the profile. So on profileError we
  // render the full card and degrade ONLY the preview (non-blocking notice).
  describe("Health profile error is non-blocking (FOO-1132 / FOO-1141)", () => {
    function mockProfileError(error: unknown) {
      mockUseSWR.mockImplementation((key: string) => {
        if (key === "/api/daily-goals-settings") {
          return { data: sampleSettings, error: null, isLoading: false, mutate: vi.fn() };
        }
        if (key === "/api/health-profile") {
          return { data: undefined, error, isLoading: false, mutate: vi.fn() };
        }
        return { data: null, error: null, isLoading: true, mutate: vi.fn() };
      });
    }

    it("renders all goal inputs and Save when the health-profile SWR errors", () => {
      mockProfileError(new Error("fetch failed"));

      render(<DailyGoalsCard />);

      // The card is NOT replaced by a full-card error — inputs remain reachable.
      expect(screen.getByRole("radio", { name: /^male$/i })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /^female$/i })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /sedentary/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/goal weight/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/goal rate/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    });

    it("shows a non-blocking preview-unavailable notice and hides the live preview", () => {
      mockProfileError(new Error("fetch failed"));

      render(<DailyGoalsCard />);

      expect(screen.getByText(/preview unavailable/i)).toBeInTheDocument();
      // The live target preview is suppressed because the profile is unavailable.
      expect(screen.queryByText(/estimated daily target/i)).toBeNull();
    });

    it("keeps Save enabled when the profile errors but required fields are set", () => {
      mockProfileError(new Error("fetch failed"));

      render(<DailyGoalsCard />);

      expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled();
    });

    it("stays non-blocking for a TimeoutError too", () => {
      mockProfileError(new DOMException("Timeout", "TimeoutError"));

      render(<DailyGoalsCard />);

      expect(screen.getByText(/preview unavailable/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();
    });
  });

  // settingsError genuinely gates the inputs (the local settings fetch failed),
  // so it MUST still hard-error the whole card (unchanged by FOO-1141).
  describe("Settings load error is blocking", () => {
    it("replaces the card with an error + Retry when the settings SWR errors", () => {
      mockUseSWR.mockImplementation((key: string) => {
        if (key === "/api/daily-goals-settings") {
          return { data: undefined, error: new Error("fetch failed"), isLoading: false, mutate: vi.fn() };
        }
        return { data: sampleProfile, error: null, isLoading: false, mutate: vi.fn() };
      });

      render(<DailyGoalsCard />);

      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/could not load daily goal settings/i);
      expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
      // Inputs are NOT rendered — the local settings failed to load.
      expect(screen.queryByRole("radio", { name: /^male$/i })).toBeNull();
    });
  });
});
