import { test, expect } from '@playwright/test';

test.describe('Analyze Page', () => {
  // Use default authenticated storage state

  test('displays analyze page with heading', async ({ page }) => {
    await page.goto('/app/analyze');

    // Verify we're on the analyze page
    await expect(page).toHaveURL('/app/analyze');

    // Verify main heading
    await expect(page.getByRole('heading', { name: 'Analyze Food', level: 1 })).toBeVisible();

    // Capture screenshot
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'e2e/screenshots/analyze.png' });
  });

  test('shows Fitbit setup guard when user has no credentials', async ({ page }) => {
    await page.goto('/app/analyze');

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

  test('loads with autoCapture query parameter without errors', async ({ page }) => {
    await page.goto('/app/analyze?autoCapture=true');

    // Verify we're on the analyze page with the query parameter
    await expect(page).toHaveURL('/app/analyze?autoCapture=true');

    // Verify main heading is still visible
    await expect(page.getByRole('heading', { name: 'Analyze Food', level: 1 })).toBeVisible();

    // Wait for page to fully load
    await page.waitForLoadState('networkidle');
  });

  test('has no console errors', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/app/analyze');

    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    // Assert no console errors
    expect(consoleErrors).toEqual([]);
  });
});
