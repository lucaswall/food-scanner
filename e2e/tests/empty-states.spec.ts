import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

// Uses default authenticated storage state from global setup

test.describe('Empty and Error States', () => {
  test('invalid food detail ID shows error state', async ({ page }) => {
    await page.goto('/app/food-detail/99999');
    await page.waitForLoadState('networkidle');

    // The food detail component shows "Failed to load food entry details" text
    await expect(page.getByText('Failed to load food entry details')).toBeVisible({ timeout: 10000 });

    await captureScreenshots(page, 'food-detail-error');

    // Verify back button is present
    await expect(page.getByRole('button', { name: /Back/ })).toBeVisible();
  });

  test('nutrition summary API returns zeros for future date', async ({ request }) => {
    const response = await request.get('/api/nutrition-summary?date=2030-01-01');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.totals.calories).toBe(0);
    expect(body.data.meals).toHaveLength(0);
  });

  test('earliest entry API returns today for seeded data', async ({ request }) => {
    // Use local date (not UTC) to match how the app and seed fixture work
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const response = await request.get('/api/earliest-entry');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    // Seeded entries are all for today, so earliest date should be today
    expect(body.data.date).toBe(today);
  });
});
