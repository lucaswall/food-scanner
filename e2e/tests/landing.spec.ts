import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

test.describe('Landing Page', () => {
  // Override storage state to test as unauthenticated user
  test.use({ storageState: { cookies: [], origins: [] } });

  test('displays landing page content for unauthenticated visitors', async ({ page }) => {
    await page.goto('/');

    // Verify we're on the landing page (not redirected to /app)
    await expect(page).toHaveURL('/');

    // Verify main heading
    await expect(page.getByRole('heading', { name: 'Food Scanner', level: 1 })).toBeVisible();

    // Verify description text
    await expect(page.getByText('AI-powered food logging for Fitbit')).toBeVisible();

    // Verify login button
    await expect(page.getByRole('button', { name: 'Login with Google' })).toBeVisible();

    // Verify additional marketing copy
    await expect(page.getByText(/Take a photo of your meal/i)).toBeVisible();

    // Capture screenshot
    await page.waitForLoadState('networkidle');
    await captureScreenshots(page, 'landing');
  });

  test('has no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');

    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Assert no console errors
    expect(consoleErrors).toEqual([]);
  });
});
