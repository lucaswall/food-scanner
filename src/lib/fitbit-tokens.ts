import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { fitbitTokens } from "@/db/schema";
import { encryptToken, decryptToken } from "@/lib/token-encryption";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

export interface FitbitTokenRow {
  id: number;
  userId: string;
  fitbitUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  updatedAt: Date;
}

export async function getFitbitTokens(userId: string, log?: Logger): Promise<FitbitTokenRow | null> {
  const l = log ?? logger;
  const db = getDb();
  const rows = await db.select().from(fitbitTokens).where(eq(fitbitTokens.userId, userId));
  const row = rows[0];
  if (!row) {
    l.debug({ action: "get_fitbit_tokens", found: false }, "fitbit tokens not found");
    return null;
  }
  const accessToken = decryptToken(row.accessToken);
  const refreshToken = decryptToken(row.refreshToken);
  l.debug({ action: "get_fitbit_tokens", found: true }, "fitbit tokens retrieved");
  return { ...row, accessToken, refreshToken };
}

export async function upsertFitbitTokens(
  userId: string,
  data: {
    fitbitUserId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  },
  log?: Logger,
): Promise<void> {
  const l = log ?? logger;
  const db = getDb();
  const now = new Date();
  const encryptedAccessToken = encryptToken(data.accessToken);
  const encryptedRefreshToken = encryptToken(data.refreshToken);
  await db
    .insert(fitbitTokens)
    .values({
      userId,
      fitbitUserId: data.fitbitUserId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt: data.expiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: fitbitTokens.userId,
      set: {
        fitbitUserId: data.fitbitUserId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: data.expiresAt,
        updatedAt: now,
      },
    });
  l.debug({ action: "upsert_fitbit_tokens" }, "fitbit tokens upserted");
}

export async function deleteFitbitTokens(userId: string, log?: Logger): Promise<void> {
  const l = log ?? logger;
  const db = getDb();
  await db.delete(fitbitTokens).where(eq(fitbitTokens.userId, userId));
  l.debug({ action: "delete_fitbit_tokens" }, "fitbit tokens deleted");
}
