import path from 'path';
import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';
import { MOCK_ANALYSIS, MOCK_REFINED_ANALYSIS, buildAnalyzeSSE } from '../fixtures/mock-data';

test.describe('Refine Chat Screenshots', () => {
  /**
   * Helper to set up the analyze page with a mocked analysis result,
   * then open the refine chat overlay.
   */
  async function setupChatOverlay(page: import('@playwright/test').Page) {
    // Mock analyze-food API (SSE stream)
    await page.route('**/api/analyze-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: buildAnalyzeSSE(MOCK_ANALYSIS),
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

    await captureScreenshots(page, 'refine-chat-error');

    // Find and click the dismiss button (X icon)
    const dismissButton = page.getByRole('button', { name: /dismiss|close/i }).first();
    await expect(dismissButton).toBeVisible({ timeout: 2000 });
    await dismissButton.click();

    // Verify error is no longer visible
    await expect(page.getByText(/Failed to process message/i)).not.toBeVisible();
  });
});

test.describe('Free-form Chat', () => {
  test('shows greeting message and title header', async ({ page }) => {
    await page.goto('/app/chat');
    await page.waitForLoadState('networkidle');

    // Should show greeting message
    await expect(
      page.getByText(/Hi! Ask me anything about your nutrition/i)
    ).toBeVisible({ timeout: 5000 });

    // Should show "Chat" title in header
    await expect(page.getByRole('heading', { name: 'Chat' })).toBeVisible();

    // Should NOT show "Log to Fitbit" button initially
    expect(await page.getByRole('button', { name: /log to fitbit/i }).count()).toBe(0);

    await captureScreenshots(page, 'chat');
  });

  test('sends message and displays response', async ({ page }) => {
    // Mock chat-food API for free-form chat
    await page.route('**/api/chat-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            message: 'You consumed approximately 1,850 calories today across 3 meals.',
          },
        }),
      });
    });

    await page.goto('/app/chat');
    await page.waitForLoadState('networkidle');

    // Wait for greeting message to ensure page is loaded
    await expect(page.getByText(/Hi! Ask me anything/i)).toBeVisible({ timeout: 5000 });

    // Type and send a message
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('How many calories did I eat today?');
    await page.getByRole('button', { name: 'Send' }).click();

    // Wait for the response
    await expect(page.getByText(/1,850 calories today/i)).toBeVisible({ timeout: 5000 });

    await captureScreenshots(page, 'chat-conversation');

    // Verify "Log to Fitbit" button still not shown (no analysis in response)
    expect(await page.getByRole('button', { name: /log to fitbit/i }).count()).toBe(0);
  });

  test('header updates when analysis arrives from API', async ({ page }) => {
    // Mock chat-food API to return a response WITH analysis
    await page.route('**/api/chat-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            message: "I analyzed that as a chicken breast with rice and vegetables.",
            analysis: {
              food_name: 'Chicken Breast with Rice',
              amount: 300,
              unit_id: 147,
              calories: 450,
              protein_g: 45,
              carbs_g: 40,
              fat_g: 8,
              fiber_g: 3,
              sodium_mg: 420,
              confidence: 'high',
              notes: 'Grilled chicken breast with brown rice and steamed vegetables',
              description: 'Chicken breast meal',
              keywords: ['chicken', 'rice', 'vegetables'],
            },
          },
        }),
      });
    });

    await page.goto('/app/chat');
    await page.waitForLoadState('networkidle');

    // Wait for greeting
    await expect(page.getByText(/Hi! Ask me anything/i)).toBeVisible({ timeout: 5000 });

    // Initially no "Log to Fitbit" button
    expect(await page.getByRole('button', { name: /log to fitbit/i }).count()).toBe(0);

    // Send a message describing food
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('I had chicken breast with rice and vegetables');
    await page.getByRole('button', { name: 'Send' }).click();

    // Wait for response with analysis
    await expect(page.getByText(/I analyzed that as/i)).toBeVisible({ timeout: 5000 });

    // Now "Log to Fitbit" button should appear
    await expect(page.getByRole('button', { name: /log to fitbit/i })).toBeVisible({ timeout: 3000 });

    // MiniNutritionCard should also appear with calorie info
    await expect(page.getByText('450')).toBeVisible();

    await captureScreenshots(page, 'chat-with-analysis');
  });

  test('can log food from free-form chat after analysis arrives', async ({ page }) => {
    let logRequestBody: unknown = null;

    // Mock chat-food API to return analysis
    await page.route('**/api/chat-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            message: "I analyzed that as a protein shake.",
            analysis: {
              food_name: 'Protein Shake',
              amount: 250,
              unit_id: 209, // ml
              calories: 180,
              protein_g: 25,
              carbs_g: 8,
              fat_g: 4,
              fiber_g: 1,
              sodium_mg: 150,
              confidence: 'high',
              notes: 'Whey protein shake with water',
              description: 'Protein shake',
              keywords: ['protein', 'shake', 'whey'],
            },
          },
        }),
      });
    });

    // Mock log-food API
    await page.route('**/api/log-food', async (route) => {
      const request = route.request();
      logRequestBody = request.postDataJSON();

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { success: true, reusedFood: false, fitbitLogId: 99999 },
        }),
      });
    });

    await page.goto('/app/chat');
    await page.waitForLoadState('networkidle');

    // Send message describing food
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('I had a protein shake');
    await page.getByRole('button', { name: 'Send' }).click();

    // Wait for analysis response
    await expect(page.getByText(/I analyzed that as/i)).toBeVisible({ timeout: 5000 });

    // Wait for "Log to Fitbit" button to appear
    await expect(page.getByRole('button', { name: /log to fitbit/i })).toBeVisible({ timeout: 3000 });

    // Click "Log to Fitbit"
    await page.getByRole('button', { name: /log to fitbit/i }).click();

    // Wait for confirmation
    await expect(page.getByText(/logged successfully/i)).toBeVisible({ timeout: 10000 });

    // Verify logged food name
    await expect(page.getByRole('heading', { name: /Protein Shake/i })).toBeVisible();

    // Verify request body
    expect(logRequestBody).toBeTruthy();
    expect(logRequestBody).toMatchObject({
      food_name: 'Protein Shake',
      calories: 180,
      protein_g: 25,
    });
  });

  test('image attachment works in free-form chat', async ({ page }) => {
    let chatRequestBody: unknown = null;

    // Mock chat-food API to capture request with images
    await page.route('**/api/chat-food', async (route) => {
      const request = route.request();
      chatRequestBody = request.postDataJSON();

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            message: "I see a salad in the photo!",
            analysis: {
              food_name: 'Garden Salad',
              amount: 200,
              unit_id: 147,
              calories: 120,
              protein_g: 4,
              carbs_g: 15,
              fat_g: 5,
              fiber_g: 4,
              sodium_mg: 180,
              confidence: 'high',
              notes: 'Fresh garden salad with dressing',
              description: 'Salad',
              keywords: ['salad', 'vegetables'],
            },
          },
        }),
      });
    });

    await page.goto('/app/chat');
    await page.waitForLoadState('networkidle');

    // Click the + button to open photo menu
    await page.getByRole('button', { name: /add photo/i }).click();

    // Click "Choose from gallery" option
    await page.getByRole('button', { name: /choose from gallery/i }).click();

    // Use a real JPEG fixture (compressImage needs a valid image for Canvas API)
    const fileInput = page.locator('input[type="file"][data-testid="chat-gallery-input"]');
    await fileInput.setInputFiles(path.join(__dirname, '..', 'fixtures', 'test-image.jpg'));

    // Wait for photo indicator to appear
    await expect(page.getByTestId('photo-indicator')).toBeVisible({ timeout: 3000 });

    // Type message and send
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('What is this?');
    await page.getByRole('button', { name: 'Send' }).click();

    // Wait for response
    await expect(page.getByText(/I see a salad/i)).toBeVisible({ timeout: 5000 });

    // Verify images were sent in the request
    expect(chatRequestBody).toBeTruthy();
    const body = chatRequestBody as { images?: string[] };
    expect(body.images).toBeDefined();
    expect(body.images!.length).toBeGreaterThan(0);
  });
});
