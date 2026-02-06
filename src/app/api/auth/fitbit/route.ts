import { buildFitbitAuthUrl } from "@/lib/fitbit";
import { buildUrl } from "@/lib/url";
import { logger } from "@/lib/logger";
import { getSession, validateSession, getRawSession } from "@/lib/session";

async function initiateFitbitAuth() {
  const session = await getSession();
  const error = validateSession(session);
  if (error) return error;

  const state = crypto.randomUUID();
  const redirectUri = buildUrl("/api/auth/fitbit/callback");
  const authUrl = buildFitbitAuthUrl(state, redirectUri);

  // Store state in iron-session (encrypted cookie) instead of plain cookie
  const rawSession = await getRawSession();
  rawSession.oauthState = state;
  await rawSession.save();

  logger.info({ action: "fitbit_oauth_start" }, "initiating fitbit oauth");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
    },
  });
}

// POST: from settings page form
export async function POST() {
  return initiateFitbitAuth();
}

// GET: from Google callback redirect
export async function GET() {
  return initiateFitbitAuth();
}
