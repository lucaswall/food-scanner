import { buildFitbitAuthUrl } from "@/lib/fitbit";

function initiateFitbitAuth(request: Request) {
  const state = crypto.randomUUID();
  const redirectUri = new URL(
    "/api/auth/fitbit/callback",
    request.url,
  ).toString();
  const authUrl = buildFitbitAuthUrl(state, redirectUri);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `fitbit-oauth-state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

// POST: from settings page form
export async function POST(request: Request) {
  return initiateFitbitAuth(request);
}

// GET: from Google callback redirect
export async function GET(request: Request) {
  return initiateFitbitAuth(request);
}
