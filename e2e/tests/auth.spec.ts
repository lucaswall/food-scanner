import { test, expect } from '@playwright/test';

test.describe('Authentication & Authorization', () => {
  test.describe('Unauthenticated Access', () => {
    // Test as unauthenticated user (no session cookies)
    test.use({ storageState: { cookies: [], origins: [] } });

    test('redirects unauthenticated users from /app to landing page', async ({ page }) => {
      await page.goto('/app');

      // Should redirect to landing page
      await expect(page).toHaveURL('/');

      // Verify we're seeing the landing page content (not dashboard)
      await expect(page.getByRole('button', { name: 'Login with Google' })).toBeVisible();
    });

    test('redirects unauthenticated users from /settings to landing page', async ({ page }) => {
      await page.goto('/settings');

      // Should redirect to landing page
      await expect(page).toHaveURL('/');

      // Verify we're seeing the landing page content
      await expect(page.getByRole('button', { name: 'Login with Google' })).toBeVisible();
    });
  });

  test.describe('Authenticated Access', () => {
    // Use default authenticated storage state from global setup

    test('allows authenticated users to access /app', async ({ page }) => {
      await page.goto('/app');

      // Should NOT redirect - stays on /app
      await expect(page).toHaveURL('/app');

      // Verify we're seeing dashboard content, not landing page
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Login with Google' })).not.toBeVisible();
    });

    test('allows authenticated users to access /settings', async ({ page }) => {
      await page.goto('/settings');

      // Should NOT redirect - stays on /settings
      await expect(page).toHaveURL('/settings');

      // Verify we're seeing settings content
      // (Check for some settings-specific element - will need to verify actual content)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });
  });
});
