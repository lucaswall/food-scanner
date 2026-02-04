import { buildFitbitAuthUrl } from "@/lib/fitbit";
import { buildUrl } from "@/lib/url";
import { logger } from "@/lib/logger";

function initiateFitbitAuth() {
  const state = crypto.randomUUID();
  const redirectUri = buildUrl("/api/auth/fitbit/callback");
  const authUrl = buildFitbitAuthUrl(state, redirectUri);

  logger.info({ action: "fitbit_oauth_start" }, "initiating fitbit oauth");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `fitbit-oauth-state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
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
