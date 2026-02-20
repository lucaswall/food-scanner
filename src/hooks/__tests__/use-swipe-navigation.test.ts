import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSwipeNavigation } from "../use-swipe-navigation";

const mockReplace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}));

import { usePathname, useRouter } from "next/navigation";

describe("useSwipeNavigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRouter).mockReturnValue({
      replace: mockReplace,
    } as unknown as ReturnType<typeof useRouter>);
  });

  describe("currentIndex", () => {
    it("returns 0 for /app", () => {
      vi.mocked(usePathname).mockReturnValue("/app");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.currentIndex).toBe(0);
    });

    it("returns 1 for /app/history", () => {
      vi.mocked(usePathname).mockReturnValue("/app/history");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.currentIndex).toBe(1);
    });

    it("returns 2 for /app/analyze", () => {
      vi.mocked(usePathname).mockReturnValue("/app/analyze");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.currentIndex).toBe(2);
    });

    it("returns 3 for /app/quick-select", () => {
      vi.mocked(usePathname).mockReturnValue("/app/quick-select");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.currentIndex).toBe(3);
    });

    it("returns 4 for /app/chat", () => {
      vi.mocked(usePathname).mockReturnValue("/app/chat");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.currentIndex).toBe(4);
    });

    it("returns -1 for /settings", () => {
      vi.mocked(usePathname).mockReturnValue("/settings");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.currentIndex).toBe(-1);
    });

    it("returns -1 for /app/food-detail/123", () => {
      vi.mocked(usePathname).mockReturnValue("/app/food-detail/123");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.currentIndex).toBe(-1);
    });
  });

  describe("canSwipeLeft", () => {
    it("is false when at last tab (index 4)", () => {
      vi.mocked(usePathname).mockReturnValue("/app/chat");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.canSwipeLeft).toBe(false);
    });

    it("is true when not at last tab", () => {
      vi.mocked(usePathname).mockReturnValue("/app");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.canSwipeLeft).toBe(true);
    });

    it("is false when current index is -1", () => {
      vi.mocked(usePathname).mockReturnValue("/settings");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.canSwipeLeft).toBe(false);
    });
  });

  describe("canSwipeRight", () => {
    it("is false when at first tab (index 0)", () => {
      vi.mocked(usePathname).mockReturnValue("/app");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.canSwipeRight).toBe(false);
    });

    it("is true when not at first tab", () => {
      vi.mocked(usePathname).mockReturnValue("/app/history");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.canSwipeRight).toBe(true);
    });

    it("is false when current index is -1", () => {
      vi.mocked(usePathname).mockReturnValue("/settings");
      const { result } = renderHook(() => useSwipeNavigation());
      expect(result.current.canSwipeRight).toBe(false);
    });
  });

  describe("navigateToTab", () => {
    it("calls router.replace with the correct path for a given index", () => {
      vi.mocked(usePathname).mockReturnValue("/app");
      const { result } = renderHook(() => useSwipeNavigation());
      result.current.navigateToTab(1);
      expect(mockReplace).toHaveBeenCalledWith("/app/history");
    });

    it("calls router.replace with /app for index 0", () => {
      vi.mocked(usePathname).mockReturnValue("/app/history");
      const { result } = renderHook(() => useSwipeNavigation());
      result.current.navigateToTab(0);
      expect(mockReplace).toHaveBeenCalledWith("/app");
    });

    it("calls router.replace with /app/chat for index 4", () => {
      vi.mocked(usePathname).mockReturnValue("/app");
      const { result } = renderHook(() => useSwipeNavigation());
      result.current.navigateToTab(4);
      expect(mockReplace).toHaveBeenCalledWith("/app/chat");
    });
  });
});
