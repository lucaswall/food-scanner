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
  it("returns null when loading", () => {
    mockUseSWR.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
      mutate: vi.fn(),
    });

    const { container } = render(<LumenBanner />);
    expect(container.innerHTML).toBe("");
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
});
