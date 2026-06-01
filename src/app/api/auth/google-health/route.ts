import { buildGoogleHealthAuthUrl } from "@/lib/auth";
import { buildUrl } from "@/lib/url";
import { createRequestLogger } from "@/lib/logger";
import { getSession, validateSession, getRawSession } from "@/lib/session";

async function initiate(request: Request): Promise<Response> {
  const log = createRequestLogger("POST", "/api/auth/google-health");

  const session = await getSession();
  const sessionError = validateSession(session);
  if (sessionError) return sessionError;

  const nonce = crypto.randomUUID();
  const state = JSON.stringify({ nonce, flow: "health-connect" });

  const redirectUri = buildUrl("/api/auth/google/callback");
  const authUrl = buildGoogleHealthAuthUrl(state, redirectUri);

  // Store state in iron-session (encrypted cookie)
  const rawSession = await getRawSession();
  rawSession.oauthState = state;
  await rawSession.save();

  log.info({ action: "google_health_oauth_start" }, "initiating google health oauth");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  return initiate(request);
}

export async function GET(request: Request): Promise<Response> {
  return initiate(request);
}
