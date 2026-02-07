import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { users } from "@/db/schema";
import type { User } from "@/types";

export async function getOrCreateUser(email: string, name?: string): Promise<User> {
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
  return { id: row.id, email: row.email, name: row.name };
}

export async function getUserById(userId: string): Promise<User | null> {
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, userId));
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name };
}
