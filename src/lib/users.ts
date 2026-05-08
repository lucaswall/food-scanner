import { eq } from "drizzle-orm";
import { getDb } from "@/db/index";
import { users } from "@/db/schema";
import { logger } from "@/lib/logger";
import type { Logger } from "@/lib/logger";
import type { User, ActivityLevel } from "@/types";

export interface UserGoalSettings {
  activityLevel: ActivityLevel | null;
  goalWeightKg: string | null;
  goalRateKgPerWeek: string | null;
}

export type UserGoalSettingsUpdate = Partial<{
  activityLevel: ActivityLevel | null;
  goalWeightKg: number | null;
  goalRateKgPerWeek: number | null;
}>;

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

/**
 * Read the three goal-anchored settings columns from the users row.
 * Drizzle returns `numeric` columns as strings — callers cast as needed.
 */
export async function getUserGoalSettings(
  userId: string,
): Promise<UserGoalSettings> {
  const db = getDb();
  const rows = await db
    .select({
      activityLevel: users.activityLevel,
      goalWeightKg: users.goalWeightKg,
      goalRateKgPerWeek: users.goalRateKgPerWeek,
    })
    .from(users)
    .where(eq(users.id, userId));

  const row = rows[0];
  if (!row) {
    return { activityLevel: null, goalWeightKg: null, goalRateKgPerWeek: null };
  }
  return {
    activityLevel: (row.activityLevel as ActivityLevel | null) ?? null,
    goalWeightKg: row.goalWeightKg ?? null,
    goalRateKgPerWeek: row.goalRateKgPerWeek ?? null,
  };
}

/**
 * Update a subset of goal-anchored settings columns on the users row.
 * Only the provided fields are written; others retain prior values.
 * Returns the full updated goal settings.
 */
export async function updateUserGoalSettings(
  userId: string,
  update: UserGoalSettingsUpdate,
): Promise<UserGoalSettings> {
  const db = getDb();
  const setClause: Record<string, unknown> = { updatedAt: new Date() };

  if ("activityLevel" in update) {
    setClause.activityLevel = update.activityLevel ?? null;
  }
  if ("goalWeightKg" in update) {
    setClause.goalWeightKg =
      update.goalWeightKg !== null && update.goalWeightKg !== undefined
        ? update.goalWeightKg.toString()
        : null;
  }
  if ("goalRateKgPerWeek" in update) {
    setClause.goalRateKgPerWeek =
      update.goalRateKgPerWeek !== null && update.goalRateKgPerWeek !== undefined
        ? update.goalRateKgPerWeek.toString()
        : null;
  }

  await db
    .update(users)
    .set(setClause)
    .where(eq(users.id, userId));

  return getUserGoalSettings(userId);
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
