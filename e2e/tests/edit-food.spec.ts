import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';
import { buildChatSSE, MOCK_ANALYSIS } from '../fixtures/mock-data';

test.describe.serial('Edit Food Page', () => {
  test('loads edit page for a seeded entry with initial greeting', async ({ page, request }) => {
    // Discover a seeded entry ID from API
    const response = await request.get('/api/food-history');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.entries.length).toBeGreaterThan(0);

    const firstEntry = body.data.entries[0];
    const entryId = firstEntry.id;

    // Navigate to edit page
    await page.goto(`/app/edit/${entryId}`);
    await page.waitForLoadState('networkidle');

    // FoodChat in edit mode shows: "You logged {foodName} ({calories} cal). What would you like to change?"
    await expect(
      page.getByText(new RegExp(`You logged ${firstEntry.foodName}`))
    ).toBeVisible({ timeout: 10000 });

    await expect(page.getByText(/What would you like to change/)).toBeVisible();

    // Chat input should be present
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible();

    // Back button (aria-label="Back") should be present
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();

    // Screenshot: edit page loaded with entry data
    await captureScreenshots(page, 'edit-food');
  });

  test('sends chat message and receives edited analysis', async ({ page, request }) => {
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const firstEntry = body.data.entries[0];

    // Mock /api/edit-chat SSE endpoint
    await page.route('**/api/edit-chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: buildChatSSE(
          "I've updated the portion to 180g. Calories adjusted to 297.",
          MOCK_ANALYSIS
        ),
      });
    });

    await page.goto(`/app/edit/${firstEntry.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for initial greeting
    await expect(page.getByText(/You logged/)).toBeVisible({ timeout: 10000 });

    // Type and send a message
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('The portion was smaller, about 180g');
    await page.getByRole('button', { name: 'Send' }).click();

    // Wait for assistant response
    await expect(page.getByText(/I've updated the portion/)).toBeVisible({ timeout: 10000 });

    // After analysis arrives, "Save Changes" button should appear in the header
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible({ timeout: 5000 });

    // Screenshot: edit chat with conversation and Save Changes button
    await captureScreenshots(page, 'edit-food-chat');
  });

  test('save changes shows confirmation screen', async ({ page, request }) => {
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const firstEntry = body.data.entries[0];

    // Mock /api/edit-chat SSE endpoint with analysis
    await page.route('**/api/edit-chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: buildChatSSE("Updated! Portion adjusted to 180g.", MOCK_ANALYSIS),
      });
    });

    // Mock /api/edit-food to return success
    await page.route('**/api/edit-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { success: true, reusedFood: false, foodLogId: firstEntry.id },
        }),
      });
    });

    await page.goto(`/app/edit/${firstEntry.id}`);
    await page.waitForLoadState('networkidle');

    // Wait for initial greeting
    await expect(page.getByText(/You logged/)).toBeVisible({ timeout: 10000 });

    // Send a message to trigger analysis response
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('The portion was smaller, about 180g');
    await page.getByRole('button', { name: 'Send' }).click();

    // Wait for response with analysis
    await expect(page.getByText(/Updated/)).toBeVisible({ timeout: 10000 });

    // "Save Changes" button should appear in header after analysis arrives
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible({ timeout: 5000 });

    // Click Save Changes
    await page.getByRole('button', { name: 'Save Changes' }).click();

    // Wait for confirmation screen
    await expect(page.getByText(/logged successfully/i)).toBeVisible({ timeout: 10000 });

    // Screenshot: confirmation screen after save
    await captureScreenshots(page, 'edit-food-confirmation');
  });

  test('invalid entry ID shows error state', async ({ page }) => {
    await page.goto('/app/edit/99999');
    await page.waitForLoadState('networkidle');

    // Should show error message
    await expect(
      page.getByText('Something went wrong loading this food entry.')
    ).toBeVisible({ timeout: 10000 });

    // Back button should still be present
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  });
});
