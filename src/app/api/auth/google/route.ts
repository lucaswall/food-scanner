import { buildGoogleAuthUrl } from "@/lib/auth";
import { buildUrl } from "@/lib/url";

export async function POST() {
  const state = crypto.randomUUID();
  const redirectUri = buildUrl("/api/auth/google/callback");
  const authUrl = buildGoogleAuthUrl(state, redirectUri);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `google-oauth-state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
