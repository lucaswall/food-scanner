import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PendingSubmissionHandler } from "../pending-submission-handler";
import type { PendingSubmission } from "@/lib/pending-submission";

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock pending-submission
const mockGetPending = vi.fn().mockReturnValue(null);
const mockClearPending = vi.fn();
const mockSavePending = vi.fn();

vi.mock("@/lib/pending-submission", () => ({
  getPendingSubmission: () => mockGetPending(),
  clearPendingSubmission: () => mockClearPending(),
  savePendingSubmission: (...args: unknown[]) => mockSavePending(...args),
}));

// Mock invalidateFoodCaches
const mockInvalidateFoodCaches = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/swr", () => ({
  invalidateFoodCaches: () => mockInvalidateFoodCaches(),
}));

// Mock meal-type for getLocalDateTime fallback
vi.mock("@/lib/meal-type", () => ({
  getLocalDateTime: () => ({ date: "2026-02-07", time: "14:30" }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPending.mockReturnValue(null);
  Object.defineProperty(window, "location", {
    value: { href: "" },
    writable: true,
    configurable: true,
  });
});

describe("PendingSubmissionHandler", () => {
  it("renders nothing when no pending submission exists", () => {
    mockGetPending.mockReturnValue(null);
    const { container } = render(<PendingSubmissionHandler />);
    expect(container.textContent).toBe("");
  });

  it("auto-resubmits when pending submission exists", async () => {
    const pending: PendingSubmission = {
      analysis: null,
      mealTypeId: 3,
      foodName: "Empanada",
      reuseCustomFoodId: 123,
      date: "2026-02-07",
      time: "14:30",
    };

    mockGetPending.mockReturnValue(pending);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { fitbitFoodId: 111, fitbitLogId: 999, reusedFood: true },
        }),
    });

    render(<PendingSubmissionHandler />);

    // Shows "Reconnected! Resubmitting..." message
    await waitFor(() => {
      expect(screen.getByText(/Reconnected! Resubmitting Empanada/i)).toBeInTheDocument();
    });

    // Calls /api/log-food with correct body
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/log-food",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reuseCustomFoodId: 123,
            mealTypeId: 3,
            date: "2026-02-07",
            time: "14:30",
          }),
        })
      );
    });
  });

  it("clears pending and shows success message after successful resubmission", async () => {
    const pending: PendingSubmission = {
      analysis: null,
      mealTypeId: 3,
      foodName: "Empanada",
      reuseCustomFoodId: 123,
    };

    mockGetPending.mockReturnValue(pending);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: { fitbitFoodId: 111, fitbitLogId: 999, reusedFood: true },
        }),
    });

    render(<PendingSubmissionHandler />);

    await waitFor(() => {
      expect(mockClearPending).toHaveBeenCalled();
      expect(mockInvalidateFoodCaches).toHaveBeenCalled();
      expect(screen.getByText(/Successfully resubmitted Empanada/i)).toBeInTheDocument();
    });
  });

  it("re-saves pending and redirects on FITBIT_TOKEN_INVALID error", async () => {
    const pending: PendingSubmission = {
      analysis: null,
      mealTypeId: 3,
      foodName: "Empanada",
      reuseCustomFoodId: 123,
    };

    mockGetPending.mockReturnValue(pending);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          success: false,
          error: { code: "FITBIT_TOKEN_INVALID", message: "Token expired" },
        }),
    });

    render(<PendingSubmissionHandler />);

    await waitFor(() => {
      expect(mockSavePending).toHaveBeenCalledWith(pending);
      expect(window.location.href).toBe("/api/auth/fitbit");
    });
  });

  it("clears pending and shows credentials error on FITBIT_CREDENTIALS_MISSING", async () => {
    const pending: PendingSubmission = {
      analysis: null,
      mealTypeId: 3,
      foodName: "Empanada",
      reuseCustomFoodId: 123,
    };

    mockGetPending.mockReturnValue(pending);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          success: false,
          error: { code: "FITBIT_CREDENTIALS_MISSING", message: "No credentials" },
        }),
    });

    render(<PendingSubmissionHandler />);

    await waitFor(() => {
      expect(mockClearPending).toHaveBeenCalled();
      expect(screen.getByText(/Fitbit is not set up/i)).toBeInTheDocument();
    });
  });

  it("clears pending and shows error on generic error", async () => {
    const pending: PendingSubmission = {
      analysis: null,
      mealTypeId: 3,
      foodName: "Empanada",
      reuseCustomFoodId: 123,
    };

    mockGetPending.mockReturnValue(pending);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () =>
        Promise.resolve({
          success: false,
          error: { code: "UNKNOWN_ERROR", message: "Something went wrong" },
        }),
    });

    render(<PendingSubmissionHandler />);

    await waitFor(() => {
      expect(mockClearPending).toHaveBeenCalled();
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    });
  });

  it("includes analysis metadata when present and reusing", async () => {
    const pending: PendingSubmission = {
      analysis: {
        food_name: "Empanada",
        amount: 150,
        unit_id: 147,
        calories: 320,
        protein_g: 12,
        carbs_g: 28,
        fat_g: 18,
        fiber_g: 2,
        sodium_mg: 450,
        confidence: "high",
        notes: "Test notes",
        description: "Test description",
        keywords: ["test"],
      },
      mealTypeId: 3,
      foodName: "Empanada",
      reuseCustomFoodId: 123,
    };

    mockGetPending.mockReturnValue(pending);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    render(<PendingSubmissionHandler />);

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const body = JSON.parse(calls[0][1].body);
      expect(body.newDescription).toBe("Test description");
      expect(body.newNotes).toBe("Test notes");
      expect(body.newKeywords).toEqual(["test"]);
      expect(body.newConfidence).toBe("high");
    });
  });

  it("includes full analysis when not reusing", async () => {
    const pending: PendingSubmission = {
      analysis: {
        food_name: "Empanada",
        amount: 150,
        unit_id: 147,
        calories: 320,
        protein_g: 12,
        carbs_g: 28,
        fat_g: 18,
        fiber_g: 2,
        sodium_mg: 450,
        confidence: "high",
        notes: "",
        description: "",
        keywords: [],
      },
      mealTypeId: 3,
      foodName: "Empanada",
    };

    mockGetPending.mockReturnValue(pending);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: {} }),
    });

    render(<PendingSubmissionHandler />);

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const body = JSON.parse(calls[0][1].body);
      expect(body.food_name).toBe("Empanada");
      expect(body.calories).toBe(320);
      expect(body.protein_g).toBe(12);
    });
  });
});
