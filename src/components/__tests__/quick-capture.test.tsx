import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { CaptureItem } from "@/types";

// ResizeObserver for Radix UI AlertDialog
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

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/image to render a plain <img> in tests
vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => {
    const { fill, unoptimized, ...rest } = props;
    void fill;
    void unoptimized;
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...rest} />;
  },
}));

const mockActions = {
  startSession: vi.fn(),
  addCapture: vi.fn(),
  removeCapture: vi.fn(),
  clearSession: vi.fn(),
  getCaptureBlobs: vi.fn(),
};

const { useCaptureSession: mockUseCaptureSession } = vi.hoisted(() => ({
  useCaptureSession: vi.fn(),
}));

vi.mock("@/hooks/use-capture-session", () => ({
  useCaptureSession: mockUseCaptureSession,
}));

import { QuickCapture } from "../quick-capture";

function makeCapture(overrides: Partial<CaptureItem> = {}): CaptureItem {
  return {
    id: "c1",
    imageCount: 2,
    note: "lunch",
    capturedAt: new Date().toISOString(),
    order: 0,
    ...overrides,
  };
}

function setupMockHook(captures: CaptureItem[] = [], sessionId: string | null = null) {
  mockUseCaptureSession.mockReturnValue({
    state: { sessionId, captures, isActive: sessionId !== null },
    actions: mockActions,
    isRestoring: false,
    expiredCount: 0,
  });
}

describe("QuickCapture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActions.addCapture.mockResolvedValue(undefined);
    mockActions.getCaptureBlobs.mockResolvedValue([]);
    setupMockHook();
  });

  it("renders empty state and auto-starts session on mount", async () => {
    const { unmount } = render(<QuickCapture />);

    await act(async () => {});

    expect(mockActions.startSession).toHaveBeenCalled();
    unmount();
  });

  it("shows Quick Capture title", () => {
    setupMockHook([], "session-1");
    render(<QuickCapture />);
    expect(screen.getByText("Quick Capture")).toBeInTheDocument();
  });

  it("shows capture list with notes after adding captures", async () => {
    const captures = [
      makeCapture({ id: "c1", note: "lunch items", order: 0 }),
      makeCapture({ id: "c2", note: null, order: 1 }),
    ];
    setupMockHook(captures, "session-1");
    render(<QuickCapture />);

    await act(async () => {});

    expect(screen.getByText("lunch items")).toBeInTheDocument();
    // Capture count badge shows 2
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it('"Done" button navigates to /app', async () => {
    setupMockHook([makeCapture()], "session-1");
    render(<QuickCapture />);

    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(mockPush).toHaveBeenCalledWith("/app");
  });

  it('"Process Captures" button navigates to /app/process-captures', async () => {
    setupMockHook([makeCapture()], "session-1");
    render(<QuickCapture />);

    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /process captures/i }));
    expect(mockPush).toHaveBeenCalledWith("/app/process-captures");
  });

  it("delete button calls removeCapture with capture id", async () => {
    const captures = [makeCapture({ id: "c1", note: "my meal" })];
    setupMockHook(captures, "session-1");
    render(<QuickCapture />);

    await act(async () => {});

    const deleteBtn = screen.getByRole("button", { name: /delete capture/i });
    fireEvent.click(deleteBtn);
    expect(mockActions.removeCapture).toHaveBeenCalledWith("c1");
  });

  it('"Clear All" button shows AlertDialog confirmation', async () => {
    setupMockHook([makeCapture()], "session-1");
    render(<QuickCapture />);

    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));

    // AlertDialog should appear
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("confirming Clear All calls clearSession", async () => {
    setupMockHook([makeCapture()], "session-1");
    render(<QuickCapture />);

    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(mockActions.clearSession).toHaveBeenCalled();
  });

  it("continues loading thumbnails when getCaptureBlobs throws for one capture", async () => {
    const captures = [
      makeCapture({ id: "c1", note: "first", order: 0 }),
      makeCapture({ id: "c2", note: "second", order: 1 }),
    ];
    mockActions.getCaptureBlobs
      .mockRejectedValueOnce(new Error("IDB error"))
      .mockResolvedValueOnce([new Blob(["img"], { type: "image/jpeg" })]);
    setupMockHook(captures, "session-1");

    render(<QuickCapture />);
    await act(async () => {});

    // Should still render both captures (thumbnail loading failure is silent)
    expect(screen.getByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    // getCaptureBlobs was called for both captures despite first one failing
    expect(mockActions.getCaptureBlobs).toHaveBeenCalledTimes(2);
    // Thumbnail loaded for second capture (success path), not for first (IDB error)
    await waitFor(() => {
      const imgs = screen.getAllByAltText("Capture thumbnail");
      expect(imgs).toHaveLength(1);
      expect(imgs[0]).toHaveAttribute("src", "blob:mock-url");
    });
  });

  // ─── Fix 5: handleSave error handling ────────────────────────────────────

  describe("Fix 5: handleSave error handling", () => {
    it("shows error banner and resets isAdding when addCapture throws", async () => {
      setupMockHook([], "session-1");
      mockActions.addCapture.mockRejectedValue(new Error("Storage error"));

      render(<QuickCapture />);
      await act(async () => {});

      // Simulate file selection → isAdding = true
      const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      const file = new File(["content"], "test.jpg", { type: "image/jpeg" });
      Object.defineProperty(fileInput, "files", { value: [file], configurable: true });

      await act(async () => {
        fireEvent.change(fileInput);
      });

      // isAdding = true → Save button is visible
      expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument();

      // Click Save → addCapture rejects
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
      });

      // Error banner should appear
      await waitFor(() => {
        expect(screen.getByText(/failed to save/i)).toBeInTheDocument();
      });

      // isAdding should be reset (Save button is gone)
      expect(screen.queryByRole("button", { name: /^save$/i })).not.toBeInTheDocument();
    });
  });
});
