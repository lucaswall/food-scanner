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

    // Wait for analysis result
    await expect(page.getByText(MOCK_ANALYSIS.food_name)).toBeVisible({ timeout: 5000 });

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
});
