import { test, expect } from '@playwright/test';

test.describe('Food Detail Page', () => {
  // Use default authenticated storage state

  test('displays food detail page for a seeded entry', async ({ page, request }) => {
    // First, discover a seeded entry ID by calling the API
    const response = await request.get('/api/food-history');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.entries).toBeDefined();
    expect(Array.isArray(body.data.entries)).toBe(true);
    expect(body.data.entries.length).toBeGreaterThan(0);

    // Extract the first entry's ID
    const firstEntry = body.data.entries[0];
    const entryId = firstEntry.id;

    // Navigate to the food detail page
    await page.goto(`/app/food-detail/${entryId}`);

    // Verify we're on the food detail page
    await expect(page).toHaveURL(`/app/food-detail/${entryId}`);

    // Wait for network idle to ensure data is loaded
    await page.waitForLoadState('networkidle');

    // Verify the page renders without errors (should not show error message)
    await expect(page.getByText('Failed to load food entry details')).not.toBeVisible();

    // Verify food name is visible as a heading (one of the seeded foods)
    const foodNameHeading = page.getByRole('heading', { level: 1 });
    await expect(foodNameHeading).toBeVisible();

    // Verify the food name matches one of our seeded entries
    const foodName = await foodNameHeading.textContent();
    expect(['Grilled Chicken Breast', 'Brown Rice', 'Steamed Broccoli']).toContain(foodName);

    // Verify nutrition facts card is visible
    await expect(page.getByRole('heading', { name: 'Nutrition Facts' })).toBeVisible();

    // Verify back button is present
    await expect(page.getByRole('button', { name: /Back/ })).toBeVisible();
  });

  test('displays nutrition data', async ({ page, request }) => {
    // Get a seeded entry ID
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const entryId = body.data.entries[0].id;

    // Navigate to the food detail page
    await page.goto(`/app/food-detail/${entryId}`);

    // Wait for network idle to ensure data is loaded
    await page.waitForLoadState('networkidle');

    // Verify calories are displayed (use exact match to avoid "Calories from Fat")
    await expect(page.getByText('Calories', { exact: true })).toBeVisible();

    // Verify macros are displayed (use exact labels from NutritionFactsCard)
    await expect(page.getByText('Protein')).toBeVisible();
    await expect(page.getByText('Carbs')).toBeVisible();
    await expect(page.getByText('Fat', { exact: true })).toBeVisible();
  });

  test('captures food detail page screenshot', async ({ page, request }) => {
    // Get a seeded entry ID
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const entryId = body.data.entries[0].id;

    // Navigate to the food detail page
    await page.goto(`/app/food-detail/${entryId}`);

    // Wait for network idle to ensure data is loaded
    await page.waitForLoadState('networkidle');

    // Capture screenshot
    await page.screenshot({ path: 'e2e/screenshots/food-detail.png' });
  });
});
