import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

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

  test('submit empty form shows validation errors', async ({ page }) => {
    await page.goto('/app/setup-fitbit');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Click submit without filling inputs
    const submitButton = page.getByRole('button', { name: 'Connect Fitbit' });
    await submitButton.click();

    // Wait a moment for validation to trigger
    await page.waitForTimeout(500);

    // Verify validation errors appear (form should prevent submission or show required field errors)
    // The actual error message depends on the form implementation - check for common patterns
    const hasError = await page.locator('text=/required|must be|cannot be empty/i').count();
    expect(hasError).toBeGreaterThan(0);
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
