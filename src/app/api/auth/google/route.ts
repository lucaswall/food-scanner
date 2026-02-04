import { buildGoogleAuthUrl } from "@/lib/auth";
import { buildUrl } from "@/lib/url";
import { logger } from "@/lib/logger";

export async function POST() {
  const state = crypto.randomUUID();
  const redirectUri = buildUrl("/api/auth/google/callback");
  const authUrl = buildGoogleAuthUrl(state, redirectUri);

  logger.info({ action: "google_oauth_start" }, "initiating google oauth");

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `google-oauth-state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
