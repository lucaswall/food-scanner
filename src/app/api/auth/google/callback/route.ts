import { exchangeGoogleCode, getGoogleProfile } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { getRawSession } from "@/lib/session";
import { buildUrl } from "@/lib/url";
import { createRequestLogger } from "@/lib/logger";
import { createSession } from "@/lib/session-db";
import { getFitbitTokens } from "@/lib/fitbit-tokens";
import { hasFitbitCredentials } from "@/lib/fitbit-credentials";
import { isEmailAllowed } from "@/lib/env";
import { getOrCreateUser } from "@/lib/users";
import { checkRateLimit } from "@/lib/rate-limit";

function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "***";
  return `${email[0]}***${email.slice(atIndex)}`;
}

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/auth/google/callback");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { allowed } = checkRateLimit(`google-callback:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!allowed) {
    log.warn({ action: "rate_limit_exceeded", ip, endpoint: "google_callback" }, "rate limit exceeded");
    return errorResponse("RATE_LIMIT_EXCEEDED", "Too many requests", 429);
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Read OAuth state from iron-session instead of plain cookie
  const rawSession = await getRawSession();
  const storedState = rawSession.oauthState;

  if (!code || !state || state !== storedState) {
    log.warn({ action: "google_callback_invalid_state" }, "invalid oauth state");
    return errorResponse("VALIDATION_ERROR", "Invalid OAuth state", 400);
  }

  // Consume OAuth state immediately after validation
  delete rawSession.oauthState;
  await rawSession.save();

  const redirectUri = buildUrl("/api/auth/google/callback");

  let tokens: { access_token: string };
  try {
    tokens = await exchangeGoogleCode(code, redirectUri);
  } catch (error) {
    log.error(
      { action: "google_token_exchange_error", error: error instanceof Error ? error.message : String(error) },
      "failed to exchange google authorization code",
    );
    return errorResponse("VALIDATION_ERROR", "Failed to exchange authorization code", 400);
  }

  let profile: { email: string; name: string };
  try {
    profile = await getGoogleProfile(tokens.access_token);
  } catch (error) {
    log.error(
      { action: "google_profile_fetch_error", error: error instanceof Error ? error.message : String(error) },
      "failed to fetch google user profile",
    );
    return errorResponse("VALIDATION_ERROR", "Failed to fetch user profile", 400);
  }

  if (!isEmailAllowed(profile.email)) {
    log.warn({ action: "google_unauthorized_email", email: maskEmail(profile.email) }, "unauthorized email attempted login");
    return errorResponse("AUTH_INVALID_EMAIL", "Unauthorized email address", 403);
  }

  // Create or find user record, then create DB session
  const user = await getOrCreateUser(profile.email, profile.name);
  const sessionId = await createSession(user.id);
  rawSession.sessionId = sessionId;
  await rawSession.save();

  log.info({ action: "google_login_success", email: maskEmail(profile.email) }, "google login successful");

  // Three-way redirect logic:
  // 1. If Fitbit tokens exist → /app
  // 2. If Fitbit credentials exist (but no tokens) → /api/auth/fitbit
  // 3. If neither exist → /app/setup-fitbit
  const fitbitTokens = await getFitbitTokens(user.id);
  if (fitbitTokens) {
    return Response.redirect(buildUrl("/app"), 302);
  }
  const hasCredentials = await hasFitbitCredentials(user.id);
  const redirectTo = hasCredentials ? "/api/auth/fitbit" : "/app/setup-fitbit";
  return Response.redirect(buildUrl(redirectTo), 302);
}
