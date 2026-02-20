import { useRouter, usePathname } from "next/navigation";

const TAB_PATHS = [
  "/app",
  "/app/history",
  "/app/analyze",
  "/app/quick-select",
  "/app/chat",
];

interface UseSwipeNavigationResult {
  currentIndex: number;
  canSwipeLeft: boolean;
  canSwipeRight: boolean;
  navigateToTab: (index: number) => void;
}

export function useSwipeNavigation(): UseSwipeNavigationResult {
  const pathname = usePathname();
  const router = useRouter();

  const currentIndex = TAB_PATHS.indexOf(pathname);

  const canSwipeLeft =
    currentIndex !== -1 && currentIndex < TAB_PATHS.length - 1;
  const canSwipeRight = currentIndex > 0;

  function navigateToTab(index: number): void {
    router.replace(TAB_PATHS[index]);
  }

  return { currentIndex, canSwipeLeft, canSwipeRight, navigateToTab };
}
