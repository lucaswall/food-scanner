/**
 * Extracts a trustworthy client IP address from the X-Forwarded-For header.
 *
 * Railway appends the real client IP to the END of X-Forwarded-For while
 * preserving any client-supplied values at the front. To prevent spoofing,
 * we take the RIGHTMOST non-empty segment — the one Railway added — not the
 * leftmost (which an attacker can inject).
 *
 * Format: "client-supplied, ..., railway-appended-real-ip"
 */
export function getClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (!xff) return "unknown";

  const rightmost = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1);

  return rightmost ?? "unknown";
}
