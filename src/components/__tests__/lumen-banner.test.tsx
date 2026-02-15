import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

const mockUseSWR = vi.fn();
vi.mock("swr", () => ({
  default: (...args: unknown[]) => mockUseSWR(...args),
}));

vi.mock("@/lib/swr", () => ({
  apiFetcher: vi.fn(),
}));

const { LumenBanner } = await import("@/components/lumen-banner");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("LumenBanner", () => {
  it("shows skeleton placeholder when loading", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);
    // Skeleton should be present during loading
    const skeleton = document.querySelector('[data-testid="lumen-banner-skeleton"]');
    expect(skeleton).toBeInTheDocument();
  });

  it("shows banner when SWR returns error", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: new Error("fetch failed"),
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);
    // Generous approach: show banner when we can't check goals
    expect(screen.getByText("Set today's macro goals")).toBeInTheDocument();
  });

  it("shows skeleton when data is undefined and no error (transient SWR state)", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);
    // Transient state - show skeleton
    const skeleton = document.querySelector('[data-testid="lumen-banner-skeleton"]');
    expect(skeleton).toBeInTheDocument();
  });

  it("hides banner (returns null) when goals exist for today", () => {
    mockUseSWR.mockReturnValue({
      data: {
        goals: {
          date: "2026-02-10",
          dayType: "Low carb",
          proteinGoal: 120,
          carbsGoal: 50,
          fatGoal: 80,
        },
      },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    const { container } = render(<LumenBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("shows banner with upload prompt when no Lumen goals for today", () => {
    mockUseSWR.mockReturnValue({
      data: { goals: null },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);
    expect(screen.getByText("Set today's macro goals")).toBeInTheDocument();
    expect(screen.getByText("Upload Lumen screenshot")).toBeInTheDocument();
  });

  it("has a hidden file input that accepts image/*", () => {
    mockUseSWR.mockReturnValue({
      data: { goals: null },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);
    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute("accept", "image/*");
    expect(fileInput).toHaveStyle({ display: "none" });
  });

  it("triggers file input when banner is tapped", async () => {
    const user = userEvent.setup();
    mockUseSWR.mockReturnValue({
      data: { goals: null },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");

    const banner = screen.getByText("Set today's macro goals").closest("div");
    expect(banner).toBeInTheDocument();

    await user.click(banner!);
    expect(clickSpy).toHaveBeenCalled();
  });

  it("shows loading spinner during upload", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockImplementation(() =>
      new Promise(() => {}) // Never resolves, keeps loading
    );

    mockUseSWR.mockReturnValue({
      data: { goals: null },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["image"], "lumen.png", { type: "image/png" });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByTestId("upload-spinner")).toBeInTheDocument();
    });
  });

  it("shows error message on upload failure", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Upload failed" } }),
    });

    mockUseSWR.mockReturnValue({
      data: { goals: null },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["image"], "lumen.png", { type: "image/png" });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(/upload failed/i)).toBeInTheDocument();
    });
  });

  it("mutates SWR cache after successful upload", async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          goals: {
            date: "2026-02-10",
            dayType: "Low carb",
            proteinGoal: 120,
            carbsGoal: 50,
            fatGoal: 80,
          },
        },
      }),
    });

    mockUseSWR.mockReturnValue({
      data: { goals: null },
      error: undefined,
      isLoading: false,
      mutate: mockMutate,
    });

    render(<LumenBanner />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["image"], "lumen.png", { type: "image/png" });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalled();
    });
  });

  it("includes date field in POST FormData matching client-side today", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { goals: null } }),
    });
    global.fetch = mockFetch;

    mockUseSWR.mockReturnValue({
      data: { goals: null },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["image"], "lumen.png", { type: "image/png" });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    const formData = mockFetch.mock.calls[0][1].body as FormData;
    const dateValue = formData.get("date");

    // Compute expected date client-side (same logic as getTodayDate)
    const now = new Date();
    const expectedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    expect(dateValue).toBe(expectedDate);
  });

  it("resets file input value even when upload fails", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Server error" } }),
    });

    mockUseSWR.mockReturnValue({
      data: { goals: null },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["image"], "lumen.png", { type: "image/png" });

    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });

    // File input should be reset even on error, so user can re-select the same file
    expect(fileInput.value).toBe("");
  });

  it("renders upload prompt as a proper button element with accessible attributes", async () => {
    const user = userEvent.setup();
    mockUseSWR.mockReturnValue({
      data: { goals: null },
      error: undefined,
      isLoading: false,
      mutate: vi.fn(),
    });

    render(<LumenBanner />);

    // Should be a button element
    const button = screen.getByRole("button", {
      name: /upload lumen screenshot to set today's macro goals/i,
    });
    expect(button).toBeInTheDocument();
    expect(button.tagName).toBe("BUTTON");

    // Button should be focusable
    button.focus();
    expect(document.activeElement).toBe(button);

    // Clicking the button should trigger the file input
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(fileInput, "click");

    await user.click(button);
    expect(clickSpy).toHaveBeenCalled();
  });
});
