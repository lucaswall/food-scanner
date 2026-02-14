import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

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
    await captureScreenshots(page, 'analyze');
  });

  test('shows analyze UI when Fitbit is connected', async ({ page }) => {
    await page.goto('/app/analyze');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // With seeded Fitbit credentials and tokens, FitbitSetupGuard passes and real UI renders
    // Verify the analyze UI is visible (description input label)
    const descriptionLabel = page.getByText('Food description (optional)');
    await expect(descriptionLabel).toBeVisible({ timeout: 10000 });

    // Verify analyze button is present
    const analyzeButton = page.getByRole('button', { name: 'Analyze' });
    await expect(analyzeButton).toBeVisible();
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
