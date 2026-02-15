import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';
import { MOCK_ANALYSIS } from '../fixtures/mock-data';

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

  test('captures screenshot with description text', async ({ page }) => {
    await page.goto('/app/analyze');
    await page.waitForLoadState('networkidle');

    // Fill in a food description
    const textarea = page.getByPlaceholder('e.g., 250g pollo asado con chimichurri');
    await textarea.fill('200g grilled salmon with steamed vegetables and brown rice');

    await captureScreenshots(page, 'analyze-with-content');
  });

  test('captures screenshot with analysis result', async ({ page }) => {
    // Mock the analyze-food API to return a successful result
    await page.route('**/api/analyze-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_ANALYSIS }),
      });
    });

    // Mock find-matches to return empty (no similar foods)
    await page.route('**/api/find-matches', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { matches: [] } }),
      });
    });

    await page.goto('/app/analyze');
    await page.waitForLoadState('networkidle');

    // Fill description and trigger analysis
    const textarea = page.getByPlaceholder('e.g., 250g pollo asado con chimichurri');
    await textarea.fill('Grilled salmon with vegetables');

    // Click analyze
    await page.getByRole('button', { name: 'Analyze Food' }).click();

    // Wait for the mocked result to render
    await expect(page.getByText(MOCK_ANALYSIS.food_name)).toBeVisible({ timeout: 5000 });

    // Scroll down to show full result with log button
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    await captureScreenshots(page, 'analyze-result');
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
