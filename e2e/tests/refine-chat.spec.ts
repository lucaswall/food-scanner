import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';
import { MOCK_ANALYSIS, MOCK_REFINED_ANALYSIS } from '../fixtures/mock-data';

test.describe('Refine Chat Screenshots', () => {
  /**
   * Helper to set up the analyze page with a mocked analysis result,
   * then open the refine chat overlay.
   */
  async function setupChatOverlay(page: import('@playwright/test').Page) {
    // Mock analyze-food API
    await page.route('**/api/analyze-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: MOCK_ANALYSIS }),
      });
    });

    // Mock find-matches (empty)
    await page.route('**/api/find-matches', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { matches: [] } }),
      });
    });

    await page.goto('/app/analyze');
    await page.waitForLoadState('networkidle');

    // Trigger analysis with a description
    const textarea = page.getByPlaceholder('e.g., 250g pollo asado con chimichurri');
    await textarea.fill('Grilled salmon with vegetables');
    await page.getByRole('button', { name: 'Analyze Food' }).click();

    // Wait for analysis result (use heading to avoid matching textarea)
    await expect(page.getByRole('heading', { name: MOCK_ANALYSIS.food_name })).toBeVisible({ timeout: 5000 });

    // Open the refine chat
    await page.getByRole('button', { name: 'Refine with chat' }).click();

    // Wait for chat overlay to appear
    await expect(page.getByPlaceholder('Type a message...')).toBeVisible({ timeout: 3000 });
  }

  test('captures refine chat initial state', async ({ page }) => {
    await setupChatOverlay(page);

    // The chat should show the initial assistant message
    await expect(
      page.getByText(`I analyzed your food as ${MOCK_ANALYSIS.food_name}`)
    ).toBeVisible();

    await captureScreenshots(page, 'refine-chat');
  });

  test('captures refine chat with user message', async ({ page }) => {
    await setupChatOverlay(page);

    // Type a user message
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('The portion was a bit smaller, around 300g total');

    await captureScreenshots(page, 'refine-chat-typing');
  });

  test('captures refine chat with conversation', async ({ page }) => {
    // Mock chat-food API to return a refined analysis
    await page.route('**/api/chat-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            message: "Got it! I've adjusted the portion to 300g total — 180g salmon, 80g vegetables, and 40g rice. The calories dropped from 420 to 380.",
            analysis: MOCK_REFINED_ANALYSIS,
          },
        }),
      });
    });

    await setupChatOverlay(page);

    // Send a user message
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('The portion was a bit smaller, around 300g total');
    await page.getByRole('button', { name: 'Send' }).click();

    // Wait for the assistant response with nutrition card
    await expect(page.getByText("I've adjusted the portion")).toBeVisible({ timeout: 5000 });

    // Wait for mini nutrition card to render (use exact match to avoid matching the message text)
    await expect(page.getByText('380', { exact: true })).toBeVisible();

    await captureScreenshots(page, 'refine-chat-conversation');
  });

  test('logs refined analysis from chat overlay', async ({ page }) => {
    // Track the log-food request body
    let logRequestBody: unknown = null;

    // Mock chat-food API to return a refined analysis
    await page.route('**/api/chat-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            message: "Got it! I've adjusted the portion to 300g total — 180g salmon, 80g vegetables, and 40g rice. The calories dropped from 420 to 380.",
            analysis: MOCK_REFINED_ANALYSIS,
          },
        }),
      });
    });

    // Set up the chat overlay first (routes analyze-food and find-matches)
    await setupChatOverlay(page);

    // Mock log-food AFTER overlay is open to avoid interfering with page load
    await page.route('**/api/log-food', async (route) => {
      const request = route.request();
      logRequestBody = request.postDataJSON();

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { success: true, reusedFood: false, foodLogId: 12345 },
        }),
      });
    });

    // Send a user message to get refined analysis
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('The portion was a bit smaller, around 300g total');
    await page.getByRole('button', { name: 'Send' }).click();

    // Wait for the assistant response with refined analysis
    await expect(page.getByText("I've adjusted the portion")).toBeVisible({ timeout: 10000 });

    // Wait for mini nutrition card to render before clicking log
    await expect(page.getByText('380', { exact: true })).toBeVisible({ timeout: 5000 });

    // Click "Log to Fitbit" button — use first() since both chat header and analyzer may have this button
    await page.getByRole('button', { name: 'Log to Fitbit' }).first().click();

    // Wait for confirmation screen to render
    await expect(page.getByText(/logged successfully/i)).toBeVisible({ timeout: 10000 });

    // Verify the food name from refined analysis is shown in the success heading
    await expect(page.getByRole('heading', { name: new RegExp(MOCK_REFINED_ANALYSIS.food_name) })).toBeVisible();

    // Verify the logged values match MOCK_REFINED_ANALYSIS
    expect(logRequestBody).toBeTruthy();
    expect(logRequestBody).toMatchObject({
      food_name: MOCK_REFINED_ANALYSIS.food_name,
      calories: MOCK_REFINED_ANALYSIS.calories,
      protein_g: MOCK_REFINED_ANALYSIS.protein_g,
      carbs_g: MOCK_REFINED_ANALYSIS.carbs_g,
      fat_g: MOCK_REFINED_ANALYSIS.fat_g,
    });
  });

  test('shows dismissible error in chat on API failure', async ({ page }) => {
    // Mock chat-food API to return an error
    await page.route('**/api/chat-food', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'CHAT_FAILED', message: 'Failed to process message' },
        }),
      });
    });

    await setupChatOverlay(page);

    // Send a user message
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('Test message');
    await page.getByRole('button', { name: 'Send' }).click();

    // Wait for error banner to appear in the chat
    await expect(page.getByText(/Failed to process message/i)).toBeVisible({ timeout: 5000 });

    // Find and click the dismiss button (X icon)
    const dismissButton = page.getByRole('button', { name: /dismiss|close/i }).first();
    await expect(dismissButton).toBeVisible({ timeout: 2000 });
    await dismissButton.click();

    // Verify error is no longer visible
    await expect(page.getByText(/Failed to process message/i)).not.toBeVisible();
  });
});
