import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { healthTokens } from "@/db/schema";
import { encryptToken, decryptToken, TokenDecryptionError } from "@/lib/token-encryption";
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
    // Only an undecryptable ciphertext (key rotation, format version change, or
    // corruption) means "treat as absent and force re-link". Any other error —
    // e.g. a missing/misconfigured HEALTH_TOKEN_ENCRYPTION_KEY — is a server
    // misconfiguration that must surface (re-linking would hit the same
    // encryption failure on write), not be masked as a user reconnect.
    if (!(err instanceof TokenDecryptionError)) {
      throw err;
    }
    l.warn(
      {
        action: "get_health_tokens",
        userId,
        errorType: err.name,
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
