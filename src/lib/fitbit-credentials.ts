import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { fitbitCredentials } from "@/db/schema";
import { encryptToken, decryptToken } from "@/lib/token-encryption";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

export interface FitbitCredentials {
  clientId: string;
  clientSecret: string;
}

export async function saveFitbitCredentials(
  userId: string,
  clientId: string,
  clientSecret: string,
  log?: Logger,
): Promise<void> {
  const l = log ?? logger;
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
  l.debug({ action: "save_fitbit_credentials" }, "fitbit credentials saved");
}

export async function getFitbitCredentials(userId: string, log?: Logger): Promise<FitbitCredentials | null> {
  const l = log ?? logger;
  const db = getDb();
  const rows = await db.select().from(fitbitCredentials).where(eq(fitbitCredentials.userId, userId));
  const row = rows[0];
  if (!row) {
    l.debug({ action: "get_fitbit_credentials", found: false }, "fitbit credentials not found");
    return null;
  }

  const clientSecret = decryptToken(row.encryptedClientSecret);
  l.debug({ action: "get_fitbit_credentials", found: true }, "fitbit credentials retrieved");
  return {
    clientId: row.fitbitClientId,
    clientSecret,
  };
}

export async function updateFitbitClientId(userId: string, newClientId: string, log?: Logger): Promise<void> {
  const l = log ?? logger;
  const db = getDb();
  const now = new Date();

  await db
    .update(fitbitCredentials)
    .set({
      fitbitClientId: newClientId,
      updatedAt: now,
    })
    .where(eq(fitbitCredentials.userId, userId));
  l.debug({ action: "update_fitbit_client_id" }, "fitbit client ID updated");
}

export async function replaceFitbitClientSecret(userId: string, newSecret: string, log?: Logger): Promise<void> {
  const l = log ?? logger;
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
  l.debug({ action: "replace_fitbit_client_secret" }, "fitbit client secret replaced");
}

export async function hasFitbitCredentials(userId: string, log?: Logger): Promise<boolean> {
  const l = log ?? logger;
  const db = getDb();
  const rows = await db.select().from(fitbitCredentials).where(eq(fitbitCredentials.userId, userId));
  const exists = rows.length > 0;
  l.debug({ action: "has_fitbit_credentials", exists }, "fitbit credentials check");
  return exists;
}

export async function deleteFitbitCredentials(userId: string, log?: Logger): Promise<void> {
  const l = log ?? logger;
  const db = getDb();
  await db.delete(fitbitCredentials).where(eq(fitbitCredentials.userId, userId));
  l.debug({ action: "delete_fitbit_credentials" }, "fitbit credentials deleted");
}
