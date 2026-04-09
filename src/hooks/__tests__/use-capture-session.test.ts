import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/lib/capture-session", () => ({
  getActiveCaptureSessionId: vi.fn(),
  createCaptureSessionId: vi.fn(),
  loadCaptureMetadata: vi.fn(),
  saveCaptureMetadata: vi.fn(),
  saveCaptureBlobs: vi.fn(),
  loadCaptureBlobs: vi.fn(),
  deleteCaptureBlobs: vi.fn(),
  clearCaptureSession: vi.fn(),
  cleanupExpiredCaptures: vi.fn(),
  _resetCaptureDBForTesting: vi.fn(),
}));

vi.mock("@/lib/image", () => ({
  compressImage: vi.fn(),
}));

import {
  getActiveCaptureSessionId,
  createCaptureSessionId,
  loadCaptureMetadata,
  saveCaptureMetadata,
  saveCaptureBlobs,
  loadCaptureBlobs,
  deleteCaptureBlobs,
  clearCaptureSession,
  cleanupExpiredCaptures,
} from "@/lib/capture-session";
import { compressImage } from "@/lib/image";
import { useCaptureSession } from "@/hooks/use-capture-session";

const mockGetActiveCaptureSessionId = vi.mocked(getActiveCaptureSessionId);
const mockCreateCaptureSessionId = vi.mocked(createCaptureSessionId);
const mockLoadCaptureMetadata = vi.mocked(loadCaptureMetadata);
const mockSaveCaptureMetadata = vi.mocked(saveCaptureMetadata);
const mockSaveCaptureBlobs = vi.mocked(saveCaptureBlobs);
const mockLoadCaptureBlobs = vi.mocked(loadCaptureBlobs);
const mockDeleteCaptureBlobs = vi.mocked(deleteCaptureBlobs);
const mockClearCaptureSession = vi.mocked(clearCaptureSession);
const mockCleanupExpiredCaptures = vi.mocked(cleanupExpiredCaptures);
const mockCompressImage = vi.mocked(compressImage);

