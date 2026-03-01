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
    // Verify seeded foods are visible (skip Broccoli — may be deleted by parallel test)
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Brown Rice').first()).toBeVisible();
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
    const recentTab = page.getByRole('button', { name: /Recent/i });
    await recentTab.click();

    // Wait for content to load
    await page.waitForTimeout(500);

    // Verify seeded foods from log entries appear (skip Broccoli — may be deleted by parallel test)
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible();
    await expect(page.getByText('Brown Rice').first()).toBeVisible();

    await captureScreenshots(page, 'quick-select-recent');
  });

  test('tab switching works', async ({ page }) => {
    await page.goto('/app/quick-select');
    await page.waitForLoadState('networkidle');

    // Get both tabs
    const suggestedTab = page.getByRole('button', { name: /Suggested/i });
    const recentTab = page.getByRole('button', { name: /Recent/i });

    // Click Recent tab
    await recentTab.click();
    await page.waitForTimeout(300);

    // Verify tab is active (check aria-pressed or active class)
    const recentTabSelected = await recentTab.getAttribute('aria-pressed');
    expect(recentTabSelected).toBe('true');

    // Click Suggested tab
    await suggestedTab.click();
    await page.waitForTimeout(300);

    // Verify suggested tab is now active
    const suggestedTabSelected = await suggestedTab.getAttribute('aria-pressed');
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

    // Verify meal type selector is present (check label, not dropdown value which varies by time of day)
    await expect(page.getByText('Meal Type')).toBeVisible();

    // Capture screenshot of food detail card
    await captureScreenshots(page, 'quick-select-detail');
  });

  test('log food with meal type succeeds', async ({ page }) => {
    await page.goto('/app/quick-select');
    await page.waitForLoadState('networkidle');

    // Select a food
    const foodItem = page.getByText('Grilled Chicken Breast').first();
    await foodItem.click();

    // Wait for detail view to render
    await page.waitForTimeout(500);

    // MealTypeSelector uses a <Select> dropdown — it auto-selects a default meal type
    // based on time of day. Just verify it's present and proceed to log.
    await expect(page.locator('text=/Select meal type|Breakfast|Lunch|Dinner|Morning Snack|Afternoon Snack|Anytime/i').first()).toBeVisible();

    // Find and click the "Log to Fitbit" button
    const logButton = page.getByRole('button', { name: /Log to Fitbit/i });
    await logButton.click();

    // Wait for response
    await page.waitForTimeout(2000);

    // Verify success feedback — FoodLogConfirmation shows or success toast appears
    const hasSuccessMessage = await page.locator('text=/success|logged|added|confirmed/i').count();
    const hasConfirmation = await page.locator('text=/Food Logged|Logged to Fitbit/i').count();
    const redirectedToHistory = page.url().includes('/history');

    expect(hasSuccessMessage + hasConfirmation > 0 || redirectedToHistory).toBe(true);
  });

  test('captures search results screenshot', async ({ page }) => {
    await page.goto('/app/quick-select');
    await page.waitForLoadState('networkidle');

    // Wait for foods to load
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible({ timeout: 10000 });

    // Find the search input and type a query
    const searchInput = page.getByPlaceholder(/search|find/i);
    await searchInput.fill('chicken');

    // Wait for debounce and filtered results
    await page.waitForTimeout(500);

    // Verify filtered results appear
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible();

    // Screenshot: search results filtered to "chicken"
    await captureScreenshots(page, 'quick-select-search');
  });

  test('captures food detail and log confirmation screenshots', async ({ page }) => {
    await page.goto('/app/quick-select');
    await page.waitForLoadState('networkidle');

    // Wait for foods to load
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible({ timeout: 10000 });

    // Click on the food item to show detail view
    await page.getByText('Grilled Chicken Breast').first().click();
    await page.waitForTimeout(500);

    // Verify nutrition info and meal type selector are visible
    await expect(page.getByText('Meal Type')).toBeVisible();

    // Screenshot: food detail card before logging
    await captureScreenshots(page, 'quick-select-food-detail');

    // Mock log-food to capture confirmation
    await page.route('**/api/log-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { success: true, reusedFood: true, foodLogId: 77777 },
        }),
      });
    });

    // Click Log to Fitbit
    const logButton = page.getByRole('button', { name: /Log to Fitbit/i });
    await expect(logButton).toBeVisible({ timeout: 5000 });
    await logButton.click();

    // Wait for confirmation to appear
    await page.waitForTimeout(2000);

    // Check for any confirmation state (logged successfully text or food logged heading)
    const hasConfirmation = await page
      .locator('text=/logged successfully|Food Logged/i')
      .count();

    if (hasConfirmation > 0) {
      // Screenshot: confirmation screen
      await captureScreenshots(page, 'quick-select-confirmation');
    }
  });
});
