/**
 * Full-page navigation (not a client-side route transition).
 *
 * Required for destinations that are route handlers rather than pages — e.g.
 * `/api/auth/google-health`, which answers with a 302 to Google's consent screen.
 * `router.push()` would try to fetch an RSC payload from that handler and fail.
 */
export function hardNavigate(path: string): void {
  window.location.href = path;
}
