import { buildFitbitAuthUrl } from "@/lib/fitbit";
import { buildUrl } from "@/lib/url";
import { createRequestLogger } from "@/lib/logger";
import { getSession, validateSession, getRawSession } from "@/lib/session";
import { getFitbitCredentials } from "@/lib/fitbit-credentials";

async function initiateFitbitAuth(method: string) {
  const log = createRequestLogger(method, "/api/auth/fitbit");
  const session = await getSession();
  const error = validateSession(session);
  if (error) return error;

  // Load per-user Fitbit credentials
  const credentials = await getFitbitCredentials(session!.userId);
  if (!credentials) {
    // No credentials stored — redirect to setup page
    return new Response(null, {
      status: 302,
      headers: {
        Location: buildUrl("/app/setup-fitbit"),
      },
    });
  }

  const state = crypto.randomUUID();
  const redirectUri = buildUrl("/api/auth/fitbit/callback");
  const authUrl = buildFitbitAuthUrl(state, redirectUri, credentials.clientId);

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
