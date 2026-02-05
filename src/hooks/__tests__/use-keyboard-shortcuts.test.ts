import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "../use-keyboard-shortcuts";

describe("useKeyboardShortcuts", () => {
  let handlers: {
    onAnalyze?: () => void;
    onLogToFitbit?: () => void;
    onExitEditMode?: () => void;
  };

  beforeEach(() => {
    handlers = {
      onAnalyze: vi.fn(),
      onLogToFitbit: vi.fn(),
      onExitEditMode: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function dispatchKeyboardEvent(
    key: string,
    options: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {}
  ) {
    const event = new KeyboardEvent("keydown", {
      key,
      ctrlKey: options.ctrlKey || false,
      shiftKey: options.shiftKey || false,
      metaKey: options.metaKey || false,
      bubbles: true,
    });
    document.dispatchEvent(event);
  }

  describe("Ctrl+Enter (analyze)", () => {
    it("triggers onAnalyze when Ctrl+Enter pressed and canAnalyze is true", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          ...handlers,
          canAnalyze: true,
          canLog: false,
          isEditing: false,
        })
      );

      dispatchKeyboardEvent("Enter", { ctrlKey: true });

      expect(handlers.onAnalyze).toHaveBeenCalledTimes(1);
    });

    it("does not trigger onAnalyze when canAnalyze is false", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          ...handlers,
          canAnalyze: false,
          canLog: false,
          isEditing: false,
        })
      );

      dispatchKeyboardEvent("Enter", { ctrlKey: true });

      expect(handlers.onAnalyze).not.toHaveBeenCalled();
    });

    it("works with Cmd+Enter on Mac (metaKey)", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          ...handlers,
          canAnalyze: true,
          canLog: false,
          isEditing: false,
        })
      );

      dispatchKeyboardEvent("Enter", { metaKey: true });

      expect(handlers.onAnalyze).toHaveBeenCalledTimes(1);
    });
  });

  describe("Ctrl+Shift+Enter (log to Fitbit)", () => {
    it("triggers onLogToFitbit when Ctrl+Shift+Enter pressed and canLog is true", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          ...handlers,
          canAnalyze: false,
          canLog: true,
          isEditing: false,
        })
      );

      dispatchKeyboardEvent("Enter", { ctrlKey: true, shiftKey: true });

      expect(handlers.onLogToFitbit).toHaveBeenCalledTimes(1);
    });

    it("does not trigger onLogToFitbit when canLog is false", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          ...handlers,
          canAnalyze: true,
          canLog: false,
          isEditing: false,
        })
      );

      dispatchKeyboardEvent("Enter", { ctrlKey: true, shiftKey: true });

      expect(handlers.onLogToFitbit).not.toHaveBeenCalled();
    });

    it("works with Cmd+Shift+Enter on Mac (metaKey)", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          ...handlers,
          canAnalyze: false,
          canLog: true,
          isEditing: false,
        })
      );

      dispatchKeyboardEvent("Enter", { metaKey: true, shiftKey: true });

      expect(handlers.onLogToFitbit).toHaveBeenCalledTimes(1);
    });
  });

  describe("Escape (exit edit mode)", () => {
    it("triggers onExitEditMode when Escape pressed and isEditing is true", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          ...handlers,
          canAnalyze: false,
          canLog: false,
          isEditing: true,
        })
      );

      dispatchKeyboardEvent("Escape");

      expect(handlers.onExitEditMode).toHaveBeenCalledTimes(1);
    });

    it("does not trigger onExitEditMode when isEditing is false", () => {
      renderHook(() =>
        useKeyboardShortcuts({
          ...handlers,
          canAnalyze: false,
          canLog: false,
          isEditing: false,
        })
      );

      dispatchKeyboardEvent("Escape");

      expect(handlers.onExitEditMode).not.toHaveBeenCalled();
    });
  });

  describe("cleanup", () => {
    it("removes event listener on unmount", () => {
      const removeEventListenerSpy = vi.spyOn(document, "removeEventListener");

      const { unmount } = renderHook(() =>
        useKeyboardShortcuts({
          ...handlers,
          canAnalyze: true,
          canLog: false,
          isEditing: false,
        })
      );

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function)
      );
    });
  });
});
