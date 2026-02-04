import { getIronSession } from "iron-session";
import { exchangeGoogleCode, getGoogleProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { sessionOptions } from "@/lib/session";
import { buildUrl } from "@/lib/url";
import type { SessionData } from "@/types";

function getCookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = getCookieValue(request, "google-oauth-state");

  if (!code || !state || state !== storedState) {
    return errorResponse("VALIDATION_ERROR", "Invalid OAuth state", 400);
  }

  const redirectUri = buildUrl("/api/auth/google/callback");

  let tokens: { access_token: string };
  try {
    tokens = await exchangeGoogleCode(code, redirectUri);
  } catch {
    return errorResponse("VALIDATION_ERROR", "Failed to exchange authorization code", 400);
  }

  let profile: { email: string; name: string };
  try {
    profile = await getGoogleProfile(tokens.access_token);
  } catch {
    return errorResponse("VALIDATION_ERROR", "Failed to fetch user profile", 400);
  }

  if (profile.email !== process.env.ALLOWED_EMAIL) {
    return errorResponse("AUTH_INVALID_EMAIL", "Unauthorized email address", 403);
  }

  // Create session
  const responseHeaders = new Headers();
  const session = await getIronSession<SessionData>(
    { headers: responseHeaders } as never,
    sessionOptions,
  );

  session.sessionId = crypto.randomUUID();
  session.email = profile.email;
  session.createdAt = Date.now();
  session.expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  await session.save();

  // Clear the OAuth state cookie
  responseHeaders.append(
    "Set-Cookie",
    "google-oauth-state=; Path=/; HttpOnly; Max-Age=0",
  );

  // Redirect: if no Fitbit tokens, go to Fitbit OAuth; otherwise /app
  const redirectTo = session.fitbit ? "/app" : "/api/auth/fitbit";
  responseHeaders.set("Location", buildUrl(redirectTo));

  return new Response(null, {
    status: 302,
    headers: responseHeaders,
  });
}
