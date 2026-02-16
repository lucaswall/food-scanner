import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import { createApiKey, listApiKeys } from "@/lib/api-keys";

export async function GET() {
  const log = createRequestLogger("GET", "/api/api-keys");
  const session = await getSession();

  const validationError = validateSession(session);
  if (validationError) return validationError;

  log.debug(
    { action: "list_api_keys", userId: session!.userId },
    "Fetching API keys",
  );

  try {
    const keys = await listApiKeys(session!.userId);

    const response = successResponse({ keys });

    // Add Cache-Control header
    response.headers.set("Cache-Control", "private, no-cache");
    return response;
  } catch (error) {
    log.error(
      { action: "list_api_keys_error", error: error instanceof Error ? error.message : String(error) },
      "Failed to list API keys",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to list API keys", 500);
  }
}

interface PostRequestBody {
  name?: unknown;
}

function isValidPostRequest(body: unknown): body is { name: string } {
  if (!body || typeof body !== "object") return false;
  const req = body as PostRequestBody;

  if (typeof req.name !== "string" || req.name.trim().length === 0) return false;

  return true;
}

export async function POST(request: Request) {
  const log = createRequestLogger("POST", "/api/api-keys");
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
      { action: "create_api_key_validation", userId: session!.userId },
      "Invalid request body",
    );
    return errorResponse(
      "VALIDATION_ERROR",
      "name is required and must be a non-empty string",
      400,
    );
  }

  log.info(
    { action: "create_api_key", userId: session!.userId, keyName: body.name },
    "Creating API key",
  );

  try {
    const result = await createApiKey(session!.userId, body.name);

    return successResponse(result, 201);
  } catch (error) {
    log.error(
      { action: "create_api_key_error", error: error instanceof Error ? error.message : String(error) },
      "Failed to create API key",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to create API key", 500);
  }
}
