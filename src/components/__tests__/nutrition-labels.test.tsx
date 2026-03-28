import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { SWRConfig } from "swr";
import { NutritionLabels } from "../nutrition-labels";
import type { NutritionLabel } from "@/types";

// Mock ResizeObserver for Radix UI Dialog
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock safeResponseJson to delegate to response.json()
vi.mock("@/lib/safe-json", () => ({
  safeResponseJson: async (response: { json: () => Promise<unknown> }) => response.json(),
}));

const { mockInvalidateLabelCaches } = vi.hoisted(() => ({
  mockInvalidateLabelCaches: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/swr", async () => {
  const actual = await vi.importActual<typeof import("@/lib/swr")>("@/lib/swr");
  return {
    ...actual,
    invalidateLabelCaches: mockInvalidateLabelCaches,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const sampleLabels: NutritionLabel[] = [
  {
    id: 1,
    userId: "user-uuid-123",
    brand: "Acme Foods",
    productName: "Granola Bar",
    variant: "Chocolate Chip",
    servingSizeG: 40,
    servingSizeLabel: "1 bar (40g)",
    calories: 180,
    proteinG: 4,
    carbsG: 28,
    fatG: 6,
    fiberG: 2,
    sodiumMg: 95,
    saturatedFatG: 2.5,
    transFatG: 0,
    sugarsG: 12,
    extraNutrients: null,
    source: "photo_scan",
    notes: null,
    createdAt: new Date("2026-03-01T10:00:00Z"),
    updatedAt: new Date("2026-03-01T10:00:00Z"),
  },
  {
    id: 2,
    userId: "user-uuid-123",
    brand: "Healthy Co",
    productName: "Protein Powder",
    variant: null,
    servingSizeG: 30,
    servingSizeLabel: "1 scoop (30g)",
    calories: 120,
    proteinG: 25,
    carbsG: 3,
    fatG: 1,
    fiberG: 0,
    sodiumMg: 150,
    saturatedFatG: null,
    transFatG: null,
    sugarsG: 1,
    extraNutrients: null,
    source: "photo_scan",
    notes: null,
    createdAt: new Date("2026-03-02T10:00:00Z"),
    updatedAt: new Date("2026-03-02T10:00:00Z"),
  },
];

function renderNutritionLabels() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NutritionLabels />
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInvalidateLabelCaches.mockResolvedValue(undefined);
});

describe("NutritionLabels", () => {
  it("renders search input with placeholder 'Search labels...'", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: sampleLabels }),
    });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search labels...")).toBeInTheDocument();
    });
  });

  it("renders list of label cards when data is available — shows brand, product name, variant, calories, serving size", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: sampleLabels }),
    });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByText("Acme Foods")).toBeInTheDocument();
      expect(screen.getByText(/Granola Bar/)).toBeInTheDocument();
      expect(screen.getByText(/Chocolate Chip/)).toBeInTheDocument();
      expect(screen.getByText(/180/)).toBeInTheDocument();
      expect(screen.getByText(/1 bar \(40g\)/)).toBeInTheDocument();
    });
  });

  it("shows brand for second label", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: sampleLabels }),
    });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByText("Healthy Co")).toBeInTheDocument();
      expect(screen.getByText(/Protein Powder/)).toBeInTheDocument();
    });
  });

  it("renders empty state 'No nutrition labels yet' when no labels", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByText(/No nutrition labels yet/i)).toBeInTheDocument();
    });
  });

  it("renders empty state explanation text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [] }),
    });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByText(/automatically saved/i)).toBeInTheDocument();
    });
  });

  it("shows delete icon button on each card", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: sampleLabels }),
    });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByText("Acme Foods")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    expect(deleteButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows AlertDialog confirmation before delete", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: sampleLabels }),
    });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByText("Acme Foods")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      expect(screen.getByText(/Delete this label/i)).toBeInTheDocument();
    });
  });

  it("calls DELETE API and invalidates label caches when delete is confirmed", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: sampleLabels }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { deleted: true } }),
      });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByText("Acme Foods")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/nutrition-labels/"),
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(mockInvalidateLabelCaches).toHaveBeenCalled();
    });
  });

  it("shows error when DELETE API returns non-2xx response", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: sampleLabels }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ success: false, error: "Internal error" }),
      });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByText("Acme Foods")).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole("button", { name: /delete/i });
    await act(async () => {
      fireEvent.click(deleteButtons[0]);
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/failed to delete/i)).toBeInTheDocument();
    });
    expect(mockInvalidateLabelCaches).not.toHaveBeenCalled();
  });

  it("opens detail bottom sheet when card body is tapped", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: sampleLabels }),
    });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByText("Acme Foods")).toBeInTheDocument();
    });

    const cardButton = screen.getByRole("button", { name: /^Granola Bar$/ });
    await act(async () => {
      fireEvent.click(cardButton);
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("detail sheet shows full nutrition breakdown", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: [sampleLabels[0]] }),
    });

    renderNutritionLabels();

    await waitFor(() => {
      expect(screen.getByText("Acme Foods")).toBeInTheDocument();
    });

    const cardButton = screen.getByRole("button", { name: /^Granola Bar$/ });
    await act(async () => {
      fireEvent.click(cardButton);
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      // Calories shown in detail
      expect(screen.getAllByText(/180/).length).toBeGreaterThanOrEqual(1);
    });
  });
});
