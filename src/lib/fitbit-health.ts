import type { FitbitHealthStatus } from "@/types";
import { getFitbitCredentials } from "@/lib/fitbit-credentials";
import { getFitbitTokens } from "@/lib/fitbit-tokens";
import { FITBIT_REQUIRED_SCOPES } from "@/lib/fitbit";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

/**
 * Check the Fitbit connection health for a user.
 * Local DB reads only — no Fitbit API calls.
 */
export async function checkFitbitHealth(userId: string, log?: Logger): Promise<FitbitHealthStatus> {
  const l = log ?? logger;

  const credentials = await getFitbitCredentials(userId, l);
  if (!credentials) {
    return { status: "needs_setup" };
  }

  const tokenRow = await getFitbitTokens(userId, l);
  if (!tokenRow) {
    return { status: "needs_reconnect" };
  }

  // Null scope = legacy token from before scope tracking — treat as "nutrition activity" only
  const scopeString = tokenRow.scope ?? "nutrition activity";
  const grantedScopes = new Set(scopeString.split(/\s+/).filter(Boolean));
  const missingScopes = FITBIT_REQUIRED_SCOPES.filter((s) => !grantedScopes.has(s));

  if (missingScopes.length > 0) {
    return { status: "scope_mismatch", missingScopes };
  }

  return { status: "healthy" };
}
