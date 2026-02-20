'use client';

import { useState } from "react";
import { useSwipeable } from "react-swipeable";
import { useSwipeNavigation } from "@/hooks/use-swipe-navigation";

interface SwipeNavigationWrapperProps {
  children: React.ReactNode;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isDisabled(): boolean {
  if (typeof document === "undefined") return true;
  // Don't swipe when a dialog/modal is open
  if (document.querySelector('[data-state="open"][role="dialog"]')) {
    return true;
  }
  // Don't swipe when a text input or textarea is focused
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") {
    return true;
  }
  return false;
}

export function SwipeNavigationWrapper({ children }: SwipeNavigationWrapperProps) {
  const { currentIndex, canSwipeLeft, canSwipeRight, navigateToTab } =
    useSwipeNavigation();
  const [animationClass, setAnimationClass] = useState<string>("");

  function handleSwipedLeft() {
    if (!canSwipeLeft) return;
    if (isDisabled()) return;
    setAnimationClass(prefersReducedMotion() ? "" : "animate-slide-in-left");
    navigateToTab(currentIndex + 1);
  }

  function handleSwipedRight() {
    if (!canSwipeRight) return;
    if (isDisabled()) return;
    setAnimationClass(prefersReducedMotion() ? "" : "animate-slide-in-right");
    navigateToTab(currentIndex - 1);
  }

  const handlers = useSwipeable({
    onSwipedLeft: handleSwipedLeft,
    onSwipedRight: handleSwipedRight,
    delta: 10,
    trackMouse: false,
  });

  return (
    <div
      {...handlers}
      className={animationClass}
      style={{ touchAction: "pan-y", overscrollBehaviorX: "none" }}
      onAnimationEnd={() => setAnimationClass("")}
    >
      {children}
    </div>
  );
}
