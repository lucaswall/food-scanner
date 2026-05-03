import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FitbitProfileData } from "@/types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const mockUseSWRImplementation = vi.fn();
vi.mock("swr", () => ({
  default: (key: string, ...args: unknown[]) => mockUseSWRImplementation(key, ...args),
}));

const mockMutate = vi.fn();

const mockProfileData: FitbitProfileData = {
  ageYears: 34,
  sex: "MALE",
  heightCm: 180,
  weightKg: 90.5,
  weightLoggedDate: "2026-01-14",
  goalType: "LOSE",
  lastSyncedAt: 1700000000000,
};

describe("FitbitProfileCard", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.clearAllMocks();
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return { data: null, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });
  });

  it("shows skeleton loading state when isLoading", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return { data: null, error: null, isLoading: true, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    // Should not show data fields
    expect(screen.queryByText(/34 years/)).not.toBeInTheDocument();
  });

  it("shows error state with retry button on error", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return {
          data: null,
          error: new Error("Failed to load profile"),
          isLoading: false,
          mutate: mockMutate,
        };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/failed to load profile/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("calls mutate when retry button is clicked", async () => {
    const user = userEvent.setup();
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return {
          data: null,
          error: new Error("Network error"),
          isLoading: false,
          mutate: mockMutate,
        };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    await user.click(screen.getByRole("button", { name: /retry/i }));
    expect(mockMutate).toHaveBeenCalled();
  });

  it("renders profile fields when data is loaded", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return { data: mockProfileData, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    expect(screen.getByText(/34 years/)).toBeInTheDocument();
    expect(screen.getByText(/180 cm/)).toBeInTheDocument();
    expect(screen.getByText(/90.5 kg/)).toBeInTheDocument();
  });

  it("shows sex as Male for MALE", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return {
          data: { ...mockProfileData, sex: "MALE" },
          error: null,
          isLoading: false,
          mutate: mockMutate,
        };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    expect(screen.getByText("Male")).toBeInTheDocument();
  });

  it("shows sex as Female for FEMALE", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return {
          data: { ...mockProfileData, sex: "FEMALE" },
          error: null,
          isLoading: false,
          mutate: mockMutate,
        };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    expect(screen.getByText("Female")).toBeInTheDocument();
  });

  it("shows Not set in Fitbit for sex NA", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return {
          data: { ...mockProfileData, sex: "NA" },
          error: null,
          isLoading: false,
          mutate: mockMutate,
        };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    expect(screen.getAllByText("Not set in Fitbit").length).toBeGreaterThan(0);
  });

  it("shows Not set in Fitbit for null weightKg", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return {
          data: { ...mockProfileData, weightKg: null, weightLoggedDate: null },
          error: null,
          isLoading: false,
          mutate: mockMutate,
        };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    expect(screen.getAllByText("Not set in Fitbit").length).toBeGreaterThan(0);
  });

  it("shows Not set in Fitbit for null goalType", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return {
          data: { ...mockProfileData, goalType: null },
          error: null,
          isLoading: false,
          mutate: mockMutate,
        };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    expect(screen.getAllByText("Not set in Fitbit").length).toBeGreaterThan(0);
  });

  it("shows Fitbit Profile heading", async () => {
    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    expect(screen.getByRole("heading", { name: /fitbit profile/i })).toBeInTheDocument();
  });

  it("has a Refresh from Fitbit button with minimum 44px touch target", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return { data: mockProfileData, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    const refreshButton = screen.getByRole("button", { name: /refresh from fitbit/i });
    expect(refreshButton).toBeInTheDocument();
    expect(refreshButton.className).toMatch(/min-h-\[44px\]/);
  });

  it("refresh button calls fetch with ?refresh=1 and then mutates", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true });
    mockMutate.mockResolvedValueOnce(undefined);

    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return { data: mockProfileData, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    await user.click(screen.getByRole("button", { name: /refresh from fitbit/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/fitbit/profile?refresh=1");
      expect(mockMutate).toHaveBeenCalled();
    });
  });

  it("refresh button is disabled while refreshing", async () => {
    const user = userEvent.setup();
    // Never resolves to keep refresh in flight
    mockFetch.mockImplementation(() => new Promise(() => {}));

    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return { data: mockProfileData, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    const button = screen.getByRole("button", { name: /refresh from fitbit/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /refreshing/i })).toBeDisabled();
    });
  });

  it("renders last synced timestamp", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/fitbit/profile") {
        return { data: mockProfileData, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });

    const { FitbitProfileCard } = await import("@/components/fitbit-profile-card");
    render(<FitbitProfileCard />);

    expect(screen.getByText(/last synced/i)).toBeInTheDocument();
  });
});
