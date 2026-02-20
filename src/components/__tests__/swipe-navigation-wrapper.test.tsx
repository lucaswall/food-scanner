import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SwipeNavigationWrapper } from "../swipe-navigation-wrapper";

// Capture swipeable handlers so we can invoke them in tests
type SwipeableConfig = {
  onSwipedLeft?: () => void;
  onSwipedRight?: () => void;
  delta?: number;
  trackMouse?: boolean;
};
let capturedSwipeableConfig: SwipeableConfig = {};

vi.mock("react-swipeable", () => ({
  useSwipeable: vi.fn((config: SwipeableConfig) => {
    capturedSwipeableConfig = config;
    return {};
  }),
}));

const mockNavigateToTab = vi.fn();

vi.mock("@/hooks/use-swipe-navigation", () => ({
  useSwipeNavigation: vi.fn(),
}));

import { useSwipeNavigation } from "@/hooks/use-swipe-navigation";

function mockSwipeNav(overrides: {
  currentIndex?: number;
  canSwipeLeft?: boolean;
  canSwipeRight?: boolean;
}) {
  vi.mocked(useSwipeNavigation).mockReturnValue({
    currentIndex: overrides.currentIndex ?? 2,
    canSwipeLeft: overrides.canSwipeLeft ?? true,
    canSwipeRight: overrides.canSwipeRight ?? true,
    navigateToTab: mockNavigateToTab,
  });
}

describe("SwipeNavigationWrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedSwipeableConfig = {};
    // Default: can swipe both ways, at index 2 (Analyze)
    mockSwipeNav({ currentIndex: 2, canSwipeLeft: true, canSwipeRight: true });
    // Default: no dialog open, no input focused
    vi.spyOn(document, "querySelector").mockReturnValue(null);
    Object.defineProperty(document, "activeElement", {
      get: () => document.body,
      configurable: true,
    });
    // Default: matchMedia returns no preference for reduced motion
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("renders children", () => {
    render(
      <SwipeNavigationWrapper>
        <div>Test content</div>
      </SwipeNavigationWrapper>
    );
    expect(screen.getByText("Test content")).toBeInTheDocument();
  });

  it("applies touch-action: pan-y on container", () => {
    const { container } = render(
      <SwipeNavigationWrapper>
        <div>Content</div>
      </SwipeNavigationWrapper>
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveStyle({ touchAction: "pan-y" });
  });

  describe("swipe left", () => {
    it("calls navigateToTab with currentIndex + 1 when canSwipeLeft is true", () => {
      mockSwipeNav({ currentIndex: 1, canSwipeLeft: true, canSwipeRight: true });
      render(
        <SwipeNavigationWrapper>
          <div>Content</div>
        </SwipeNavigationWrapper>
      );
      act(() => { capturedSwipeableConfig.onSwipedLeft?.(); });
      expect(mockNavigateToTab).toHaveBeenCalledWith(2);
    });

    it("does not navigate on swipe left when canSwipeLeft is false", () => {
      mockSwipeNav({ currentIndex: 4, canSwipeLeft: false, canSwipeRight: true });
      render(
        <SwipeNavigationWrapper>
          <div>Content</div>
        </SwipeNavigationWrapper>
      );
      capturedSwipeableConfig.onSwipedLeft?.();
      expect(mockNavigateToTab).not.toHaveBeenCalled();
    });
  });

  describe("swipe right", () => {
    it("calls navigateToTab with currentIndex - 1 when canSwipeRight is true", () => {
      mockSwipeNav({ currentIndex: 3, canSwipeLeft: true, canSwipeRight: true });
      render(
        <SwipeNavigationWrapper>
          <div>Content</div>
        </SwipeNavigationWrapper>
      );
      act(() => { capturedSwipeableConfig.onSwipedRight?.(); });
      expect(mockNavigateToTab).toHaveBeenCalledWith(2);
    });

    it("does not navigate on swipe right when canSwipeRight is false", () => {
      mockSwipeNav({ currentIndex: 0, canSwipeLeft: true, canSwipeRight: false });
      render(
        <SwipeNavigationWrapper>
          <div>Content</div>
        </SwipeNavigationWrapper>
      );
      capturedSwipeableConfig.onSwipedRight?.();
      expect(mockNavigateToTab).not.toHaveBeenCalled();
    });
  });

  describe("disable conditions", () => {
    it("does not navigate when a dialog is open", () => {
      vi.spyOn(document, "querySelector").mockReturnValue(
        document.createElement("div")
      );
      render(
        <SwipeNavigationWrapper>
          <div>Content</div>
        </SwipeNavigationWrapper>
      );
      capturedSwipeableConfig.onSwipedLeft?.();
      capturedSwipeableConfig.onSwipedRight?.();
      expect(mockNavigateToTab).not.toHaveBeenCalled();
    });

    it("does not navigate when an INPUT is focused", () => {
      const input = document.createElement("input");
      Object.defineProperty(document, "activeElement", {
        get: () => input,
        configurable: true,
      });
      render(
        <SwipeNavigationWrapper>
          <div>Content</div>
        </SwipeNavigationWrapper>
      );
      capturedSwipeableConfig.onSwipedLeft?.();
      capturedSwipeableConfig.onSwipedRight?.();
      expect(mockNavigateToTab).not.toHaveBeenCalled();
    });

    it("does not navigate when a TEXTAREA is focused", () => {
      const textarea = document.createElement("textarea");
      Object.defineProperty(document, "activeElement", {
        get: () => textarea,
        configurable: true,
      });
      render(
        <SwipeNavigationWrapper>
          <div>Content</div>
        </SwipeNavigationWrapper>
      );
      capturedSwipeableConfig.onSwipedLeft?.();
      capturedSwipeableConfig.onSwipedRight?.();
      expect(mockNavigateToTab).not.toHaveBeenCalled();
    });
  });

  describe("prefers-reduced-motion", () => {
    it("still navigates when prefers-reduced-motion is set (instant, no animation)", () => {
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
      mockSwipeNav({ currentIndex: 1, canSwipeLeft: true, canSwipeRight: true });
      render(
        <SwipeNavigationWrapper>
          <div>Content</div>
        </SwipeNavigationWrapper>
      );
      capturedSwipeableConfig.onSwipedLeft?.();
      // Navigation should still occur, just without animation
      expect(mockNavigateToTab).toHaveBeenCalledWith(2);
    });
  });
});
