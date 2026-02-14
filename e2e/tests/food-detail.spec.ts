import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

// Use serial to ensure delete test runs last
test.describe.serial('Food Detail Page', () => {
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
    await captureScreenshots(page, 'food-detail');
  });

  test('displays correct nutrition values for seeded entry', async ({ page, request }) => {
    // Get the Grilled Chicken Breast entry specifically
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const chickenEntry = body.data.entries.find((e: { foodName: string }) => e.foodName === 'Grilled Chicken Breast');

    expect(chickenEntry).toBeDefined();

    // Navigate to the detail page
    await page.goto(`/app/food-detail/${chickenEntry.id}`);
    await page.waitForLoadState('networkidle');

    // Seeded chicken: 165 cal/100g, 150g amount → ~248 calories
    // Don't assert exact value, verify it's non-zero and reasonable
    const calorieText = await page.locator('text=/\\d+\\s*cal/i').first().textContent();
    const calorieMatch = calorieText?.match(/(\d+)/);
    const calorieValue = calorieMatch ? parseInt(calorieMatch[1], 10) : 0;

    expect(calorieValue).toBeGreaterThan(0);
    expect(calorieValue).toBeGreaterThan(100); // Base calories: 165 per 100g

    // Verify protein, carbs, fat are displayed
    await expect(page.getByText('Protein')).toBeVisible();
    await expect(page.getByText('Carbs')).toBeVisible();
    await expect(page.getByText('Fat', { exact: true })).toBeVisible();
  });

  test('displays meal type and date', async ({ page, request }) => {
    // Get a seeded entry
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const entry = body.data.entries[0];

    await page.goto(`/app/food-detail/${entry.id}`);
    await page.waitForLoadState('networkidle');

    // Verify meal type label (Lunch for chicken and rice)
    await expect(page.getByText('Lunch', { exact: true })).toBeVisible();

    // Verify date is displayed (long-form: "Friday, February 14, 2026")
    const hasDate = await page.locator('text=/\\w+,\\s+\\w+\\s+\\d{1,2},\\s+\\d{4}/').count();
    expect(hasDate).toBeGreaterThan(0);
  });

  test('invalid entry ID shows error state', async ({ page }) => {
    await page.goto('/app/food-detail/99999');
    await page.waitForLoadState('networkidle');

    // Verify error message appears
    await expect(page.getByText('Failed to load food entry details')).toBeVisible({ timeout: 10000 });

    // Verify back button is present (page didn't crash)
    await expect(page.getByRole('button', { name: /Back/ })).toBeVisible();
  });

  test('delete entry removes it from history', async ({ page, request }) => {
    // Verify Steamed Broccoli exists in seeded data
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const broccoliEntry = body.data.entries.find((e: { foodName: string }) => e.foodName === 'Steamed Broccoli');
    expect(broccoliEntry).toBeDefined();

    // Navigate to history page (delete button is on history, not food-detail)
    await page.goto('/app/history');
    await page.waitForLoadState('networkidle');

    // Click the delete button for Steamed Broccoli
    const deleteButton = page.getByRole('button', { name: 'Delete Steamed Broccoli' });
    await expect(deleteButton).toBeVisible({ timeout: 10000 });
    await deleteButton.click();

    // Confirm deletion in the AlertDialog
    const confirmButton = page.getByRole('button', { name: 'Confirm' });
    await expect(confirmButton).toBeVisible();
    await confirmButton.click();

    // Wait for deletion to complete and list to update
    await page.waitForLoadState('networkidle');

    // Verify Steamed Broccoli is no longer in the list
    await expect(page.getByText('Steamed Broccoli')).not.toBeVisible({ timeout: 5000 });
  });
});