describe("useCaptureSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActiveCaptureSessionId.mockReturnValue(null);
    mockLoadCaptureMetadata.mockReturnValue(null);
    mockCreateCaptureSessionId.mockReturnValue("new-session-id");
    mockCleanupExpiredCaptures.mockResolvedValue({ expiredCount: 0 });
    mockSaveCaptureBlobs.mockResolvedValue(undefined);
    mockLoadCaptureBlobs.mockResolvedValue([]);
    mockDeleteCaptureBlobs.mockResolvedValue(undefined);
    mockClearCaptureSession.mockResolvedValue(undefined);
    mockCompressImage.mockImplementation(async (blob) => blob as Blob);
  });

  it("initial state has no active session", async () => {
    const { result } = renderHook(() => useCaptureSession());

    await act(async () => {});

    expect(result.current.state.sessionId).toBeNull();
    expect(result.current.state.captures).toEqual([]);
    expect(result.current.state.isActive).toBe(false);
    expect(result.current.isRestoring).toBe(false);
  });

  it("startSession creates a new session with empty captures", async () => {
    const { result } = renderHook(() => useCaptureSession());
    await act(async () => {});

    await act(async () => {
      result.current.actions.startSession();
    });

    expect(mockCreateCaptureSessionId).toHaveBeenCalled();
    expect(result.current.state.sessionId).toBe("new-session-id");
    expect(result.current.state.captures).toEqual([]);
    expect(result.current.state.isActive).toBe(true);
  });

  it("startSession reuses existing session when already active", async () => {
    mockGetActiveCaptureSessionId.mockReturnValue("existing-session-id");
    mockLoadCaptureMetadata.mockReturnValue({
      id: "existing-session-id",
      captures: [{ id: "c1", imageCount: 2, note: "lunch", capturedAt: new Date().toISOString(), order: 0 }],
      createdAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useCaptureSession());
    await act(async () => {});

    await act(async () => {
      result.current.actions.startSession();
    });

    // Should not create a new session ID
    expect(mockCreateCaptureSessionId).not.toHaveBeenCalled();
    expect(result.current.state.sessionId).toBe("existing-session-id");
  });

  it("addCapture adds a capture with correct metadata", async () => {
    mockGetActiveCaptureSessionId.mockReturnValue(null);

    const { result } = renderHook(() => useCaptureSession());
    await act(async () => {});

    await act(async () => {
      result.current.actions.startSession();
    });

    const blob = new Blob(["img"], { type: "image/jpeg" });
    await act(async () => {
      await result.current.actions.addCapture([blob], "my note");
    });

    expect(result.current.state.captures).toHaveLength(1);
    expect(result.current.state.captures[0].imageCount).toBe(1);
    expect(result.current.state.captures[0].note).toBe("my note");
    expect(result.current.state.captures[0].order).toBe(0);
    expect(mockSaveCaptureBlobs).toHaveBeenCalled();
    expect(mockSaveCaptureMetadata).toHaveBeenCalled();
  });

  it("addCapture compresses images before storing", async () => {
    const { result } = renderHook(() => useCaptureSession());
    await act(async () => {});

    await act(async () => {
      result.current.actions.startSession();
    });

    const blob = new Blob(["img"], { type: "image/jpeg" });
    await act(async () => {
      await result.current.actions.addCapture([blob], null);
    });

    expect(mockCompressImage).toHaveBeenCalledWith(blob);
  });

  it("removeCapture removes the capture from state and IDB", async () => {
    mockGetActiveCaptureSessionId.mockReturnValue("session-1");
    mockLoadCaptureMetadata.mockReturnValue({
      id: "session-1",
      captures: [
        { id: "c1", imageCount: 1, note: null, capturedAt: new Date().toISOString(), order: 0 },
        { id: "c2", imageCount: 1, note: "food", capturedAt: new Date().toISOString(), order: 1 },
      ],
      createdAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useCaptureSession());
    await act(async () => {});

    await act(async () => {
      result.current.actions.removeCapture("c1");
    });

    expect(result.current.state.captures).toHaveLength(1);
    expect(result.current.state.captures[0].id).toBe("c2");
    expect(mockDeleteCaptureBlobs).toHaveBeenCalledWith("session-1", "c1");
    expect(mockSaveCaptureMetadata).toHaveBeenCalled();
  });

  it("clearSession resets all state", async () => {
    mockGetActiveCaptureSessionId.mockReturnValue("session-1");
    mockLoadCaptureMetadata.mockReturnValue({
      id: "session-1",
      captures: [{ id: "c1", imageCount: 1, note: null, capturedAt: new Date().toISOString(), order: 0 }],
      createdAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useCaptureSession());
    await act(async () => {});

    await act(async () => {
      result.current.actions.clearSession();
    });

    expect(mockClearCaptureSession).toHaveBeenCalledWith("session-1");
    expect(result.current.state.sessionId).toBeNull();
    expect(result.current.state.captures).toEqual([]);
    expect(result.current.state.isActive).toBe(false);
  });

  it("expiredCount reflects expired captures on mount", async () => {
    mockCleanupExpiredCaptures.mockResolvedValue({ expiredCount: 3 });

    const { result } = renderHook(() => useCaptureSession());
    await act(async () => {});

    expect(result.current.expiredCount).toBe(3);
  });

  it("getCaptureBlobs reads blobs from IDB for a specific capture", async () => {
    const blobs = [new Blob(["img"])];
    mockLoadCaptureBlobs.mockResolvedValue(blobs);
    mockGetActiveCaptureSessionId.mockReturnValue("session-1");
    mockLoadCaptureMetadata.mockReturnValue({
      id: "session-1",
      captures: [],
      createdAt: new Date().toISOString(),
    });

    const { result } = renderHook(() => useCaptureSession());
    await act(async () => {});

    let loaded: Blob[] = [];
    await act(async () => {
      loaded = await result.current.actions.getCaptureBlobs("c1");
    });

    expect(mockLoadCaptureBlobs).toHaveBeenCalledWith("session-1", "c1");
    expect(loaded).toEqual(blobs);
  });
});
