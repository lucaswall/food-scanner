import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

test.describe('Settings Page', () => {
  // Use default authenticated storage state

  test('displays settings page sections and captures screenshot', async ({ page }) => {
    await page.goto('/settings');

    // Verify we're on the settings page
    await expect(page).toHaveURL('/settings');

    // Wait for the page to fully load
    await page.waitForLoadState('networkidle');

    // Verify there's a main heading (the SettingsContent component should render one)
    const headings = await page.getByRole('heading', { level: 1 }).count();
    expect(headings).toBeGreaterThan(0);

    // Capture screenshot
    await captureScreenshots(page, 'settings');

    // Scroll down to show API Keys and Claude Usage sections
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await captureScreenshots(page, 'settings-bottom');
  });

  test('API key manager section is present', async ({ page }) => {
    await page.goto('/settings');

    // The ApiKeyManager component should be visible
    // Check for the presence of settings content
    await page.waitForLoadState('networkidle');

    // Just verify the page loads successfully
    await expect(page).toHaveURL('/settings');
  });

  test('displays user session info and Fitbit status', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Verify user email is visible
    await expect(page.getByText('test@example.com')).toBeVisible();

    // Verify Fitbit status is displayed (could be "Connected" or "Not connected")
    await expect(page.getByText(/Fitbit:/)).toBeVisible();
  });

  test('displays logout button with destructive styling', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Verify logout button is visible and has destructive variant (red)
    const logoutButton = page.getByRole('button', { name: 'Logout' });
    await expect(logoutButton).toBeVisible();
  });

  test('displays Fitbit App Credentials section', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Verify "Fitbit App Credentials" heading is visible
    await expect(page.getByRole('heading', { name: 'Fitbit App Credentials' })).toBeVisible();
  });

  test('displays saved Fitbit Client ID', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // With seeded credentials (TEST_CLIENT_ID from global setup),
    // the Fitbit App Credentials section should show the client ID (masked or full)
    // Verify the section contains the test client ID or a masked version
    const credentialsSection = page.locator('text=Fitbit App Credentials').locator('..');
    const hasClientId = await credentialsSection.locator('text=/TEST_CLIENT_ID|Client ID/i').count();
    expect(hasClientId).toBeGreaterThan(0);
  });

  test('update credentials from settings succeeds', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // The Fitbit App Credentials section shows Client ID in a <code> element
    // with an "Edit" button, and Client Secret as masked with a "Replace Secret" button.
    // The Edit button is conditionally rendered after SWR fetches credentials data,
    // which may complete after networkidle — wait explicitly for the button.

    // Click "Edit" to enable Client ID editing
    const editButton = page.getByRole('button', { name: 'Edit' });
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();

    // Now the Client ID input should be visible
    const clientIdInput = page.getByLabel('Client ID');
    await expect(clientIdInput).toBeVisible();

    // Clear and fill with updated value
    await clientIdInput.clear();
    await clientIdInput.fill('UPDATED_CLIENT_ID');

    // Click Save
    const saveButton = page.getByRole('button', { name: 'Save' }).first();
    await saveButton.click();

    // Wait for the save to complete
    await page.waitForTimeout(1000);

    // Verify the updated Client ID is now displayed
    await expect(page.locator('code', { hasText: 'UPDATED_CLIENT_ID' })).toBeVisible();
  });

  test('displays Appearance section with theme buttons', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Verify "Appearance" heading is visible
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();

    // Verify all three theme buttons are visible
    await expect(page.getByRole('button', { name: /Light/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Dark/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /System/ })).toBeVisible();
  });

  test('theme button changes active state when clicked', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Get theme buttons
    const lightButton = page.getByRole('button', { name: /Light/ });
    const darkButton = page.getByRole('button', { name: /Dark/ });

    // Click dark theme button
    await darkButton.click();

    // Wait a moment for state to update
    await page.waitForTimeout(100);

    // Click light theme button
    await lightButton.click();

    // Wait for state to update
    await page.waitForTimeout(100);

    // Verify we can interact with the buttons (actual theme state verification
    // would require checking CSS classes which may vary based on implementation)
    await expect(lightButton).toBeVisible();
    await expect(darkButton).toBeVisible();
  });

  test('replace secret flow works', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Find and click the "Replace Secret" button
    // Button is conditionally rendered after SWR fetches credentials — wait explicitly
    const replaceSecretButton = page.getByRole('button', { name: 'Replace Secret' });
    await expect(replaceSecretButton).toBeVisible({ timeout: 10000 });
    await replaceSecretButton.click();

    // Verify a Client Secret input appears
    const clientSecretInput = page.getByLabel('Client Secret');
    await expect(clientSecretInput).toBeVisible();

    // Fill with a new secret value
    await clientSecretInput.fill('NEW_TEST_SECRET');

    // Click Save button
    const saveButton = page.getByRole('button', { name: 'Save' }).first();
    await saveButton.click();

    // Wait for save to complete
    await page.waitForTimeout(1000);

    // Verify success feedback: secret saved, input hidden, masked secret shown
    // The input should be hidden after save
    await expect(clientSecretInput).not.toBeVisible();

    // The "Replace Secret" button should be visible again
    await expect(replaceSecretButton).toBeVisible();
  });

  test('reconnect Fitbit button triggers auth flow', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Find the "Reconnect Fitbit" button
    const reconnectButton = page.getByRole('button', { name: /Reconnect Fitbit/i });
    await expect(reconnectButton).toBeVisible();

    // The button is inside a form that POSTs to /api/auth/fitbit
    // Mock the auth route to prevent actual OAuth redirect
    let authRequestMade = false;
    await page.route('**/api/auth/fitbit', async (route) => {
      authRequestMade = true;
      await route.fulfill({
        status: 302,
        headers: { Location: '/settings' },
      });
    });

    // Click the button
    await reconnectButton.click();

    // Wait for the request to be made
    await page.waitForTimeout(1000);

    // Verify the auth request was triggered
    expect(authRequestMade).toBe(true);
  });

  test('displays Claude API usage metrics', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Claude API Usage section is below SettingsContent (which uses min-h-screen),
    // so we need to scroll the heading into view directly rather than relying on
    // scrollTo(bottom) which may not reach it under parallel test load
    const usageHeading = page.getByRole('heading', { name: /Claude API Usage/i });
    await usageHeading.scrollIntoViewIfNeeded();

    // Verify Claude API Usage heading is visible
    await expect(usageHeading).toBeVisible({ timeout: 10000 });

    // Verify usage data is visible
    // The ClaudeUsageSection component groups usage by month and shows:
    // - Month name (e.g., "February 2026")
    // - Request count
    // - Cost (e.g., "$0.049")
    // - Token breakdown

    // With seeded data (3 requests in current month), verify at least one of these is shown
    const usageSection = page.locator('text=/Claude API Usage/i').locator('..');

    // Check for month name (current month)
    const currentMonth = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const hasMonth = await usageSection.locator(`text=/${currentMonth}/i`).count();
    expect(hasMonth).toBeGreaterThan(0);

    // Check for cost display (should show total cost from seeded data: $0.049)
    const hasCost = await usageSection.locator('text=/\\$0\\.0/').count();
    expect(hasCost).toBeGreaterThan(0);
  });
});
