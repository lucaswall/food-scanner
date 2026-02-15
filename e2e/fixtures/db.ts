import { getDb } from '@/db/index';
import {
  users,
  sessions,
  fitbitTokens,
  fitbitCredentials,
  customFoods,
  foodLogEntries,
  lumenGoals,
  apiKeys,
  claudeUsage,
  dailyCalorieGoals,
} from '@/db/schema';
import { eq } from 'drizzle-orm';
import { encryptToken } from '@/lib/token-encryption';

/**
 * Tables in reverse-dependency order for safe truncation.
 * Child tables (with foreign keys) must be truncated before parent tables.
 */
const TABLES_IN_TRUNCATION_ORDER = [
  foodLogEntries,
  customFoods,
  sessions,
  fitbitTokens,
  fitbitCredentials,
  lumenGoals,
  apiKeys,
  claudeUsage,
  dailyCalorieGoals,
  users,
] as const;

/**
 * Truncates all tables in the database in reverse-dependency order.
 * Use this in global-setup (before seeding) and global-teardown (cleanup).
 */
export async function truncateAllTables() {
  const db = getDb();

  for (const table of TABLES_IN_TRUNCATION_ORDER) {
    await db.delete(table);
  }
}

/**
 * Seeds test data for E2E tests.
 * - Finds the test user (created by test-login)
 * - Creates sample custom foods
 * - Creates sample food log entries for today
 */
export async function seedTestData() {
  const db = getDb();
  const testUserEmail = 'test@example.com';

  // Find the test user (should exist after test-login is called)
  const [testUser] = await db
    .select()
    .from(users)
    .where(eq(users.email, testUserEmail))
    .limit(1);

  if (!testUser) {
    throw new Error(
      `Test user ${testUserEmail} not found. Ensure test-login is called before seeding.`
    );
  }

  // Create sample custom foods
  const [customFood1] = await db
    .insert(customFoods)
    .values({
      userId: testUser.id,
      foodName: 'Grilled Chicken Breast',
      amount: '100',
      unitId: 226, // Fitbit unit ID for grams
      calories: 165,
      proteinG: '31',
      carbsG: '0',
      fatG: '3.6',
      fiberG: '0',
      sodiumMg: '74',
      saturatedFatG: '1',
      transFatG: '0',
      sugarsG: '0',
      caloriesFromFat: '32',
      confidence: 'high',
      notes: 'E2E test food',
    })
    .returning();

  const [customFood2] = await db
    .insert(customFoods)
    .values({
      userId: testUser.id,
      foodName: 'Brown Rice',
      amount: '100',
      unitId: 226,
      calories: 112,
      proteinG: '2.6',
      carbsG: '23.5',
      fatG: '0.9',
      fiberG: '1.8',
      sodiumMg: '5',
      saturatedFatG: '0.2',
      transFatG: '0',
      sugarsG: '0.4',
      confidence: 'high',
      notes: 'E2E test food',
    })
    .returning();

  const [customFood3] = await db
    .insert(customFoods)
    .values({
      userId: testUser.id,
      foodName: 'Steamed Broccoli',
      amount: '100',
      unitId: 226,
      calories: 35,
      proteinG: '2.4',
      carbsG: '7',
      fatG: '0.4',
      fiberG: '2.6',
      sodiumMg: '33',
      saturatedFatG: '0',
      transFatG: '0',
      sugarsG: '1.7',
      confidence: 'high',
      notes: 'E2E test food',
    })
    .returning();

  // Create sample food log entries for today
  // Use local date (not UTC) to match how the app renders dates
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const currentTime = new Date().toTimeString().split(' ')[0]; // HH:MM:SS

  await db.insert(foodLogEntries).values([
    {
      userId: testUser.id,
      customFoodId: customFood1!.id,
      mealTypeId: 3, // Lunch
      amount: '150',
      unitId: 226,
      date: today,
      time: '12:30:00',
    },
    {
      userId: testUser.id,
      customFoodId: customFood2!.id,
      mealTypeId: 3, // Lunch
      amount: '200',
      unitId: 226,
      date: today,
      time: '12:30:00',
    },
    {
      userId: testUser.id,
      customFoodId: customFood3!.id,
      mealTypeId: 5, // Dinner
      amount: '100',
      unitId: 226,
      date: today,
      time: currentTime,
    },
  ]);

  // Seed Fitbit tokens for guard bypass
  // Note: Fitbit credentials are seeded via POST /api/fitbit-credentials in global-setup.ts
  // to avoid SESSION_SECRET mismatch between seed process and Next.js server
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  await db.insert(fitbitTokens).values({
    userId: testUser.id,
    fitbitUserId: 'TEST_FITBIT_USER',
    accessToken: encryptToken('TEST_ACCESS_TOKEN'),
    refreshToken: encryptToken('TEST_REFRESH_TOKEN'),
    expiresAt: oneYearFromNow,
  });
}
