import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { healthTokens } from "@/db/schema";
import { encryptToken, decryptToken } from "@/lib/token-encryption";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

export interface HealthTokenRow {
  id: number;
  userId: string;
  healthUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string | null;
  updatedAt: Date;
}

export async function getHealthTokens(userId: string, log?: Logger): Promise<HealthTokenRow | null> {
  const l = log ?? logger;
  const db = getDb();
  const rows = await db.select().from(healthTokens).where(eq(healthTokens.userId, userId));
  const row = rows[0];
  if (!row) {
    l.debug({ action: "get_health_tokens", found: false }, "health tokens not found");
    return null;
  }

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = decryptToken(row.accessToken);
    refreshToken = decryptToken(row.refreshToken);
  } catch (err) {
    // Token is undecryptable — key rotation, format version change, or corruption.
    // Treat as absent so callers prompt the user to re-link Google Health.
    l.warn(
      {
        action: "get_health_tokens",
        userId,
        errorType: err instanceof Error ? err.name : "unknown",
      },
      "health token decryption failed — treating as absent to force re-auth",
    );
    return null;
  }

  l.debug({ action: "get_health_tokens", found: true }, "health tokens retrieved");
  return { ...row, accessToken, refreshToken };
}

export async function upsertHealthTokens(
  userId: string,
  data: {
    healthUserId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scope?: string | null;
  },
  log?: Logger,
): Promise<void> {
  const l = log ?? logger;
  const db = getDb();
  const now = new Date();
  const encryptedAccessToken = encryptToken(data.accessToken);
  const encryptedRefreshToken = encryptToken(data.refreshToken);
  const scope = data.scope ?? null;
  await db
    .insert(healthTokens)
    .values({
      userId,
      healthUserId: data.healthUserId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt: data.expiresAt,
      scope,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: healthTokens.userId,
      set: {
        healthUserId: data.healthUserId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: data.expiresAt,
        scope,
        updatedAt: now,
      },
    });
  l.debug({ action: "upsert_health_tokens" }, "health tokens upserted");
}

export async function deleteHealthTokens(userId: string, log?: Logger): Promise<void> {
  const l = log ?? logger;
  const db = getDb();
  await db.delete(healthTokens).where(eq(healthTokens.userId, userId));
  l.debug({ action: "delete_health_tokens" }, "health tokens deleted");
}
