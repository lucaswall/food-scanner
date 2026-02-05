import { useEffect, useCallback } from "react";

interface UseKeyboardShortcutsOptions {
  onAnalyze?: () => void;
  onLogToFitbit?: () => void;
  onExitEditMode?: () => void;
  canAnalyze: boolean;
  canLog: boolean;
  isEditing: boolean;
}

/**
 * Custom hook for handling keyboard shortcuts in the food analyzer.
 *
 * Shortcuts:
 * - Ctrl/Cmd + Enter: Trigger analysis (when photos are present)
 * - Ctrl/Cmd + Shift + Enter: Log to Fitbit (when analysis is present)
 * - Escape: Exit edit mode (when editing)
 */
export function useKeyboardShortcuts({
  onAnalyze,
  onLogToFitbit,
  onExitEditMode,
  canAnalyze,
  canLog,
  isEditing,
}: UseKeyboardShortcutsOptions): void {
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;

      // Ctrl/Cmd + Shift + Enter: Log to Fitbit
      if (isCtrlOrCmd && event.shiftKey && event.key === "Enter") {
        if (canLog && onLogToFitbit) {
          event.preventDefault();
          onLogToFitbit();
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

      // Escape: Exit edit mode
      if (event.key === "Escape") {
        // Don't intercept Escape if a dialog/modal is open
        const dialogOpen = document.querySelector('[role="alertdialog"], [role="dialog"]');
        if (dialogOpen) return;

        if (isEditing && onExitEditMode) {
          event.preventDefault();
          onExitEditMode();
        }
        return;
      }
    },
    [canAnalyze, canLog, isEditing, onAnalyze, onLogToFitbit, onExitEditMode]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleKeyDown]);
}
