import { test, expect } from '@playwright/test';
import { getDb } from '@/db/index';
import { fitbitTokens, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { captureScreenshots } from '../fixtures/screenshots';

/**
 * Macro engine E2E coverage (FOO-981).
 *
 * Scope: smoke-level coverage of the new UI surfaces — scope-mismatch banner,
 * TargetsCard, and the settings FitbitProfileCard — using DB-driven scope
 * manipulation. Server-side Fitbit API calls are NOT mocked (test tokens are
 * fake, so engine output assertions require Fitbit network mocking
 * infrastructure that does not exist in this codebase).
 */

const TEST_EMAIL = 'test@example.com';
const FULL_SCOPE = 'nutrition activity profile weight';
const LEGACY_SCOPE = 'nutrition activity';

async function setTokenScope(scope: string | null) {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.email, TEST_EMAIL)).limit(1);
  if (!user) throw new Error(`Test user ${TEST_EMAIL} not found`);
  await db
    .update(fitbitTokens)
    .set({ scope })
    .where(eq(fitbitTokens.userId, user.id));
}

test.describe.configure({ mode: 'serial' });

test.describe('Macro Engine — scope-mismatch banner', () => {
  test.afterEach(async () => {
    // Restore full scope so other tests aren't affected
    await setTokenScope(FULL_SCOPE);
  });

  test('shows "Reconnect Fitbit" banner when token scope is legacy', async ({ page }) => {
    await setTokenScope(LEGACY_SCOPE);

    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // FitbitStatusBanner with scope_mismatch state — copy includes "Reconnect"
    const banner = page.getByText(/reconnect fitbit/i).first();
    await expect(banner).toBeVisible({ timeout: 10000 });

    await captureScreenshots(page, 'macro-engine-scope-mismatch-banner');
  });

  test('shows "Reconnect Fitbit" banner when token scope is NULL (legacy migration row)', async ({ page }) => {
    await setTokenScope(null);

    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    const banner = page.getByText(/reconnect fitbit/i).first();
    await expect(banner).toBeVisible({ timeout: 10000 });
  });

  test('hides scope-mismatch banner when token scope is full', async ({ page }) => {
    await setTokenScope(FULL_SCOPE);

    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Banner with reconnect-permissions copy should NOT appear when scope is full.
    // (A different "disconnected" banner can appear if tokens are missing — that's
    // unrelated; we assert specifically the scope-mismatch copy is absent.)
    await expect(page.getByText(/grant new permissions/i)).toHaveCount(0);
  });
});

test.describe('Macro Engine — TargetsCard renders on dashboard', () => {
  test.beforeEach(async () => {
    await setTokenScope(FULL_SCOPE);
  });

  test('TargetsCard is rendered (loading, error, or data state)', async ({ page }) => {
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // TargetsCard always renders something — at minimum a Skeleton or an error/blocked message.
    // We check that one of the expected text fragments appears, indicating the card mounted.
    const possibleTexts = [
      "Today's Targets",            // ok header
      "Targets pending",             // partial
      "Add a weight in Fitbit",      // blocked: no_weight
      "Set your sex",                // blocked: sex_unset
      "Reconnect Fitbit",            // blocked: scope_mismatch (also in banner)
      "Could not load targets",      // SWR error
    ];
    const cardTextRegex = new RegExp(possibleTexts.join('|'), 'i');
    await expect(page.getByText(cardTextRegex).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Macro Engine — Settings Fitbit profile card', () => {
  test.beforeEach(async () => {
    await setTokenScope(FULL_SCOPE);
  });

  test('FitbitProfileCard renders on settings page', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // The card renders a heading "Fitbit Profile" in all states (loading, error, success).
    // In the loading state, only the Skeleton is shown — wait until the heading appears.
    await expect(page.getByRole('heading', { name: /fitbit profile/i }).first()).toBeVisible({
      timeout: 10000,
    });

    await captureScreenshots(page, 'macro-engine-settings-profile-card');
  });
});
