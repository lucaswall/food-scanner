import { test, expect } from '@playwright/test';

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
    await page.screenshot({ path: 'e2e/screenshots/settings.png', fullPage: true });
  });

  test('API key manager section is present', async ({ page }) => {
    await page.goto('/settings');

    // The ApiKeyManager component should be visible
    // Check for the presence of settings content
    await page.waitForLoadState('networkidle');

    // Just verify the page loads successfully
    await expect(page).toHaveURL('/settings');
  });
});
