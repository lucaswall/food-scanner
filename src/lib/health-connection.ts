import { getHealthTokens } from "@/lib/health-tokens";
import { GOOGLE_HEALTH_SCOPES } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import type { HealthConnectionStatus } from "@/types";

/**
 * Check the Google Health connection status for a user.
 * Local DB reads only — no API calls.
 *
 * Three possible states:
 *   - needs_reconnect: token row missing (no separate "credentials" step for Google OAuth)
 *   - scope_mismatch:  token exists but required scopes are not all granted
 *   - healthy:         token exists and all GOOGLE_HEALTH_SCOPES are granted
 *
 * The "needs_setup" / "credentials_missing" branch is intentionally absent —
 * Google Health uses a single OAuth flow with no separate credential config step.
 */
export async function checkHealthConnection(userId: string, log?: Logger): Promise<HealthConnectionStatus> {
  const l = log ?? logger;

  const tokenRow = await getHealthTokens(userId, l);
  if (!tokenRow) {
    return { status: "needs_reconnect" };
  }

  // A null stored scope is treated as a corrupt/legacy row, NOT as an RFC 6749 §3.3
  // omitted-scope grant. Google's token response ALWAYS returns `scope` for these
  // restricted Google Health scopes (verified against the v4 discovery doc), so the
  // only way `scope` ends up null is a pre-migration row or a callback that failed to
  // persist it. We cannot prove the required scopes were granted, so surface it as
  // needs_reconnect (fail-closed) — a reconnect repopulates the scope correctly. (P2-3)
  if (tokenRow.scope === null) {
    l.warn(
      { action: "health_connection_null_scope", userId },
      "health token row has null scope — treating as needs_reconnect (corrupt/legacy row)",
    );
    return { status: "needs_reconnect" };
  }
  const grantedScopes = new Set(tokenRow.scope.split(/\s+/).filter(Boolean));
  const missingScopes = GOOGLE_HEALTH_SCOPES.filter((s) => !grantedScopes.has(s));

  if (missingScopes.length > 0) {
    return { status: "scope_mismatch", missingScopes };
  }

  return { status: "healthy" };
}
