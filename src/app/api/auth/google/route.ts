import { buildGoogleAuthUrl } from "@/lib/auth";

export async function POST(request: Request) {
  const state = crypto.randomUUID();
  const redirectUri = new URL(
    "/api/auth/google/callback",
    request.url,
  ).toString();
  const authUrl = buildGoogleAuthUrl(state, redirectUri);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      "Set-Cookie": `google-oauth-state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}
