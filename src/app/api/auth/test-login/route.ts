import { successResponse, errorResponse } from "@/lib/api-response";
import { getRawSession } from "@/lib/session";
import { createSession } from "@/lib/session-db";
import { getOrCreateUser } from "@/lib/users";
import { logger } from "@/lib/logger";

export async function POST() {
  // Only allow test login when explicitly enabled
  if (process.env.ENABLE_TEST_AUTH !== "true") {
    return errorResponse("NOT_FOUND", "Not found", 404);
  }

  try {
    // Create or find test user
    const user = await getOrCreateUser("test@example.com", "Test User");

    // Create DB session
    const sessionId = await createSession(user.id);

    // Set iron-session cookie
    const rawSession = await getRawSession();
    rawSession.sessionId = sessionId;
    await rawSession.save();

    return successResponse({
      userId: user.id,
      email: user.email,
    });
  } catch (error) {
    logger.error(
      {
        action: "test_login_error",
        error: error instanceof Error ? error.message : String(error),
      },
      "test login failed",
    );
    return errorResponse("INTERNAL_ERROR", "Failed to create test session", 500);
  }
}
