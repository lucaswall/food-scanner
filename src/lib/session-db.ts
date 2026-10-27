import { eq, and, gt, lt } from "drizzle-orm";
import { getDb } from "@/db/index";
import { sessions, users } from "@/db/schema";
import { isEmailAllowed } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionRow {
  id: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
}

export async function createSession(userId: string, log?: Logger): Promise<string> {
  const l = log ?? logger;
  const db = getDb();
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
  const rows = await db
    .insert(sessions)
    .values({ userId, expiresAt })
    .returning({ id: sessions.id });
  const row = rows[0];
  if (!row) throw new Error("Failed to create session: no row returned");
  l.debug({ action: "create_session", sessionIdPrefix: row.id.slice(0, 8) }, "session created");
  return row.id;
}

/**
 * Look up a live session. The owner's email is re-checked against ALLOWED_EMAILS on every
 * lookup, so removing someone from the allowlist revokes their existing sessions: a session
 * whose user is no longer allowed is deleted and treated as missing.
 */
export async function getSessionById(id: string, log?: Logger): Promise<SessionRow | null> {
  const l = log ?? logger;
  const db = getDb();
  const rows = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      email: users.email,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())));
  const found = rows[0] ?? null;

  if (found && !isEmailAllowed(found.email)) {
    l.warn(
      { action: "session_user_not_allowed", sessionIdPrefix: id.slice(0, 8) },
      "session owner is no longer in ALLOWED_EMAILS; deleting session",
    );
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  const row: SessionRow | null = found
    ? { id: found.id, userId: found.userId, createdAt: found.createdAt, expiresAt: found.expiresAt }
    : null;
  l.debug({ action: "get_session", sessionIdPrefix: id.slice(0, 8), found: row !== null }, "session lookup");
  return row;
}

export async function touchSession(id: string, log?: Logger): Promise<void> {
  const l = log ?? logger;
  const db = getDb();
  const expiresAt = new Date(Date.now() + THIRTY_DAYS_MS);
  await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
  l.debug({ action: "touch_session", sessionIdPrefix: id.slice(0, 8) }, "session expiry extended");
}

export async function deleteSession(id: string, log?: Logger): Promise<void> {
  const l = log ?? logger;
  const db = getDb();
  await db.delete(sessions).where(eq(sessions.id, id));
  l.debug({ action: "delete_session", sessionIdPrefix: id.slice(0, 8) }, "session deleted");
}

export async function cleanExpiredSessions(log?: Logger): Promise<number> {
  const l = log ?? logger;
  const db = getDb();
  const result = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  l.debug({ action: "clean_expired_sessions", deletedCount: result.length }, "expired sessions cleaned");
  return result.length;
}
