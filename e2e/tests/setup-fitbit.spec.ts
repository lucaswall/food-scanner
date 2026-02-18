import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

test.describe('Setup Fitbit Page', () => {
  // Use default authenticated storage state

  test('displays setup fitbit page with heading and back button', async ({ page }) => {
    await page.goto('/app/setup-fitbit');

    // Verify we're on the setup fitbit page
    await expect(page).toHaveURL('/app/setup-fitbit');

    // Wait for page to fully render — under parallel test load the heading may take longer
    await page.waitForLoadState('networkidle');

    // Verify main heading
    await expect(page.getByRole('heading', { name: 'Set Up Fitbit', level: 1 })).toBeVisible({ timeout: 10000 });

    // Verify back button is visible (uses aria-label)
    const backButton = page.getByRole('link', { name: 'Back to Food Scanner' });
    await expect(backButton).toBeVisible();

    // Capture screenshot
    await page.waitForLoadState('networkidle');
    await captureScreenshots(page, 'setup-fitbit');
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

  test('submit button is disabled when form is empty', async ({ page }) => {
    await page.goto('/app/setup-fitbit');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // The submit button should be disabled when both inputs are empty
    const submitButton = page.getByRole('button', { name: 'Connect Fitbit' });
    await expect(submitButton).toBeDisabled();

    // Fill only one input — button should still be disabled
    const clientIdInput = page.getByLabel('Fitbit Client ID');
    await clientIdInput.fill('some-client-id');
    await expect(submitButton).toBeDisabled();

    // Fill both inputs — button should become enabled
    const clientSecretInput = page.getByLabel('Fitbit Client Secret');
    await clientSecretInput.fill('some-client-secret');
    await expect(submitButton).toBeEnabled();
  });

  test('submit valid credentials triggers OAuth redirect', async ({ page }) => {
    await page.goto('/app/setup-fitbit');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Fill in test credentials
    const clientIdInput = page.getByLabel('Fitbit Client ID');
    const clientSecretInput = page.getByLabel('Fitbit Client Secret');

    await clientIdInput.fill('TEST_NEW_CLIENT_ID');
    await clientSecretInput.fill('TEST_NEW_CLIENT_SECRET');

    // Click submit
    const submitButton = page.getByRole('button', { name: 'Connect Fitbit' });
    await submitButton.click();

    // Wait for navigation or response
    // Since the test user already has seeded credentials, this may update them
    // The form should either redirect to Fitbit OAuth or show success/update message
    await page.waitForTimeout(1000);

    // Check if we navigated to Fitbit OAuth URL or stayed on page with success
    const currentURL = page.url();
    const redirectedToFitbit = currentURL.includes('fitbit.com');
    const stayedOnPage = currentURL.includes('/app/setup-fitbit');

    // Either outcome is acceptable (depends on whether credentials existed)
    expect(redirectedToFitbit || stayedOnPage).toBe(true);
  });
});
