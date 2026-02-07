import { eq, and, gt, lt } from "drizzle-orm";
import { getDb } from "@/db/index";
import { sessions } from "@/db/schema";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<string> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
  const rows = await db
    .insert(sessions)
    .values({ userId, expiresAt })
    .returning({ id: sessions.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to create session: no row returned");
  return row.id;
}

export async function getSessionById(id: string): Promise<SessionRow | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  return rows[0] ?? null;
}

export async function touchSession(id: string): Promise<void> {
  const db = getDb();
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
  await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
}

export async function deleteSession(id: string): Promise<void> {
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, id));
}

export async function cleanExpiredSessions(): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return result.length;
}
