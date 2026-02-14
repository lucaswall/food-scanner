import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

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
    await captureScreenshots(page, 'quick-select');
  });

  test('shows quick select UI when Fitbit is connected', async ({ page }) => {
    await page.goto('/app/quick-select');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // With seeded Fitbit credentials and tokens, FitbitSetupGuard passes and real UI renders
    // Verify seeded foods are visible
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Brown Rice').first()).toBeVisible();
    await expect(page.getByText('Steamed Broccoli').first()).toBeVisible();
  });

  test('suggested tab displays foods', async ({ page }) => {
    await page.goto('/app/quick-select');
    await page.waitForLoadState('networkidle');

    // The suggested tab is default - verify at least one seeded food appears
    // Time-of-day ranking may vary, so check for any of the seeded foods
    const hasFood = await page.locator('text=/Grilled Chicken Breast|Brown Rice|Steamed Broccoli/i').count();
    expect(hasFood).toBeGreaterThan(0);
  });

  test('recent tab displays recently logged foods', async ({ page }) => {
    await page.goto('/app/quick-select');
    await page.waitForLoadState('networkidle');

    // Click the Recent tab
    const recentTab = page.getByRole('tab', { name: /Recent/i });
    await recentTab.click();

    // Wait for content to load
    await page.waitForTimeout(500);

    // Verify seeded foods from log entries appear
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible();
    await expect(page.getByText('Brown Rice').first()).toBeVisible();
    await expect(page.getByText('Steamed Broccoli').first()).toBeVisible();
  });

  test('tab switching works', async ({ page }) => {
    await page.goto('/app/quick-select');
    await page.waitForLoadState('networkidle');

    // Get both tabs
    const suggestedTab = page.getByRole('tab', { name: /Suggested/i });
    const recentTab = page.getByRole('tab', { name: /Recent/i });

    // Click Recent tab
    await recentTab.click();
    await page.waitForTimeout(300);

    // Verify tab is active (check aria-selected or active class)
    const recentTabSelected = await recentTab.getAttribute('aria-selected');
    expect(recentTabSelected).toBe('true');

    // Click Suggested tab
    await suggestedTab.click();
    await page.waitForTimeout(300);

    // Verify suggested tab is now active
    const suggestedTabSelected = await suggestedTab.getAttribute('aria-selected');
    expect(suggestedTabSelected).toBe('true');
  });

  test('search input filters results', async ({ page }) => {
    await page.goto('/app/quick-select');
    await page.waitForLoadState('networkidle');

    // Find the search input
    const searchInput = page.getByPlaceholder(/search|find/i);
    await searchInput.fill('chicken');

    // Wait for debounce and results
    await page.waitForTimeout(500);

    // Verify Grilled Chicken Breast appears in results
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible();

    // Verify non-matching foods are not visible or filtered out
    const broccoliVisible = await page.getByText('Steamed Broccoli').first().isVisible().catch(() => false);
    const riceVisible = await page.getByText('Brown Rice').first().isVisible().catch(() => false);

    // Non-matching foods should be filtered out
    expect(broccoliVisible).toBe(false);
    expect(riceVisible).toBe(false);
  });

  test('select food shows nutrition detail', async ({ page }) => {
    await page.goto('/app/quick-select');
    await page.waitForLoadState('networkidle');

    // Click on the first food item
    const foodItem = page.getByText('Grilled Chicken Breast').first();
    await foodItem.click();

    // Wait for detail view to appear
    await page.waitForTimeout(500);

    // Verify nutrition information is displayed
    await expect(page.getByText(/calories|protein|carbs|fat/i).first()).toBeVisible();

    // Verify meal type selector is present
    const mealTypeSelector = await page.locator('text=/lunch|dinner|breakfast|snack/i').count();
    expect(mealTypeSelector).toBeGreaterThan(0);
  });

  test('log food with meal type succeeds', async ({ page }) => {
    await page.goto('/app/quick-select');
    await page.waitForLoadState('networkidle');

    // Select a food
    const foodItem = page.getByText('Grilled Chicken Breast').first();
    await foodItem.click();

    // Wait for detail view
    await page.waitForTimeout(500);

    // Select a meal type (Lunch)
    const lunchButton = page.getByRole('button', { name: /Lunch/i });
    await lunchButton.click();

    // Find and click the log/submit button
    const logButton = page.getByRole('button', { name: /Log|Add|Save/i });
    await logButton.click();

    // Wait for response
    await page.waitForTimeout(1000);

    // Verify success feedback (toast, message, or redirect)
    const hasSuccessMessage = await page.locator('text=/success|logged|added/i').count();
    const redirectedToHistory = page.url().includes('/history');

    expect(hasSuccessMessage > 0 || redirectedToHistory).toBe(true);
  });
});
