import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { FoodAnalysis, CaptureItem } from "@/types";
import type { StreamEvent } from "@/lib/sse";

// --- Mocks ---

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

const mockGetCaptureBlobs = vi.fn();
const mockClearSession = vi.fn();
const mockRemoveCapture = vi.fn();

const defaultCaptureSession = {
  state: {
    sessionId: "sess-1",
    captures: [] as CaptureItem[],
    isActive: false,
  },
  actions: {
    startSession: vi.fn(),
    addCapture: vi.fn(),
    removeCapture: mockRemoveCapture,
    clearSession: mockClearSession,
    getCaptureBlobs: mockGetCaptureBlobs,
  },
  isRestoring: false,
  expiredCount: 0,
};

vi.mock("@/hooks/use-capture-session", () => ({
  useCaptureSession: vi.fn(() => defaultCaptureSession),
}));

const mockInvalidateSavedAnalysesCaches = vi.fn().mockResolvedValue([]);
vi.mock("@/lib/swr", () => ({
  invalidateSavedAnalysesCaches: () => mockInvalidateSavedAnalysesCaches(),
  apiFetcher: vi.fn(),
  ApiError: class ApiError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after mocks are in place
import { CaptureTriage } from "../capture-triage";
import { useCaptureSession } from "@/hooks/use-capture-session";

// --- Helpers ---

const makeCapture = (overrides: Partial<CaptureItem> = {}): CaptureItem => ({
  id: "cap-1",
  imageCount: 1,
  note: "Lunch at restaurant",
  capturedAt: new Date().toISOString(),
  order: 0,
  ...overrides,
});

const makeFoodAnalysis = (overrides: Partial<FoodAnalysis> = {}): FoodAnalysis => ({
  food_name: "Pasta",
  amount: 300,
  unit_id: 147,
  calories: 620,
  protein_g: 45,
  carbs_g: 30,
  fat_g: 28,
  saturated_fat_g: 8,
  trans_fat_g: 0,
  fiber_g: 3,
  sodium_mg: 800,
  sugars_g: 4,
  calories_from_fat: null,
  confidence: "high",
  notes: "",
  description: "Pasta dish",
  keywords: ["pasta"],
  time: "12:30",
  mealTypeId: 3,
  date: "2026-04-09",
  ...overrides,
});

function makeSSEResponse(events: StreamEvent[], ok = true) {
  const encoder = new TextEncoder();
  const data = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const encoded = encoder.encode(data);

  let readCalled = false;
  const mockReader = {
    read: vi.fn().mockImplementation(() => {
      if (!readCalled) {
        readCalled = true;
        return Promise.resolve({ done: false as const, value: encoded });
      }
      return Promise.resolve({ done: true as const, value: undefined });
    }),
    releaseLock: vi.fn(),
    cancel: vi.fn().mockResolvedValue(undefined),
  };

  return {
    ok,
    status: ok ? 200 : 500,
    headers: new Headers({ "Content-Type": "text/event-stream" }),
    body: { getReader: () => mockReader },
  };
}

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  mockInvalidateSavedAnalysesCaches.mockResolvedValue([]);
  mockClearSession.mockResolvedValue(undefined);
  mockGetCaptureBlobs.mockResolvedValue([new Blob(["img"], { type: "image/jpeg" })]);
  // Reset to default (no captures)
  vi.mocked(useCaptureSession).mockReturnValue(defaultCaptureSession);
});

// --- Tests ---

describe("CaptureTriage", () => {
  describe("empty state", () => {
    it("redirects to /app when no captures exist and not restoring", async () => {
      vi.mocked(useCaptureSession).mockReturnValue({
        ...defaultCaptureSession,
        state: { sessionId: null, captures: [], isActive: false },
        isRestoring: false,
      });

      await act(async () => {
        render(<CaptureTriage />);
      });

      expect(mockReplace).toHaveBeenCalledWith("/app");
    });

    it("does not redirect while still restoring", async () => {
      vi.mocked(useCaptureSession).mockReturnValue({
        ...defaultCaptureSession,
        state: { sessionId: null, captures: [], isActive: false },
        isRestoring: true,
      });

      await act(async () => {
        render(<CaptureTriage />);
      });

      expect(mockReplace).not.toHaveBeenCalled();
    });
  });

  describe("preview state", () => {
    it("shows capture cards with notes when captures exist", async () => {
      vi.mocked(useCaptureSession).mockReturnValue({
        ...defaultCaptureSession,
        state: {
          sessionId: "sess-1",
          captures: [
            makeCapture({ id: "cap-1", note: "Morning coffee" }),
            makeCapture({ id: "cap-2", note: "Lunch plate", order: 1 }),
          ],
          isActive: true,
        },
      });

      await act(async () => {
        render(<CaptureTriage />);
      });

      expect(screen.getByText("Morning coffee")).toBeInTheDocument();
      expect(screen.getByText("Lunch plate")).toBeInTheDocument();
    });

    it("shows 'Analyze All' button in preview state", async () => {
      vi.mocked(useCaptureSession).mockReturnValue({
        ...defaultCaptureSession,
        state: {
          sessionId: "sess-1",
          captures: [makeCapture()],
          isActive: true,
        },
      });

      await act(async () => {
        render(<CaptureTriage />);
      });

      expect(screen.getByTestId("analyze-all-btn")).toBeInTheDocument();
    });
  });

  describe("analyze flow", () => {
    const capturesWithItems = [
      makeCapture({ id: "cap-1", note: "Lunch", imageCount: 2 }),
    ];

    beforeEach(() => {
      vi.mocked(useCaptureSession).mockReturnValue({
        ...defaultCaptureSession,
        state: {
          sessionId: "sess-1",
          captures: capturesWithItems,
          isActive: true,
        },
      });
    });

    it("shows loading state during analysis", async () => {
      // Never resolves the stream so we stay in loading
      let resolveRead: (v: { done: boolean; value: undefined }) => void;
      const pendingRead = new Promise<{ done: boolean; value: undefined }>((res) => {
        resolveRead = res;
      });
      mockFetch.mockResolvedValue({
        ok: true,
        headers: new Headers({ "Content-Type": "text/event-stream" }),
        body: {
          getReader: () => ({
            read: vi.fn().mockReturnValue(pendingRead),
            releaseLock: vi.fn(),
            cancel: vi.fn().mockResolvedValue(undefined),
          }),
        },
      });

      await act(async () => {
        render(<CaptureTriage />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("analyze-all-btn"));
      });

      expect(screen.getByTestId("analyzing-state")).toBeInTheDocument();
      resolveRead!({ done: true, value: undefined });
    });

    it("sends images to process-captures API when Analyze All is clicked", async () => {
      const sessionItems = [makeFoodAnalysis()];
      mockFetch.mockResolvedValue(
        makeSSEResponse([
          { type: "text_delta", text: "Found your meal" },
          { type: "session_items", items: sessionItems },
          { type: "done" },
        ])
      );

      await act(async () => {
        render(<CaptureTriage />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("analyze-all-btn"));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/process-captures",
          expect.objectContaining({ method: "POST" })
        );
      });
    });

    it("displays proposed items list on session_items event", async () => {
      const sessionItems = [
        makeFoodAnalysis({ food_name: "Pizza Margherita" }),
        makeFoodAnalysis({ food_name: "Diet Coke" }),
      ];
      mockFetch.mockResolvedValue(
        makeSSEResponse([
          { type: "text_delta", text: "Here are your items" },
          { type: "session_items", items: sessionItems },
          { type: "done" },
        ])
      );

      await act(async () => {
        render(<CaptureTriage />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("analyze-all-btn"));
      });

      await waitFor(() => {
        expect(screen.getByText("Pizza Margherita")).toBeInTheDocument();
        expect(screen.getByText("Diet Coke")).toBeInTheDocument();
      });
    });

    it("shows 'Approve & Save' button after analysis completes", async () => {
      const sessionItems = [makeFoodAnalysis()];
      mockFetch.mockResolvedValue(
        makeSSEResponse([
          { type: "session_items", items: sessionItems },
          { type: "done" },
        ])
      );

      await act(async () => {
        render(<CaptureTriage />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("analyze-all-btn"));
      });

      await waitFor(() => {
        expect(screen.getByTestId("approve-save-btn")).toBeInTheDocument();
      });
    });
  });

  describe("chat refinement", () => {
    async function renderWithResults(items: FoodAnalysis[]) {
      vi.mocked(useCaptureSession).mockReturnValue({
        ...defaultCaptureSession,
        state: {
          sessionId: "sess-1",
          captures: [makeCapture()],
          isActive: true,
        },
      });

      // First call: process-captures
      mockFetch.mockResolvedValueOnce(
        makeSSEResponse([
          { type: "session_items", items },
          { type: "done" },
        ])
      );

      await act(async () => {
        render(<CaptureTriage />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("analyze-all-btn"));
      });

      await waitFor(() => {
        expect(screen.getByTestId("approve-save-btn")).toBeInTheDocument();
      });
    }

    it("chat input sends message to chat-captures API", async () => {
      const initialItems = [makeFoodAnalysis()];
      await renderWithResults(initialItems);

      // Second call: chat-captures
      const updatedItems = [makeFoodAnalysis({ food_name: "Updated Pasta" })];
      mockFetch.mockResolvedValueOnce(
        makeSSEResponse([
          { type: "session_items", items: updatedItems },
          { type: "done" },
        ])
      );

      const chatInput = screen.getByTestId("chat-input");
      await act(async () => {
        fireEvent.change(chatInput, { target: { value: "Add more protein" } });
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("chat-send-btn"));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/chat-captures",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("Add more protein"),
          })
        );
      });
    });

    it("updated session_items replaces displayed list", async () => {
      const initialItems = [makeFoodAnalysis({ food_name: "Old Pasta" })];
      await renderWithResults(initialItems);

      const updatedItems = [makeFoodAnalysis({ food_name: "Updated Pasta" })];
      mockFetch.mockResolvedValueOnce(
        makeSSEResponse([
          { type: "session_items", items: updatedItems },
          { type: "done" },
        ])
      );

      const chatInput = screen.getByTestId("chat-input");
      await act(async () => {
        fireEvent.change(chatInput, { target: { value: "Change it" } });
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("chat-send-btn"));
      });

      await waitFor(() => {
        expect(screen.getByText("Updated Pasta")).toBeInTheDocument();
        expect(screen.queryByText("Old Pasta")).not.toBeInTheDocument();
      });
    });
  });

  describe("approval flow", () => {
    async function renderAtApproveState(items: FoodAnalysis[]) {
      vi.mocked(useCaptureSession).mockReturnValue({
        ...defaultCaptureSession,
        state: {
          sessionId: "sess-1",
          captures: [makeCapture()],
          isActive: true,
        },
      });

      mockFetch.mockResolvedValueOnce(
        makeSSEResponse([
          { type: "session_items", items },
          { type: "done" },
        ])
      );

      await act(async () => {
        render(<CaptureTriage />);
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("analyze-all-btn"));
      });

      await waitFor(() => {
        expect(screen.getByTestId("approve-save-btn")).toBeInTheDocument();
      });
    }

    it("calls bulk save endpoint on Approve & Save click", async () => {
      const items = [makeFoodAnalysis()];
      await renderAtApproveState(items);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { items: [{ id: 1, createdAt: new Date().toISOString() }] },
          timestamp: Date.now(),
        }),
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("approve-save-btn"));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/saved-analyses/bulk",
          expect.objectContaining({
            method: "POST",
            body: expect.stringContaining("Pasta"),
          })
        );
      });
    });

    it("clears session and invalidates caches on save success", async () => {
      const items = [makeFoodAnalysis()];
      await renderAtApproveState(items);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { items: [{ id: 1, createdAt: new Date().toISOString() }] },
          timestamp: Date.now(),
        }),
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("approve-save-btn"));
      });

      await waitFor(() => {
        expect(mockClearSession).toHaveBeenCalled();
        expect(mockInvalidateSavedAnalysesCaches).toHaveBeenCalled();
      });
    });

    it("shows success banner after save", async () => {
      const items = [makeFoodAnalysis(), makeFoodAnalysis({ food_name: "Salad" })];
      await renderAtApproveState(items);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            items: [
              { id: 1, createdAt: new Date().toISOString() },
              { id: 2, createdAt: new Date().toISOString() },
            ],
          },
          timestamp: Date.now(),
        }),
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("approve-save-btn"));
      });

      await waitFor(() => {
        expect(screen.getByTestId("save-success-banner")).toBeInTheDocument();
      });
    });

    it("shows error banner on API failure", async () => {
      const items = [makeFoodAnalysis()];
      await renderAtApproveState(items);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Server error" },
          timestamp: Date.now(),
        }),
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("approve-save-btn"));
      });

      await waitFor(() => {
        expect(screen.getByTestId("error-banner")).toBeInTheDocument();
      });
    });
  });
});
