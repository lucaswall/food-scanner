import { describe, it, expect, vi, beforeEach } from "vitest";
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

const mockGetSession = vi.fn();
vi.mock("@/lib/session", () => ({
  getSession: () => mockGetSession(),
}));

vi.mock("@/components/fitbit-setup-form", () => ({
  FitbitSetupForm: () => <div data-testid="fitbit-setup-form">Fitbit Setup Form</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SetupFitbitPage", () => {
  it("renders the setup form for authenticated users", async () => {
    mockGetSession.mockResolvedValue({
      sessionId: "test-session",
      userId: "user-uuid-123",
      expiresAt: Date.now() + 86400000,
      fitbitConnected: false,
      destroy: vi.fn(),
    });

    const SetupFitbitPage = (await import("@/app/app/setup-fitbit/page")).default;
    const { render, screen } = await import("@testing-library/react");

    render(await SetupFitbitPage());

    expect(screen.getByTestId("fitbit-setup-form")).toBeInTheDocument();
    expect(screen.getByText(/Set Up Fitbit/i)).toBeInTheDocument();
  });

  it("redirects to / if no session", async () => {
    mockGetSession.mockResolvedValue(null);

    const SetupFitbitPage = (await import("@/app/app/setup-fitbit/page")).default;

    await SetupFitbitPage();

    expect(redirect).toHaveBeenCalledWith("/");
  });
});
