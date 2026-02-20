import { useRouter, usePathname } from "next/navigation";
import { TAB_PATHS } from "@/lib/navigation";

interface UseSwipeNavigationResult {
  currentIndex: number;
  canSwipeLeft: boolean;
  canSwipeRight: boolean;
  navigateToTab: (index: number) => void;
}

export function useSwipeNavigation(): UseSwipeNavigationResult {
  const pathname = usePathname();
  const router = useRouter();

  const currentIndex = TAB_PATHS.indexOf(pathname as typeof TAB_PATHS[number]);

  const canSwipeLeft =
    currentIndex !== -1 && currentIndex < TAB_PATHS.length - 1;
  const canSwipeRight = currentIndex > 0;

  function navigateToTab(index: number): void {
    if (index < 0 || index >= TAB_PATHS.length) return;
    router.replace(TAB_PATHS[index]);
  }

  return { currentIndex, canSwipeLeft, canSwipeRight, navigateToTab };
}
