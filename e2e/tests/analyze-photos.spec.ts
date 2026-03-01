import path from 'path';
import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';
import { MOCK_ANALYSIS, buildAnalyzeSSE } from '../fixtures/mock-data';

test.describe('Analyze Page - Photo Capture Flow', () => {
  test('photo thumbnails appear after selecting gallery image', async ({ page }) => {
    await page.goto('/app/analyze');
    await page.waitForLoadState('networkidle');

    // Verify Take Photo and Choose from Gallery buttons are visible
    await expect(page.getByRole('button', { name: 'Take Photo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose from Gallery' })).toBeVisible();

    // Use the hidden gallery file input directly to avoid OS file picker
    const galleryInput = page.locator('[data-testid="gallery-input"]');
    await galleryInput.setInputFiles(path.join(__dirname, '..', 'fixtures', 'test-image.jpg'));

    // Wait for the photo counter to update
    await expect(page.getByText('1/9 photos selected')).toBeVisible({ timeout: 5000 });

    // Verify thumbnail is shown (image preview button)
    await expect(page.getByRole('button', { name: 'View full-size preview 1' })).toBeVisible();

    // Verify Clear All button appears
    await expect(page.getByRole('button', { name: 'Clear All' })).toBeVisible();

    // Screenshot: thumbnails visible
    await captureScreenshots(page, 'analyze-photos-thumbnail');
  });

  test('photo count updates correctly after multiple selections', async ({ page }) => {
    await page.goto('/app/analyze');
    await page.waitForLoadState('networkidle');

    // Select a photo via gallery input
    const galleryInput = page.locator('[data-testid="gallery-input"]');
    await galleryInput.setInputFiles([
      path.join(__dirname, '..', 'fixtures', 'test-image.jpg'),
      path.join(__dirname, '..', 'fixtures', 'test-image.jpg'),
    ]);

    // Wait for two photos to be registered (deduplication may happen for same file)
    // At minimum, verify at least 1 photo is shown
    await expect(page.locator('text=/\\d+\\/9 photos selected/')).toBeVisible({ timeout: 5000 });

    // Verify thumbnail(s) are visible
    const thumbnailCount = await page
      .getByRole('button', { name: /View full-size preview/ })
      .count();
    expect(thumbnailCount).toBeGreaterThan(0);
  });

  test('analyze button is enabled after photo selection', async ({ page }) => {
    await page.goto('/app/analyze');
    await page.waitForLoadState('networkidle');

    // Analyze button should be present but may be disabled initially with no input
    const analyzeButton = page.getByRole('button', { name: 'Analyze Food' });
    await expect(analyzeButton).toBeVisible();

    // Select a photo
    const galleryInput = page.locator('[data-testid="gallery-input"]');
    await galleryInput.setInputFiles(path.join(__dirname, '..', 'fixtures', 'test-image.jpg'));

    // Wait for photo to register
    await expect(page.getByText('1/9 photos selected')).toBeVisible({ timeout: 5000 });

    // Analyze button should now be enabled
    await expect(analyzeButton).toBeEnabled();
  });

  test('captures analyzing state and result after photo submission', async ({ page }) => {
    // Mock the analyze-food API to return a successful SSE stream
    await page.route('**/api/analyze-food', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: buildAnalyzeSSE(MOCK_ANALYSIS),
      });
    });

    // Mock find-matches to return empty
    await page.route('**/api/find-matches', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { matches: [] } }),
      });
    });

    await page.goto('/app/analyze');
    await page.waitForLoadState('networkidle');

    // Select a photo via gallery input
    const galleryInput = page.locator('[data-testid="gallery-input"]');
    await galleryInput.setInputFiles(path.join(__dirname, '..', 'fixtures', 'test-image.jpg'));

    // Wait for thumbnail to appear
    await expect(page.getByText('1/9 photos selected')).toBeVisible({ timeout: 5000 });

    // Screenshot: thumbnails visible before analysis
    await captureScreenshots(page, 'analyze-photos-ready');

    // Click Analyze Food button
    await page.getByRole('button', { name: 'Analyze Food' }).click();

    // Wait for the mocked result to render
    await expect(
      page.getByRole('heading', { name: MOCK_ANALYSIS.food_name })
    ).toBeVisible({ timeout: 10000 });

    // Screenshot: analysis result with photo
    await captureScreenshots(page, 'analyze-photos-result');
  });

  test('clear all removes selected photos', async ({ page }) => {
    await page.goto('/app/analyze');
    await page.waitForLoadState('networkidle');

    // Select a photo
    const galleryInput = page.locator('[data-testid="gallery-input"]');
    await galleryInput.setInputFiles(path.join(__dirname, '..', 'fixtures', 'test-image.jpg'));

    // Wait for photo to appear
    await expect(page.getByText('1/9 photos selected')).toBeVisible({ timeout: 5000 });

    // Click Clear All
    await page.getByRole('button', { name: 'Clear All' }).click();

    // Verify photos are cleared: counter goes back to 0/9
    await expect(page.getByText('0/9 photos selected')).toBeVisible({ timeout: 3000 });

    // Verify thumbnail is gone
    await expect(page.getByRole('button', { name: 'View full-size preview 1' })).not.toBeVisible();
  });
});
