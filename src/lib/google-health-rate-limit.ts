import { logger as defaultLogger, type Logger } from "@/lib/logger";

export type HealthCallCriticality = "critical" | "important" | "optional";

export interface HealthRateLimitSnapshot {
  cooldownUntil: number;
}

// Per-user 429 cooldown state: userId → cooldownUntil epoch ms
const cooldowns = new Map<string, number>();

/**
 * Default cooldown (ms) when no Retry-After header is present (429) or when a
 * 403 RESOURCE_EXHAUSTED has no backoff hint. 60s is a conservative floor that
 * protects quota without blocking the user for too long on a transient spike.
 */
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Parse the Retry-After header into a cooldown duration in milliseconds.
 * Supports integer seconds and HTTP-date formats (RFC 7231).
 * Returns DEFAULT_COOLDOWN_MS when the header is absent or unparseable.
 */
function parseCooldownMs(response: Response): number {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) {
    const trimmed = retryAfter.trim();

    // Integer seconds form
    if (/^\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10) * 1000;
    }

    // HTTP-date form — Date.parse returns NaN for invalid input
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }
  return DEFAULT_COOLDOWN_MS;
}

/**
 * Record a 403 RESOURCE_EXHAUSTED cooldown.
 *
 * Google Cloud APIs signal quota exhaustion with 403 + a body containing
 * `{ error: { status: "RESOURCE_EXHAUSTED" } }` (no Retry-After header).
 * Uses DEFAULT_COOLDOWN_MS since no backoff hint is available.
 * No-ops when userId is undefined.
 */
export function recordResourceExhaustedCooldown(userId: string, log?: Logger): void {
  if (!userId) return;
  const cooldownMs = DEFAULT_COOLDOWN_MS;
  const cooldownUntil = Date.now() + cooldownMs;
  cooldowns.set(userId, cooldownUntil);

  (log ?? defaultLogger).warn(
    {
      action: "health_resource_exhausted_cooldown",
      userId,
      cooldownMs,
      cooldownUntil,
    },
    `Google Health API 403 RESOURCE_EXHAUSTED; cooling down for ${cooldownMs}ms`,
  );
}

/**
 * Record a 429 response and set a per-user 429 cooldown.
 * No-ops for non-429 responses or when userId is undefined.
 * Logs at warn level when a cooldown is set.
 */
export function recordRateLimitHeaders(
  userId: string | undefined,
  response: Response,
  log?: Logger,
): void {
  if (!userId) return;
  if (response.status !== 429) return;

  const cooldownMs = parseCooldownMs(response);
  const cooldownUntil = Date.now() + cooldownMs;
  cooldowns.set(userId, cooldownUntil);

  (log ?? defaultLogger).warn(
    {
      action: "health_rate_limit_cooldown",
      userId,
      cooldownMs,
      cooldownUntil,
    },
    `Google Health API rate-limited; cooling down for ${cooldownMs}ms`,
  );
}

/**
 * Returns the current rate-limit snapshot for a user, or null if no active cooldown.
 * A cooldown is active only when cooldownUntil > Date.now().
 * Evicts stale (expired) entries on access so the map does not grow unboundedly.
 */
export function getRateLimitSnapshot(
  userId: string,
): HealthRateLimitSnapshot | null {
  const cooldownUntil = cooldowns.get(userId);
  if (cooldownUntil === undefined) return null;
  if (cooldownUntil <= Date.now()) {
    cooldowns.delete(userId); // single-pass eviction
    return null;
  }
  return { cooldownUntil };
}

// ─── Circuit breaker ────────────────────────────────────────────────────────

/**
 * Throws `HEALTH_RATE_LIMIT_LOW` if the call should be blocked during a 429 cooldown.
 * Returns void otherwise.
 *
 * Rules:
 *   - No active cooldown (cold start or elapsed) → allow all.
 *   - In cooldown + 'important' → throw HEALTH_RATE_LIMIT_LOW (blocked, per CLAUDE.md spec).
 *   - In cooldown + 'optional' → throw HEALTH_RATE_LIMIT_LOW.
 *   - In cooldown + 'critical' → allow + warn log.
 *
 * NEVER blocks 'critical' writes — a wrong tuning degrades to extra 429 retries,
 * not lost food logs.
 */
export function assertRateLimitAllowed(
  userId: string,
  criticality: HealthCallCriticality,
  log?: Logger,
): void {
  const snap = getRateLimitSnapshot(userId);
  if (!snap) return; // no active cooldown

  if (criticality === "critical") {
    // Always proceed for critical writes; log so operators see the bypass.
    (log ?? defaultLogger).warn(
      {
        action: "health_breaker_critical_bypass",
        userId,
        criticality,
        cooldownUntil: snap.cooldownUntil,
      },
      "Google Health critical call proceeding during 429 cooldown",
    );
    return;
  }

  // important and optional: reject to protect quota during cooldown window.
  (log ?? defaultLogger).warn(
    {
      action: "health_breaker_reject",
      userId,
      criticality,
      cooldownUntil: snap.cooldownUntil,
    },
    `Google Health circuit breaker rejecting ${criticality} call (in 429 cooldown)`,
  );
  throw new Error("HEALTH_RATE_LIMIT_LOW");
}

/** Test-only: clears all in-memory cooldown state. */
export function _resetForTests(): void {
  cooldowns.clear();
}
