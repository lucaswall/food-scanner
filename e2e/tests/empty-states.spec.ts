import { test, expect } from '@playwright/test';

// Uses default authenticated storage state from global setup

test.describe('Empty and Error States', () => {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  test('invalid food detail ID shows error state', async ({ page }) => {
    await page.goto('/app/food-detail/99999');
    await page.waitForLoadState('networkidle');

    // Verify error state is displayed
    const errorHeading = page.getByRole('heading', { name: /something went wrong/i });
    await expect(errorHeading).toBeVisible();

    const tryAgainButton = page.getByRole('button', { name: /try again/i });
    await expect(tryAgainButton).toBeVisible();
  });

  test('history page with future date shows no entries', async ({ page }) => {
    await page.goto('/app/history');
    await page.waitForLoadState('networkidle');

    // Use Jump to date with a far-future date
    const dateInput = page.getByLabel(/jump to date/i);
    await dateInput.fill('2030-01-01');

    const goButton = page.getByRole('button', { name: /go/i });
    await goButton.click();

    await page.waitForLoadState('networkidle');

    // Verify empty state message is shown
    const emptyState = page.getByText(/no food log entries/i);
    await expect(emptyState).toBeVisible();
  });

  test('API returns empty data for future date', async ({ request }) => {
    const futureDate = '2030-01-01';
    const response = await request.get(`/api/nutrition-summary?date=${futureDate}`);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // Verify response has zero/empty data
    expect(body.data.totals.calories).toBe(0);
    expect(body.data.meals).toHaveLength(0);
  });
});
