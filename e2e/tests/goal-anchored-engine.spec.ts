import { test, expect } from '@playwright/test';
import { getDb } from '@/db/index';
import { users, dailyCalorieGoals } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { captureScreenshots } from '../fixtures/screenshots';

/**
 * Goal-anchored engine E2E coverage (FOO-1049).
 *
 * Smoke-level coverage of the new UI surfaces — goals-setup banner on the
 * dashboard, DailyGoalsCard on settings, and TargetsCard inline rendering.
 * Server-side Google Health API calls are NOT mocked (test tokens are fake), so
 * end-to-end engine output assertions are out of scope here; engine math is
 * covered exhaustively by unit tests in src/lib/__tests__/macro-engine.test.ts
 * and src/lib/__tests__/daily-goals.test.ts.
 */

const TEST_EMAIL = 'test@example.com';

async function clearGoalSettings() {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, TEST_EMAIL)).limit(1);
  if (!user) throw new Error(`Test user ${TEST_EMAIL} not found`);

  await db
    .update(users)
    .set({ activityLevel: null, goalWeightKg: null, goalRateKgPerWeek: null })
    .where(eq(users.id, user.id));

  // Wipe any cached daily-goals rows from prior tests so the goals_not_set gate
  // is the only short-circuit on the next dashboard load.
  await db.delete(dailyCalorieGoals).where(eq(dailyCalorieGoals.userId, user.id));
}

test.describe.configure({ mode: 'serial' });

test.describe('Goal-Anchored Engine — onboarding gate', () => {
  test.beforeEach(async () => {
    await clearGoalSettings();
  });

  test('shows GoalsSetupBanner on the dashboard when goal settings are not set', async ({ page }) => {
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    const banner = page
      .getByText(/Set up your daily goals in Settings to see your targets/i)
      .first();
    await expect(banner).toBeVisible({ timeout: 10000 });

    const cta = page.getByRole('link', { name: /open settings/i }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', '/settings');

    await captureScreenshots(page, 'goal-anchored-engine-setup-banner');
  });

  test('TargetsCard shows the goals_not_set blocked message on settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // TargetsCard's "blocked" view for goals_not_set
    await expect(
      page.getByText(/Set up your daily goals in Settings to enable targets/i).first(),
    ).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Goal-Anchored Engine — DailyGoalsCard renders', () => {
  test.beforeEach(async () => {
    await clearGoalSettings();
  });

  test('DailyGoalsCard renders with all three input controls', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Activity-level radio group — five labels expected (no descriptions per FOO-1044).
    for (const label of ['Sedentary', 'Light', 'Moderate', 'Very active', 'Extra active']) {
      await expect(
        page.getByRole('radio', { name: new RegExp(`^${label}$`, 'i') }).first(),
      ).toBeVisible({ timeout: 10000 });
    }

    // Goal weight + goal rate numeric inputs.
    await expect(page.getByLabel(/goal weight/i).first()).toBeVisible();
    await expect(page.getByLabel(/goal rate/i).first()).toBeVisible();

    // Save button is present.
    await expect(page.getByRole('button', { name: /save/i }).first()).toBeVisible();

    await captureScreenshots(page, 'goal-anchored-engine-daily-goals-card');
  });
});

test.describe('Goal-Anchored Engine — TargetsCard has no expand toggle', () => {
  test.beforeEach(async () => {
    await clearGoalSettings();
  });

  test('No "Show calculation details" / "Hide calculation details" buttons rendered', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // FOO-1045: expand-on-tap was removed; details render inline whenever audit is present.
    await expect(
      page.getByRole('button', { name: /show calculation details/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: /hide calculation details/i }),
    ).toHaveCount(0);
  });
});
