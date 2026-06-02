import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { HealthProfileData } from "@/types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const mockUseSWRImplementation = vi.fn();
vi.mock("swr", () => ({
  default: (key: string, ...args: unknown[]) => mockUseSWRImplementation(key, ...args),
}));

const mockMutate = vi.fn();

const mockProfileData: HealthProfileData = {
  ageYears: 34,
  sex: "MALE",
  heightCm: 180,
  weightKg: 90.5,
  weightLoggedDate: "2026-01-14",
  goalType: "LOSE",
  lastSyncedAt: 1700000000000,
};

describe("HealthProfileCard", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.clearAllMocks();
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/health-profile") {
        return { data: null, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false, mutate: vi.fn() };
    });
  });

  it("renders 'Google Health Profile' heading", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/health-profile") {
        return { data: mockProfileData, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false };
    });

    const { HealthProfileCard } = await import("@/components/health-profile-card");
    render(<HealthProfileCard />);
    expect(screen.getByRole("heading", { name: /google health profile/i })).toBeInTheDocument();
  });

  it("renders 'Refresh from Google Health' button", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/health-profile") {
        return { data: mockProfileData, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false };
    });

    const { HealthProfileCard } = await import("@/components/health-profile-card");
    render(<HealthProfileCard />);
    expect(screen.getByRole("button", { name: /refresh from google health/i })).toBeInTheDocument();
  });

  it("shows 'Not set in Google Health' for missing fields", async () => {
    const incompleteData: HealthProfileData = {
      ...mockProfileData,
      weightKg: null,
      goalType: null,
    };
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/health-profile") {
        return { data: incompleteData, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false };
    });

    const { HealthProfileCard } = await import("@/components/health-profile-card");
    render(<HealthProfileCard />);
    const notSet = screen.getAllByText(/not set in google health/i);
    expect(notSet.length).toBeGreaterThan(0);
  });

  it("shows skeleton loading state when isLoading", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/health-profile") {
        return { data: null, error: null, isLoading: true, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false };
    });

    const { HealthProfileCard } = await import("@/components/health-profile-card");
    const { container } = render(<HealthProfileCard />);
    expect(container.querySelector(".animate-pulse, [class*='animate']")).toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/health-profile") {
        return { data: null, error: new Error("fetch failed"), isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false };
    });

    const { HealthProfileCard } = await import("@/components/health-profile-card");
    render(<HealthProfileCard />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("fetches from /api/health-profile", async () => {
    const { HealthProfileCard } = await import("@/components/health-profile-card");
    render(<HealthProfileCard />);
    expect(mockUseSWRImplementation).toHaveBeenCalledWith(
      "/api/health-profile",
      expect.anything(),
      expect.anything(),
    );
  });

  it("shows distinct timeout message when SWR errors with TimeoutError", async () => {
    const timeoutError = new DOMException("Timeout", "TimeoutError");
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/health-profile") {
        return { data: null, error: timeoutError, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false };
    });

    const { HealthProfileCard } = await import("@/components/health-profile-card");
    render(<HealthProfileCard />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/timed? ?out/i);
  });

  it("renders height unavailable state accessibly when heightCm is null", async () => {
    const noHeightData: HealthProfileData = {
      ...mockProfileData,
      heightCm: null,
    };
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/health-profile") {
        return { data: noHeightData, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false };
    });

    const { HealthProfileCard } = await import("@/components/health-profile-card");
    render(<HealthProfileCard />);
    // Should show a meaningful "unavailable" state, not crash or show blank
    expect(screen.getByRole("heading", { name: /google health profile/i })).toBeInTheDocument();
    const heightRow = screen.getByText(/height/i);
    expect(heightRow).toBeInTheDocument();
    // The height value cell should indicate unavailability
    expect(screen.getByText(/unavailable|not set/i)).toBeInTheDocument();
  });

  it("calls refresh fetch with AbortSignal timeout", async () => {
    mockUseSWRImplementation.mockImplementation((key: string) => {
      if (key === "/api/health-profile") {
        return { data: mockProfileData, error: null, isLoading: false, mutate: mockMutate };
      }
      return { data: null, error: null, isLoading: false };
    });
    mockFetch.mockResolvedValue({ ok: true });
    mockMutate.mockResolvedValue(undefined);

    const { HealthProfileCard } = await import("@/components/health-profile-card");
    render(<HealthProfileCard />);

    const refreshBtn = screen.getByRole("button", { name: /refresh from google health/i });
    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/health-profile?refresh=1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
