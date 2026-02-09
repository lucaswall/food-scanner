import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { fitbitCredentials } from "@/db/schema";
import { encryptToken, decryptToken } from "@/lib/token-encryption";

export interface FitbitCredentials {
  clientId: string;
  clientSecret: string;
}

export async function saveFitbitCredentials(
  userId: string,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  const db = getDb();
  const now = new Date();
  const encryptedSecret = encryptToken(clientSecret);

  await db
    .insert(fitbitCredentials)
    .values({
      userId,
      fitbitClientId: clientId,
      encryptedClientSecret: encryptedSecret,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: fitbitCredentials.userId,
      set: {
        fitbitClientId: clientId,
        encryptedClientSecret: encryptedSecret,
        updatedAt: now,
      },
    });
}

export async function getFitbitCredentials(userId: string): Promise<FitbitCredentials | null> {
  const db = getDb();
  const rows = await db.select().from(fitbitCredentials).where(eq(fitbitCredentials.userId, userId));
  const row = rows[0];
  if (!row) return null;

  const clientSecret = decryptToken(row.encryptedClientSecret);
  return {
    clientId: row.fitbitClientId,
    clientSecret,
  };
}

export async function updateFitbitClientId(userId: string, newClientId: string): Promise<void> {
  const db = getDb();
  const now = new Date();

  await db
    .update(fitbitCredentials)
    .set({
      fitbitClientId: newClientId,
      updatedAt: now,
    })
    .where(eq(fitbitCredentials.userId, userId));
}

export async function replaceFitbitClientSecret(userId: string, newSecret: string): Promise<void> {
  const db = getDb();
  const now = new Date();
  const encryptedSecret = encryptToken(newSecret);

  await db
    .update(fitbitCredentials)
    .set({
      encryptedClientSecret: encryptedSecret,
      updatedAt: now,
    })
    .where(eq(fitbitCredentials.userId, userId));
}

export async function hasFitbitCredentials(userId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db.select().from(fitbitCredentials).where(eq(fitbitCredentials.userId, userId));
  return rows.length > 0;
}

export async function deleteFitbitCredentials(userId: string): Promise<void> {
  const db = getDb();
  await db.delete(fitbitCredentials).where(eq(fitbitCredentials.userId, userId));
}
