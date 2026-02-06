import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { fitbitTokens } from "@/db/schema";

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
  return rows[0] ?? null;
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
  await db
    .insert(fitbitTokens)
    .values({
      email,
      fitbitUserId: data.fitbitUserId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: fitbitTokens.email,
      set: {
        fitbitUserId: data.fitbitUserId,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        updatedAt: now,
      },
    });
}

export async function deleteFitbitTokens(email: string): Promise<void> {
  const db = getDb();
  await db.delete(fitbitTokens).where(eq(fitbitTokens.email, email));
}
