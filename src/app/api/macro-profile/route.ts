import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db/index";
import { users } from "@/db/schema";
import { getSession, validateSession } from "@/lib/session";
import { successResponse, errorResponse } from "@/lib/api-response";
import { createRequestLogger } from "@/lib/logger";
import {
  MACRO_PROFILE_KEYS,
  describeProfile,
  isMacroProfileKey,
  getMacroProfile,
  type MacroProfileKey,
} from "@/lib/macro-engine";
import { invalidateUserDailyGoalsForProfileChange } from "@/lib/daily-goals";
import { getTodayDate } from "@/lib/date-utils";

interface MacroProfileResponse {
  profile: MacroProfileKey;
  name: string;
  available: { key: MacroProfileKey; name: string; description: string }[];
}

function buildResponse(key: MacroProfileKey): MacroProfileResponse {
  return {
    profile: key,
    name: getMacroProfile(key).name,
    available: MACRO_PROFILE_KEYS.map((k) => {
      const p = getMacroProfile(k);
      return { key: k, name: p.name, description: describeProfile(p) };
    }),
  };
}

export async function GET() {
  const log = createRequestLogger("GET", "/api/macro-profile");
  const session = await getSession();
  const validationError = validateSession(session);
  if (validationError) return validationError;

  const rows = await getDb()
    .select({ macroProfile: users.macroProfile })
    .from(users)
    .where(eq(users.id, session!.userId));

  const stored = rows[0]?.macroProfile;
  const key: MacroProfileKey = isMacroProfileKey(stored) ? stored : "muscle_preserve";

  log.debug({ action: "macro_profile_get", userId: session!.userId, key }, "macro profile fetched");

  const response = successResponse(buildResponse(key));
  response.headers.set("Cache-Control", "private, no-cache");
  return response;
}

export async function PATCH(request: Request) {
  const log = createRequestLogger("PATCH", "/api/macro-profile");
  const session = await getSession();
  const validationError = validateSession(session);
  if (validationError) return validationError;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const profileValue = (body as { profile?: unknown } | null)?.profile;
  if (!isMacroProfileKey(profileValue)) {
    return errorResponse(
      "VALIDATION_ERROR",
      `profile must be one of: ${MACRO_PROFILE_KEYS.join(", ")}`,
      400,
    );
  }

  // FOO-996 race-safety: increment macroProfileVersion atomically alongside
  // the profile write. Concurrent in-flight computes that captured the OLD
  // profile will write the OLD version into their daily_calorie_goals row;
  // the next read sees the version mismatch and recomputes under the new profile.
  await getDb()
    .update(users)
    .set({
      macroProfile: profileValue,
      macroProfileVersion: sql`${users.macroProfileVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(users.id, session!.userId));

  await invalidateUserDailyGoalsForProfileChange(session!.userId, getTodayDate());

  log.info(
    { action: "macro_profile_set", userId: session!.userId, profile: profileValue },
    "macro profile updated; daily goals invalidated",
  );

  return successResponse(buildResponse(profileValue));
}
