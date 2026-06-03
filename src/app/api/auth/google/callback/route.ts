import { exchangeGoogleCode, getGoogleProfile, exchangeGoogleHealthCode, getGoogleHealthIdentity } from "@/lib/auth";
import { errorResponse } from "@/lib/api-response";
import { getRawSession } from "@/lib/session";
import { buildUrl } from "@/lib/url";
import { createRequestLogger } from "@/lib/logger";
import { createSession, getSessionById } from "@/lib/session-db";
import { getHealthTokens, upsertHealthTokens } from "@/lib/health-tokens";
import { isEmailAllowed } from "@/lib/env";
import { getOrCreateUser } from "@/lib/users";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";

function maskEmail(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return "***";
  return `${email[0]}***${email.slice(atIndex)}`;
}

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/auth/google/callback");
  const ip = getClientIp(request.headers);
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

  // Parse flow, returnTo, and userId from JSON state if present
  let flow: string | null = null;
  let returnTo: string | null = null;
  let stateUserId: string | null = null;
  try {
    const parsed = JSON.parse(state) as Record<string, unknown>;
    if (typeof parsed.flow === "string") {
      flow = parsed.flow;
    }
    if (typeof parsed.returnTo === "string" && parsed.returnTo.startsWith("/") && !parsed.returnTo.startsWith("//")) {
      returnTo = parsed.returnTo;
    }
    if (typeof parsed.userId === "string") {
      stateUserId = parsed.userId;
    }
  } catch {
    // Plain string state — no flow, returnTo, or userId
  }

  // Consume OAuth state immediately after validation
  delete rawSession.oauthState;
  await rawSession.save();

  const redirectUri = buildUrl("/api/auth/google/callback");

  // === HEALTH-CONNECT FLOW ===
  if (flow === "health-connect") {
    // Require an existing authenticated session in the cookie
    const cookieSessionId: string | undefined = rawSession.sessionId || undefined;
    if (!cookieSessionId) {
      log.warn({ action: "health_connect_no_session" }, "health connect attempted without cookie session");
      return errorResponse("AUTH_MISSING_SESSION", "No active session", 401);
    }

    const dbSession = await getSessionById(cookieSessionId);
    if (!dbSession) {
      log.warn({ action: "health_connect_invalid_session" }, "health connect session not found in DB");
      return errorResponse("AUTH_MISSING_SESSION", "No active session", 401);
    }

    // Verify the user who initiated health-connect is the same as the current session user.
    // Prevents shared-device token misbinding: state includes userId set at initiation time.
    if (stateUserId !== null && dbSession.userId !== stateUserId) {
      log.warn(
        { action: "health_connect_user_mismatch" },
        "oauth state userId does not match current session userId",
      );
      return errorResponse("VALIDATION_ERROR", "Session user mismatch", 400);
    }

    let healthTokens: { access_token: string; refresh_token: string; expires_in?: number; scope?: string };
    try {
      healthTokens = await exchangeGoogleHealthCode(code, redirectUri);
    } catch (error) {
      log.error(
        { action: "health_token_exchange_error", error: error instanceof Error ? error.message : String(error) },
        "failed to exchange google health authorization code",
      );
      return errorResponse("VALIDATION_ERROR", "Failed to exchange health authorization code", 400);
    }

    let healthUserId: string;
    try {
      healthUserId = await getGoogleHealthIdentity(healthTokens.access_token);
    } catch (error) {
      log.error(
        { action: "health_identity_fetch_error", error: error instanceof Error ? error.message : String(error) },
        "failed to fetch google health identity",
      );
      return errorResponse("VALIDATION_ERROR", "Failed to fetch Google Health identity", 400);
    }

    const expiresAt = healthTokens.expires_in
      ? new Date(Date.now() + healthTokens.expires_in * 1000)
      : new Date(Date.now() + 3600 * 1000);

    try {
      await upsertHealthTokens(
        dbSession.userId,
        {
          healthUserId,
          accessToken: healthTokens.access_token,
          refreshToken: healthTokens.refresh_token,
          expiresAt,
          scope: healthTokens.scope,
        },
        log,
      );
    } catch (error) {
      log.error(
        { action: "health_token_upsert_error", error: error instanceof Error ? error.message : String(error) },
        "failed to persist google health tokens",
      );
      return errorResponse("HEALTH_TOKEN_SAVE_FAILED", "Failed to save Google Health tokens", 500);
    }

    log.info({ action: "health_connect_success" }, "google health connected successfully");
    return Response.redirect(buildUrl(returnTo ?? "/app"), 302);
  }

  // === LOGIN FLOW ===
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

  let profile: { email: string; name: string; emailVerified: boolean };
  try {
    profile = await getGoogleProfile(tokens.access_token);
  } catch (error) {
    log.error(
      { action: "google_profile_fetch_error", error: error instanceof Error ? error.message : String(error) },
      "failed to fetch google user profile",
    );
    return errorResponse("VALIDATION_ERROR", "Failed to fetch user profile", 400);
  }

  if (!profile.emailVerified) {
    log.warn({ action: "google_callback_email_not_verified", email: maskEmail(profile.email) }, "email address not verified");
    return errorResponse("AUTH_INVALID_EMAIL", "Email address not verified", 403);
  }

  if (!isEmailAllowed(profile.email)) {
    log.warn({ action: "google_unauthorized_email", email: maskEmail(profile.email) }, "unauthorized email attempted login");
    return errorResponse("AUTH_INVALID_EMAIL", "Unauthorized email address", 403);
  }

  // Create or find user record, then create DB session
  const user = await getOrCreateUser(profile.email, profile.name, log);
  const sessionId = await createSession(user.id, log);
  rawSession.sessionId = sessionId;
  await rawSession.save();

  log.info({ action: "google_login_success", email: maskEmail(profile.email) }, "google login successful");

  // Post-login redirect: /app if health tokens already connected, /app/connect-health if not
  const userHealthTokens = await getHealthTokens(user.id, log);
  if (userHealthTokens) {
    return Response.redirect(buildUrl(returnTo ?? "/app"), 302);
  }
  return Response.redirect(buildUrl("/app/connect-health"), 302);
}
