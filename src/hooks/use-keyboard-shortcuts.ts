import { useEffect, useCallback } from "react";

interface UseKeyboardShortcutsOptions {
  onAnalyze?: () => void;
  onLogFood?: () => void;
  canAnalyze: boolean;
  canLog: boolean;
}

/**
 * Custom hook for handling keyboard shortcuts in the food analyzer.
 *
 * Shortcuts:
 * - Ctrl/Cmd + Enter: Trigger analysis (when photos are present)
 * - Ctrl/Cmd + Shift + Enter: Log to Fitbit (when analysis is present)
 */
export function useKeyboardShortcuts({
  onAnalyze,
  onLogFood,
  canAnalyze,
  canLog,
}: UseKeyboardShortcutsOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;

      // Ctrl/Cmd + Shift + Enter: Log to Fitbit
      if (isCtrlOrCmd && event.shiftKey && event.key === "Enter") {
        if (canLog && onLogFood) {
          event.preventDefault();
          onLogFood();
        }
        return;
      }

      // Ctrl/Cmd + Enter: Analyze
      if (isCtrlOrCmd && event.key === "Enter") {
        if (canAnalyze && onAnalyze) {
          event.preventDefault();
          onAnalyze();
        }
        return;
      }
    },
    [canAnalyze, canLog, onAnalyze, onLogFood]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}
