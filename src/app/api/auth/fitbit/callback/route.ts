import { exchangeFitbitCode } from "@/lib/fitbit";
import { errorResponse } from "@/lib/api-response";
import { getRawSession } from "@/lib/session";
import { buildUrl } from "@/lib/url";
import { createRequestLogger } from "@/lib/logger";
import { getSessionById } from "@/lib/session-db";
import { upsertFitbitTokens } from "@/lib/fitbit-tokens";
import { getFitbitCredentials } from "@/lib/fitbit-credentials";

export async function GET(request: Request) {
  const log = createRequestLogger("GET", "/api/auth/fitbit/callback");
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Read OAuth state from iron-session instead of plain cookie
  const rawSession = await getRawSession();
  const storedState = rawSession.oauthState;

  if (!code || !state || state !== storedState) {
    log.warn({ action: "fitbit_callback_invalid_state" }, "invalid fitbit oauth state");
    return errorResponse("VALIDATION_ERROR", "Invalid OAuth state", 400);
  }

  // Consume OAuth state immediately after validation
  delete rawSession.oauthState;
  await rawSession.save();

  if (!rawSession.sessionId) {
    log.warn({ action: "fitbit_callback_no_session" }, "fitbit callback without authenticated session");
    return errorResponse("AUTH_MISSING_SESSION", "No authenticated session", 401);
  }

  const dbSession = await getSessionById(rawSession.sessionId);
  if (!dbSession) {
    log.warn({ action: "fitbit_callback_no_session" }, "fitbit callback with expired/invalid session");
    return errorResponse("AUTH_MISSING_SESSION", "No authenticated session", 401);
  }

  // Load per-user Fitbit credentials
  const credentials = await getFitbitCredentials(dbSession.userId);
  if (!credentials) {
    log.warn({ action: "fitbit_callback_no_credentials" }, "fitbit callback with no stored credentials");
    return errorResponse("FITBIT_CREDENTIALS_MISSING", "No Fitbit credentials configured", 400);
  }

  const redirectUri = buildUrl("/api/auth/fitbit/callback");

  let tokens: {
    access_token: string;
    refresh_token: string;
    user_id: string;
    expires_in: number;
  };
  try {
    tokens = await exchangeFitbitCode(code, redirectUri, credentials, log);
  } catch (error) {
    log.error(
      { action: "fitbit_token_exchange_error", error: error instanceof Error ? error.message : String(error) },
      "failed to exchange fitbit authorization code",
    );
    return errorResponse(
      "FITBIT_TOKEN_INVALID",
      "Failed to exchange Fitbit authorization code",
      400,
    );
  }

  // Store Fitbit tokens in database
  await upsertFitbitTokens(dbSession.userId, {
    fitbitUserId: tokens.user_id,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  });

  log.info({ action: "fitbit_connect_success" }, "fitbit connected successfully");

  return Response.redirect(buildUrl("/app"), 302);
}
