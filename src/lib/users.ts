import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { users } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import type { User } from "@/types";

export async function getOrCreateUser(email: string, name?: string, log?: Logger): Promise<User> {
  const l = log ?? logger;
  const db = getDb();
  const normalizedEmail = email.toLowerCase();

  const rows = await db
    .insert(users)
    .values({ email: normalizedEmail, name: name ?? null })
    .onConflictDoUpdate({
      target: users.email,
      set: { updatedAt: new Date() },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("Failed to create user: no row returned");
  l.debug({ action: "get_or_create_user", email: normalizedEmail }, "user upserted");
  return { id: row.id, email: row.email, name: row.name };
}

export async function getUserById(userId: string, log?: Logger): Promise<User | null> {
  const l = log ?? logger;
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId));
  const row = rows[0];
  if (!row) {
    l.debug({ action: "get_user_by_id", found: false }, "user not found");
    return null;
  }
  l.debug({ action: "get_user_by_id", found: true, email: row.email }, "user retrieved");
  return { id: row.id, email: row.email, name: row.name };
}
