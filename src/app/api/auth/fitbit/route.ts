import { buildFitbitAuthUrl, FITBIT_REQUIRED_SCOPES } from "@/lib/fitbit";
import { buildUrl } from "@/lib/url";
import { createRequestLogger } from "@/lib/logger";
import { getSession, validateSession, getRawSession } from "@/lib/session";
import { getFitbitCredentials } from "@/lib/fitbit-credentials";
import { getFitbitTokens } from "@/lib/fitbit-tokens";

async function initiateFitbitAuth(method: string) {
  const log = createRequestLogger(method, "/api/auth/fitbit");
  const session = await getSession();
  const error = validateSession(session);
  if (error) return error;

  // Load per-user Fitbit credentials
  const credentials = await getFitbitCredentials(session!.userId, log);
  if (!credentials) {
    // No credentials stored — redirect to setup page
    return new Response(null, {
      status: 302,
      headers: {
        Location: buildUrl("/app/setup-fitbit"),
      },
    });
  }

  // Check if existing token row has all required scopes; if not, force re-consent
  const existingTokens = await getFitbitTokens(session!.userId, log);
  let forceConsent = false;
  if (existingTokens) {
    const grantedScopes = new Set((existingTokens.scope ?? "").split(/\s+/).filter(Boolean));
    forceConsent = FITBIT_REQUIRED_SCOPES.some((s) => !grantedScopes.has(s));
  }

  const state = crypto.randomUUID();
  const redirectUri = buildUrl("/api/auth/fitbit/callback");
  const authUrl = buildFitbitAuthUrl(state, redirectUri, credentials.clientId, { forceConsent });

  // Store state in iron-session (encrypted cookie) instead of plain cookie
  const rawSession = await getRawSession();
  rawSession.oauthState = state;
  await rawSession.save();

  log.info({ action: "fitbit_oauth_start" }, "initiating fitbit oauth");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
    },
  });
}

// POST: from settings page form
export async function POST() {
  return initiateFitbitAuth("POST");
}

// GET: from Google callback redirect
export async function GET() {
  return initiateFitbitAuth("GET");
}
