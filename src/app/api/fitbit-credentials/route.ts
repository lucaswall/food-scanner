import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import {
  getFitbitCredentials,
  saveFitbitCredentials,
  updateFitbitClientId,
  replaceFitbitClientSecret,
} from "@/lib/fitbit-credentials";

export async function GET() {
  const log = createRequestLogger("GET", "/api/fitbit-credentials");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  log.debug(
    { action: "get_fitbit_credentials", userId: session!.userId },
    "Fetching Fitbit credentials",
  );

  const credentials = await getFitbitCredentials(session!.userId, log);

  const response = !credentials
    ? successResponse({
        hasCredentials: false,
      })
    : successResponse({
        hasCredentials: true,
        clientId: credentials.clientId,
      });

  // Add Cache-Control header
  response.headers.set("Cache-Control", "private, no-cache");
  return response;
}

interface PostRequestBody {
  clientId?: unknown;
  clientSecret?: unknown;
}

function isValidPostRequest(body: unknown): body is { clientId: string; clientSecret: string } {
  if (!body || typeof body !== "object") return false;
  const req = body as PostRequestBody;

  if (typeof req.clientId !== "string" || req.clientId.trim().length === 0) return false;
  if (typeof req.clientSecret !== "string" || req.clientSecret.trim().length === 0) return false;

  return true;
}

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/fitbit-credentials");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (!isValidPostRequest(body)) {
    log.warn(
      { action: "save_fitbit_credentials_validation", userId: session!.userId },
      "Invalid request body",
    );
    return errorResponse(
      "VALIDATION_ERROR",
      "clientId and clientSecret are required and must be non-empty strings",
      400,
    );
  }

  log.info(
    { action: "save_fitbit_credentials", userId: session!.userId },
    "Saving Fitbit credentials",
  );

  await saveFitbitCredentials(session!.userId, body.clientId, body.clientSecret, log);

  return successResponse({
    message: "Fitbit credentials saved successfully",
  });
}

interface PatchRequestBody {
  clientId?: unknown;
  clientSecret?: unknown;
}

function isValidPatchRequest(body: unknown): body is { clientId?: string; clientSecret?: string } {
  if (!body || typeof body !== "object") return false;
  const req = body as PatchRequestBody;

  // At least one field must be present
  if (req.clientId === undefined && req.clientSecret === undefined) return false;

  // If clientId is present, it must be a non-empty string
  if (req.clientId !== undefined && (typeof req.clientId !== "string" || req.clientId.trim().length === 0)) {
    return false;
  }

  // If clientSecret is present, it must be a non-empty string
  if (
    req.clientSecret !== undefined &&
    (typeof req.clientSecret !== "string" || req.clientSecret.trim().length === 0)
  ) {
    return false;
  }

  return true;
}

export async function PATCH(request: Request) {
  const log = createRequestLogger("PATCH", "/api/fitbit-credentials");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (!isValidPatchRequest(body)) {
    log.warn(
      { action: "update_fitbit_credentials_validation", userId: session!.userId },
      "Invalid request body",
    );
    return errorResponse(
      "VALIDATION_ERROR",
      "At least one of clientId or clientSecret must be provided as a non-empty string",
      400,
    );
  }

  // Check if credentials exist before updating
  const existingCredentials = await getFitbitCredentials(session!.userId, log);
  if (!existingCredentials) {
    log.warn(
      { action: "update_fitbit_credentials", userId: session!.userId },
      "No existing credentials found",
    );
    return errorResponse("NOT_FOUND", "No existing credentials found to update", 404);
  }

  log.info(
    { action: "update_fitbit_credentials", userId: session!.userId },
    "Updating Fitbit credentials",
  );

  // Update clientId if provided
  if (body.clientId !== undefined) {
    await updateFitbitClientId(session!.userId, body.clientId, log);
  }

  // Replace clientSecret if provided
  if (body.clientSecret !== undefined) {
    await replaceFitbitClientSecret(session!.userId, body.clientSecret, log);
  }

  return successResponse({
    message: "Fitbit credentials updated successfully",
  });
}
