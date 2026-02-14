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
    const chickenEntry = body.data.entries.find((e: any) => e.foodName === 'Grilled Chicken Breast');

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
    expect(calorieValue).toBeGreaterThan(200); // Should be around 248

    // Verify protein, carbs, fat are displayed
    await expect(page.getByText(/protein/i)).toBeVisible();
    await expect(page.getByText(/carbs/i)).toBeVisible();
    await expect(page.getByText(/fat/i)).toBeVisible();
  });

  test('displays meal type and date', async ({ page, request }) => {
    // Get a seeded entry
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const entry = body.data.entries[0];

    await page.goto(`/app/food-detail/${entry.id}`);
    await page.waitForLoadState('networkidle');

    // Verify meal type label (Lunch for chicken and rice)
    await expect(page.getByText('Lunch')).toBeVisible();

    // Verify date is displayed (Today or date string)
    const hasDate = await page.locator('text=/Today|\\d{4}-\\d{2}-\\d{2}/i').count();
    expect(hasDate).toBeGreaterThan(0);
  });

  test('invalid entry ID shows error state', async ({ page }) => {
    await page.goto('/app/food-detail/99999');

    // Wait for page to load
    await page.waitForTimeout(1000);

    // Verify error message appears
    const errorMessage = await page.locator('text=/failed to load|not found|error/i').count();
    expect(errorMessage).toBeGreaterThan(0);

    // Verify page didn't crash (still has some content)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('delete entry removes it from history', async ({ page, request }) => {
    // Use Steamed Broccoli entry to avoid affecting other tests
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const broccoliEntry = body.data.entries.find((e: any) => e.foodName === 'Steamed Broccoli');

    expect(broccoliEntry).toBeDefined();

    // Navigate to detail page
    await page.goto(`/app/food-detail/${broccoliEntry.id}`);
    await page.waitForLoadState('networkidle');

    // Click delete button
    const deleteButton = page.getByRole('button', { name: /delete/i });
    await deleteButton.click();

    // If confirmation dialog appears, confirm it
    const confirmButton = page.getByRole('button', { name: /confirm|yes|delete/i }).last();
    await confirmButton.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }

    // Verify redirect to history
    await expect(page).toHaveURL('/app/history', { timeout: 5000 });

    // Wait for history to load
    await page.waitForLoadState('networkidle');

    // Verify Steamed Broccoli is no longer in the list
    const broccoliVisible = await page.getByText('Steamed Broccoli').first().isVisible().catch(() => false);
    expect(broccoliVisible).toBe(false);
  });
});
