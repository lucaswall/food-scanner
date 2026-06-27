import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Detects transient browser network/connectivity failures thrown by fetch().
 * Each engine words these differently:
 *   - Chrome/Edge: "Failed to fetch"
 *   - Safari/WebKit: "Load failed"   (FOOD-SCANNER-X)
 *   - Firefox: "NetworkError when attempting to fetch resource."
 * These are connectivity blips (offline, device sleep, dropped connection), not
 * application bugs — callers should show a retry hint and skip Sentry reporting.
 */
export function isLikelyNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes("network") ||
    msg.includes("failed to fetch") ||
    msg.includes("load failed")
  )
}
