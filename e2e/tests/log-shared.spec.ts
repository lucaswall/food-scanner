import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

const MOCK_SHARED_FOOD = {
  id: 1,
  foodName: 'Grilled Salmon with Vegetables',
  amount: 350,
  unitId: 147,
  calories: 420,
  proteinG: 38,
  carbsG: 22,
  fatG: 18,
  fiberG: 5,
  sodiumMg: 380,
  saturatedFatG: 3.2,
  transFatG: 0,
  sugarsG: 4,
  caloriesFromFat: 162,
  confidence: 'high',
  notes: 'Portion includes approximately 200g salmon fillet and 100g steamed vegetables.',
  description: 'Grilled salmon with steamed vegetables',
  keywords: ['salmon', 'fish', 'grilled', 'vegetables'],
};

test.describe('Log Shared Food Page', () => {
  test('displays shared food with nutrition card', async ({ page }) => {
    const testToken = 'valid-test-token-abc123';

    // Mock the shared-food API to return valid food data
    await page.route(`**/api/shared-food/${testToken}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_SHARED_FOOD }),
      });
    });

    await page.goto(`/app/log-shared/${testToken}`);
    await page.waitForLoadState('networkidle');

    // Verify food name heading is visible
    await expect(page.getByRole('heading', { name: MOCK_SHARED_FOOD.foodName })).toBeVisible({
      timeout: 10000,
    });

    // Verify "Shared food" label
    await expect(page.getByText('Shared food')).toBeVisible();

    // Verify NutritionFactsCard is rendered
    await expect(page.getByRole('heading', { name: 'Nutrition Facts' })).toBeVisible();

    // Verify calorie display
    await expect(page.getByText('Calories', { exact: true })).toBeVisible();

    // Verify "Log to Fitbit" button is present
    await expect(page.getByRole('button', { name: /Log to Fitbit/i })).toBeVisible();

    // Screenshot: shared food loaded with nutrition card
    await captureScreenshots(page, 'log-shared');
  });

  test('displays meal type selector', async ({ page }) => {
    const testToken = 'valid-test-token-abc123';

    await page.route(`**/api/shared-food/${testToken}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_SHARED_FOOD }),
      });
    });

    await page.goto(`/app/log-shared/${testToken}`);
    await page.waitForLoadState('networkidle');

    // Verify "Meal type" label is present
    await expect(page.getByText('Meal type')).toBeVisible({ timeout: 10000 });

    // Verify meal type selector is present
    await expect(
      page.locator('text=/Breakfast|Lunch|Dinner|Morning Snack|Afternoon Snack|Anytime/i').first()
    ).toBeVisible();
  });

  test('logs shared food and shows confirmation', async ({ page }) => {
    const testToken = 'valid-test-token-abc123';

    await page.route(`**/api/shared-food/${testToken}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_SHARED_FOOD }),
      });
    });

    // Mock log-food API
    await page.route('**/api/log-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { success: true, reusedFood: false, foodLogId: 99999 },
        }),
      });
    });

    await page.goto(`/app/log-shared/${testToken}`);
    await page.waitForLoadState('networkidle');

    // Wait for food to load
    await expect(page.getByRole('heading', { name: MOCK_SHARED_FOOD.foodName })).toBeVisible({
      timeout: 10000,
    });

    // Click Log to Fitbit
    await page.getByRole('button', { name: /Log to Fitbit/i }).click();

    // Wait for confirmation
    await expect(page.getByText(/logged successfully/i)).toBeVisible({ timeout: 10000 });

    // Screenshot: log shared food confirmation
    await captureScreenshots(page, 'log-shared-confirmation');
  });

  test('shows error state for invalid token', async ({ page }) => {
    const badToken = 'invalid-token-xyz';

    // Mock the shared-food API to return an error
    await page.route(`**/api/shared-food/${badToken}`, async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Shared food not found' },
        }),
      });
    });

    await page.goto(`/app/log-shared/${badToken}`);
    await page.waitForLoadState('networkidle');

    // Verify error message is shown
    await expect(
      page.getByText('This shared food link is invalid or has expired.')
    ).toBeVisible({ timeout: 10000 });

    // Verify "Try again" button is present
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    // Screenshot: error state
    await captureScreenshots(page, 'log-shared-error');
  });
});
