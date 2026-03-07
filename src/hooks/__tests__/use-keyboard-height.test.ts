import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useKeyboardHeight } from "../use-keyboard-height";

describe("useKeyboardHeight", () => {
  let mockVisualViewport: {
    height: number;
    offsetTop: number;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockVisualViewport = {
      height: 800,
      offsetTop: 0,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "innerHeight", { value: 800, writable: true });
    Object.defineProperty(window, "visualViewport", {
      value: mockVisualViewport,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 0 when keyboard is closed", () => {
    const { result } = renderHook(() => useKeyboardHeight());
    expect(result.current).toBe(0);
  });

  it("returns keyboard height when viewport shrinks (keyboard opens)", () => {
    const { result } = renderHook(() => useKeyboardHeight());

    // Simulate keyboard opening — viewport shrinks by 300px
    act(() => {
      mockVisualViewport.height = 500;
      const resizeHandler = mockVisualViewport.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === "resize"
      )?.[1];
      resizeHandler?.();
    });

    expect(result.current).toBe(300);
  });

  it("returns 0 when keyboard closes again", () => {
    const { result } = renderHook(() => useKeyboardHeight());

    // Open keyboard
    act(() => {
      mockVisualViewport.height = 500;
      const resizeHandler = mockVisualViewport.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === "resize"
      )?.[1];
      resizeHandler?.();
    });

    expect(result.current).toBe(300);

    // Close keyboard
    act(() => {
      mockVisualViewport.height = 800;
      const resizeHandler = mockVisualViewport.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === "resize"
      )?.[1];
      resizeHandler?.();
    });

    expect(result.current).toBe(0);
  });

  it("accounts for offsetTop in calculation", () => {
    const { result } = renderHook(() => useKeyboardHeight());

    act(() => {
      mockVisualViewport.height = 500;
      mockVisualViewport.offsetTop = 50;
      const resizeHandler = mockVisualViewport.addEventListener.mock.calls.find(
        (call: unknown[]) => call[0] === "resize"
      )?.[1];
      resizeHandler?.();
    });

    // innerHeight(800) - height(500) - offsetTop(50) = 250
    expect(result.current).toBe(250);
  });

  it("cleans up event listener on unmount", () => {
    const { unmount } = renderHook(() => useKeyboardHeight());

    unmount();

    expect(mockVisualViewport.removeEventListener).toHaveBeenCalledWith(
      "resize",
      expect.any(Function)
    );
  });

  it("returns 0 when visualViewport is not available", () => {
    Object.defineProperty(window, "visualViewport", {
      value: null,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useKeyboardHeight());
    expect(result.current).toBe(0);
  });
});
