/**
 * Navigation tab paths in display order.
 * Used by BottomNav and swipe navigation hook.
 */
export const TAB_PATHS = [
  "/app",
  "/app/analyze",
  "/app/quick-select",
  "/app/chat",
] as const;

/**
 * Full-page navigation to an internal path.
 *
 * Used only where a hard load is required: session expiry, logout, the
 * stale-tab refresh guard (a full load discards the in-memory SWR cache and all
 * client state, which a soft `router.push` would keep), and route-handler
 * destinations such as `/api/auth/google-health` that answer with a redirect. The absolute URL is
 * intentional — it makes the hard-navigation explicit to `no-location-assign-relative-destination`.
 */
export function hardNavigate(path: string): void {
  window.location.href = new URL(path, window.location.origin).href;
}
