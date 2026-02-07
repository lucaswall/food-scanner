import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { fitbitTokens } from "@/db/schema";
import { encryptToken, decryptToken } from "@/lib/token-encryption";

export interface FitbitTokenRow {
  id: number;
  email: string;
  fitbitUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  updatedAt: Date;
}

export async function getFitbitTokens(email: string): Promise<FitbitTokenRow | null> {
  const db = getDb();
  const rows = await db.select().from(fitbitTokens).where(eq(fitbitTokens.email, email));
  const row = rows[0];
  if (!row) return null;
  const accessToken = decryptToken(row.accessToken);
  const refreshToken = decryptToken(row.refreshToken);
  return { ...row, accessToken, refreshToken };
}

export async function upsertFitbitTokens(
  email: string,
  data: {
    fitbitUserId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  },
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const encryptedAccessToken = encryptToken(data.accessToken);
  const encryptedRefreshToken = encryptToken(data.refreshToken);
  await db
    .insert(fitbitTokens)
    .values({
      email,
      fitbitUserId: data.fitbitUserId,
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      expiresAt: data.expiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: fitbitTokens.email,
      set: {
        fitbitUserId: data.fitbitUserId,
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        expiresAt: data.expiresAt,
        updatedAt: now,
      },
    });
}

export async function deleteFitbitTokens(email: string): Promise<void> {
  const db = getDb();
  await db.delete(fitbitTokens).where(eq(fitbitTokens.email, email));
}
