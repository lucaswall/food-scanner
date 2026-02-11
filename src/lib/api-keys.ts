import { createHash, randomBytes } from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { getDb } from "@/db/index";
import { apiKeys } from "@/db/schema";

/**
 * Generate a new API key with fsk_ prefix.
 * Format: fsk_{64 hex chars}
 */
export function generateApiKey(): string {
  const randomPart = randomBytes(32).toString("hex");
  return `fsk_${randomPart}`;
}

/**
 * Hash an API key using SHA-256.
 * Returns a 64-character hex string.
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export interface ApiKeyMetadata {
  id: number;
  name: string;
  rawKey: string;
  keyPrefix: string;
  createdAt: Date;
}

/**
 * Create a new API key for a user.
 * Returns the key metadata including the raw key (only shown once).
 */
export async function createApiKey(
  userId: string,
  name: string,
): Promise<ApiKeyMetadata> {
  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  // Extract first 8 chars after the fsk_ prefix for display
  const keyPrefix = rawKey.slice(4, 12);

  const db = getDb();
  const rows = await db
    .insert(apiKeys)
    .values({
      userId,
      name,
      keyHash,
      keyPrefix,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
    });

  const row = rows[0];
  if (!row) throw new Error("Failed to insert API key: no row returned");

  return {
    id: row.id,
    name: row.name,
    rawKey,
    keyPrefix: row.keyPrefix,
    createdAt: row.createdAt,
  };
}

export interface ApiKeyInfo {
  id: number;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * List all non-revoked API keys for a user.
 * Does not return key hashes or raw keys.
 */
export async function listApiKeys(userId: string): Promise<ApiKeyInfo[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPrefix: apiKeys.keyPrefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));

  return rows;
}

/**
 * Revoke an API key.
 * Returns true if the key was revoked, false if not found or userId mismatch.
 */
export async function revokeApiKey(
  userId: string,
  keyId: number,
): Promise<boolean> {
  const db = getDb();

  const rows = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)))
    .returning({ id: apiKeys.id });

  return rows.length > 0;
}

/**
 * Validate an API key and return user info if valid.
 * Updates lastUsedAt on successful validation.
 * Returns null if key is invalid, revoked, or not found.
 */
export async function validateApiKey(
  rawKey: string,
): Promise<{ userId: string; keyId: number } | null> {
  const keyHash = hashApiKey(rawKey);
  const db = getDb();

  const rows = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash));

  const row = rows[0];
  if (!row || row.revokedAt !== null) {
    return null;
  }

  // Update lastUsedAt
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id));

  return {
    userId: row.userId,
    keyId: row.id,
  };
}
