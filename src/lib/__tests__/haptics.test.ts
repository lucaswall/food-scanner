import { describe, it, expect, vi, beforeEach } from "vitest";
import { vibrateSuccess, vibrateError } from "../haptics";

describe("haptics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("vibrateSuccess", () => {
    it("calls navigator.vibrate with 200ms duration", () => {
      const mockVibrate = vi.fn().mockReturnValue(true);
      vi.stubGlobal("navigator", { vibrate: mockVibrate });

      vibrateSuccess();

      expect(mockVibrate).toHaveBeenCalledWith(200);
    });

    it("handles missing Vibration API gracefully", () => {
      vi.stubGlobal("navigator", {});

      // Should not throw
      expect(() => vibrateSuccess()).not.toThrow();
    });

    it("handles undefined navigator gracefully", () => {
      vi.stubGlobal("navigator", undefined);

      // Should not throw
      expect(() => vibrateSuccess()).not.toThrow();
    });
  });

  describe("vibrateError", () => {
    it("calls navigator.vibrate with [100, 50, 100] pattern", () => {
      const mockVibrate = vi.fn().mockReturnValue(true);
      vi.stubGlobal("navigator", { vibrate: mockVibrate });

      vibrateError();

      expect(mockVibrate).toHaveBeenCalledWith([100, 50, 100]);
    });

    it("handles missing Vibration API gracefully", () => {
      vi.stubGlobal("navigator", {});

      // Should not throw
      expect(() => vibrateError()).not.toThrow();
    });

    it("handles undefined navigator gracefully", () => {
      vi.stubGlobal("navigator", undefined);

      // Should not throw
      expect(() => vibrateError()).not.toThrow();
    });
  });
});
