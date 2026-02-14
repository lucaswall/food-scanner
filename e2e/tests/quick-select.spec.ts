import { test, expect } from '@playwright/test';

test.describe('Quick Select Page', () => {
  // Use default authenticated storage state

  test('displays quick select page with heading', async ({ page }) => {
    await page.goto('/app/quick-select');

    // Verify we're on the quick select page
    await expect(page).toHaveURL('/app/quick-select');

    // Verify main heading
    await expect(page.getByRole('heading', { name: 'Quick Select', level: 1 })).toBeVisible();

    // Capture screenshot
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'e2e/screenshots/quick-select.png' });
  });

  test('shows Fitbit setup guard when user has no credentials', async ({ page }) => {
    await page.goto('/app/quick-select');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Test user has no Fitbit credentials, so FitbitSetupGuard shows setup prompt
    // Wait for the setup prompt to appear (gives time for API request and guard to render)
    const setupPrompt = page.getByText('Set up your Fitbit credentials to start logging food');
    await expect(setupPrompt).toBeVisible({ timeout: 10000 });

    // Verify the "Set up Fitbit" button is present and links to correct page
    const setupButton = page.getByRole('link', { name: 'Set up Fitbit' });
    await expect(setupButton).toBeVisible();
    await expect(setupButton).toHaveAttribute('href', '/app/setup-fitbit');
  });
});
