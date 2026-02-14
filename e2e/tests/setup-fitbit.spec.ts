import { test, expect } from '@playwright/test';

test.describe('Setup Fitbit Page', () => {
  // Use default authenticated storage state

  test('displays setup fitbit page with heading and back button', async ({ page }) => {
    await page.goto('/app/setup-fitbit');

    // Verify we're on the setup fitbit page
    await expect(page).toHaveURL('/app/setup-fitbit');

    // Verify main heading
    await expect(page.getByRole('heading', { name: 'Set Up Fitbit', level: 1 })).toBeVisible();

    // Verify back button is visible (uses aria-label)
    const backButton = page.getByRole('link', { name: 'Back to Food Scanner' });
    await expect(backButton).toBeVisible();

    // Capture screenshot
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'e2e/screenshots/setup-fitbit.png' });
  });

  test('back button navigates to dashboard', async ({ page }) => {
    await page.goto('/app/setup-fitbit');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Click the back button
    const backButton = page.getByRole('link', { name: 'Back to Food Scanner' });
    await backButton.click();

    // Verify navigation to /app
    await expect(page).toHaveURL('/app');
  });

  test('displays fitbit credentials form inputs', async ({ page }) => {
    await page.goto('/app/setup-fitbit');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Verify Client ID input is present
    const clientIdInput = page.getByLabel('Fitbit Client ID');
    await expect(clientIdInput).toBeVisible();

    // Verify Client Secret input is present
    const clientSecretInput = page.getByLabel('Fitbit Client Secret');
    await expect(clientSecretInput).toBeVisible();

    // Verify the submit button is present
    const submitButton = page.getByRole('button', { name: 'Connect Fitbit' });
    await expect(submitButton).toBeVisible();
  });
});
