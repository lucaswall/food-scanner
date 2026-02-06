import { cookies } from "next/headers";
import { exchangeGoogleCode, getGoogleProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { getSession } from "@/lib/session";
import { buildUrl } from "@/lib/url";
import { logger } from "@/lib/logger";
import { getCookieValue } from "@/lib/cookies";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = getCookieValue(request, "google-oauth-state");

  if (!code || !state || state !== storedState) {
    logger.warn({ action: "google_callback_invalid_state" }, "invalid oauth state");
    return errorResponse("VALIDATION_ERROR", "Invalid OAuth state", 400);
  }

  const redirectUri = buildUrl("/api/auth/google/callback");

  let tokens: { access_token: string };
  try {
    tokens = await exchangeGoogleCode(code, redirectUri);
  } catch (error) {
    logger.error(
      { action: "google_token_exchange_error", error: error instanceof Error ? error.message : String(error) },
      "failed to exchange google authorization code",
    );
    return errorResponse("VALIDATION_ERROR", "Failed to exchange authorization code", 400);
  }

  let profile: { email: string; name: string };
  try {
    profile = await getGoogleProfile(tokens.access_token);
  } catch (error) {
    logger.error(
      { action: "google_profile_fetch_error", error: error instanceof Error ? error.message : String(error) },
      "failed to fetch google user profile",
    );
    return errorResponse("VALIDATION_ERROR", "Failed to fetch user profile", 400);
  }

  if (profile.email !== process.env.ALLOWED_EMAIL) {
    logger.warn({ action: "google_unauthorized_email", email: profile.email }, "unauthorized email attempted login");
    return errorResponse("AUTH_INVALID_EMAIL", "Unauthorized email address", 403);
  }

  // Create session using cookies() store
  const session = await getSession();

  session.sessionId = crypto.randomUUID();
  session.email = profile.email;
  session.createdAt = Date.now();
  session.expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  await session.save();

  // Clear the OAuth state cookie
  const cookieStore = await cookies();
  cookieStore.delete("google-oauth-state");

  logger.info({ action: "google_login_success", email: profile.email }, "google login successful");

  // Redirect: if no Fitbit tokens, go to Fitbit OAuth; otherwise /app
  const redirectTo = session.fitbit ? "/app" : "/api/auth/fitbit";
  return Response.redirect(buildUrl(redirectTo), 302);
}
