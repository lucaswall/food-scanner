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

  // Null scope = treat as no scopes granted
  const scopeString = tokenRow.scope ?? "";
  const grantedScopes = new Set(scopeString.split(/\s+/).filter(Boolean));
  const missingScopes = GOOGLE_HEALTH_SCOPES.filter((s) => !grantedScopes.has(s));

  if (missingScopes.length > 0) {
    return { status: "scope_mismatch", missingScopes };
  }

  return { status: "healthy" };
}
