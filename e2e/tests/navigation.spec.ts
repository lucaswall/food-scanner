import { test, expect } from '@playwright/test';

test.describe('Bottom Navigation', () => {
  test('shows all 5 navigation items on /app', async ({ page }) => {
    await page.goto('/app');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible();

    // Verify all 5 nav items are visible
    await expect(nav.getByRole('link', { name: /home/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /quick select/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /analyze/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /history/i })).toBeVisible();
    await expect(nav.getByRole('link', { name: /settings/i })).toBeVisible();
  });

  test('shows Home as active on /app', async ({ page }) => {
    await page.goto('/app');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    const homeLink = nav.getByRole('link', { name: /home/i });

    await expect(homeLink).toHaveAttribute('aria-current', 'page');
  });

  test('navigates to Quick Select and shows it as active', async ({ page }) => {
    await page.goto('/app');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await nav.getByRole('link', { name: /quick select/i }).click();

    await expect(page).toHaveURL('/app/quick-select');

    const quickSelectLink = nav.getByRole('link', { name: /quick select/i });
    await expect(quickSelectLink).toHaveAttribute('aria-current', 'page');
  });

  test('navigates to History and shows it as active', async ({ page }) => {
    await page.goto('/app');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await nav.getByRole('link', { name: /history/i }).click();

    await expect(page).toHaveURL('/app/history');

    const historyLink = nav.getByRole('link', { name: /history/i });
    await expect(historyLink).toHaveAttribute('aria-current', 'page');
  });

  test('navigates to Settings and shows it as active', async ({ page }) => {
    await page.goto('/app');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await nav.getByRole('link', { name: /settings/i }).click();

    await expect(page).toHaveURL('/settings');

    const settingsLink = nav.getByRole('link', { name: /settings/i });
    await expect(settingsLink).toHaveAttribute('aria-current', 'page');
  });

  test('nav bar remains visible after each navigation', async ({ page }) => {
    await page.goto('/app');

    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible();

    // Navigate to Quick Select
    await nav.getByRole('link', { name: /quick select/i }).click();
    await expect(nav).toBeVisible();

    // Navigate to History
    await nav.getByRole('link', { name: /history/i }).click();
    await expect(nav).toBeVisible();

    // Navigate to Settings
    await nav.getByRole('link', { name: /settings/i }).click();
    await expect(nav).toBeVisible();

    // Navigate back to Home
    await nav.getByRole('link', { name: /home/i }).click();
    await expect(nav).toBeVisible();
  });
});
