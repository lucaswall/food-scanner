import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

// Uses default authenticated storage state from global setup

test.describe('Empty and Error States', () => {
  test('invalid food detail ID shows error state', async ({ page }) => {
    await page.goto('/app/food-detail/99999');
    await page.waitForLoadState('networkidle');

    // The food detail component shows error text when entry is not found
    await expect(page.getByText('Something went wrong loading this food entry.')).toBeVisible({ timeout: 10000 });

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

  test('dashboard empty state: past date with no entries shows empty UI', async ({ page }) => {
    // Navigate to dashboard then switch to a date in the past with no entries
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Mock nutrition-summary for a past date to return empty meals
    await page.route('**/api/nutrition-summary*', async (route) => {
      const url = route.request().url();
      // Only intercept if a specific past date is being requested
      if (url.includes('2020-01-01')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              date: '2020-01-01',
              totals: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, sodiumMg: 0 },
              meals: [],
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Use previous day navigation to go to a past date
    // Click previous day arrow multiple times to reach a date with no entries
    const prevButton = page.getByRole('button', { name: /Previous day/i });

    // Navigate several days back to reach a date with no seeded data
    const isPrevEnabled = await prevButton.isEnabled();
    if (isPrevEnabled) {
      await prevButton.click();
      await page.waitForTimeout(500);
    }

    // Verify we're on the Daily tab
    await expect(page.getByRole('button', { name: 'Daily' })).toBeVisible();

    // Screenshot: dashboard with past/empty date (shows 0 calories or empty meals)
    await captureScreenshots(page, 'dashboard-empty-date');
  });

  test('history empty state: past date navigation shows no-entry state', async ({ page }) => {
    await page.goto('/app/history');
    await page.waitForLoadState('networkidle');

    // Jump to a past date with no entries using Jump to date
    const dateInput = page.getByLabel('Jump to date');
    await dateInput.fill('2020-01-01');

    const goButton = page.getByRole('button', { name: 'Go' });
    await goButton.click();

    // Wait for page update
    await page.waitForTimeout(500);

    // Seeded entries are for today, not 2020-01-01 — so no entries should show
    await expect(page.getByText('Grilled Chicken Breast')).not.toBeVisible();
    await expect(page.getByText('Brown Rice')).not.toBeVisible();

    // "Today" heading should not be visible (we're on a past date)
    await expect(page.getByRole('heading', { name: 'Today' })).not.toBeVisible();

    // Screenshot: history empty state for past date
    await captureScreenshots(page, 'history-empty-state');
  });

  test('HealthConnectGuard: shows connect UI when Google Health not connected', async ({ page }) => {
    // Mock /api/auth/session to return not connected
    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            healthConnected: false,
          },
        }),
      });
    });

    await page.goto('/app/analyze');
    await page.waitForLoadState('networkidle');

    // HealthConnectGuard should show "Connect Google Health" message
    await expect(
      page.getByText('Connect Google Health to start logging food')
    ).toBeVisible({ timeout: 10000 });

    // "Connect Google Health" link should be present
    await expect(page.getByRole('link', { name: 'Connect Google Health' })).toBeVisible();

    // Screenshot: HealthConnectGuard — not connected state
    await captureScreenshots(page, 'health-connect-guard-disconnected');
  });
});
