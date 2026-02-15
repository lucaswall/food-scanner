import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

test.describe('History Page', () => {
  // Use default authenticated storage state

  test('page loads with history heading', async ({ page }) => {
    await page.goto('/app/history');

    // Verify we're on the history page
    await expect(page).toHaveURL('/app/history');

    // Verify main heading
    await expect(page.getByRole('heading', { name: 'History', level: 1 })).toBeVisible();
  });

  test('displays seeded food entries after loading', async ({ page }) => {
    await page.goto('/app/history');

    // Wait for network idle to ensure data is loaded
    await page.waitForLoadState('networkidle');

    // Verify seeded food names are visible (skip Broccoli — may be deleted by parallel test)
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible();
    await expect(page.getByText('Brown Rice').first()).toBeVisible();
  });

  test('displays date group header for today', async ({ page }) => {
    await page.goto('/app/history');

    // Wait for network idle to ensure data is loaded
    await page.waitForLoadState('networkidle');

    // Verify "Today" date header is present (don't specify level in case it varies)
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  });

  test('opens detail dialog when clicking on an entry', async ({ page }) => {
    await page.goto('/app/history');

    // Wait for network idle to ensure data is loaded
    await page.waitForLoadState('networkidle');

    // Click on the first entry (Grilled Chicken Breast)
    // Use specific pattern to match entry button aria-label: "food name, X calories"
    // This avoids matching the delete button which has aria-label: "Delete food name"
    await page.getByRole('button', { name: /Grilled Chicken Breast, \d+ calories/ }).click();

    // Verify dialog is open by checking for dialog role
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Verify the nutrition facts card is visible in the dialog
    await expect(dialog.getByRole('heading', { name: 'Nutrition Facts' })).toBeVisible();
  });

  test('displays jump to date input', async ({ page }) => {
    await page.goto('/app/history');

    // Wait for network idle to ensure data is loaded
    await page.waitForLoadState('networkidle');

    // Verify "Jump to date" input is present
    const dateInput = page.getByLabel('Jump to date');
    await expect(dateInput).toBeVisible();
    await expect(dateInput).toHaveAttribute('type', 'date');

    // Verify "Go" button is present
    await expect(page.getByRole('button', { name: 'Go' })).toBeVisible();
  });

  test('captures history page screenshot', async ({ page }) => {
    await page.goto('/app/history');

    // Wait for network idle to ensure data is loaded
    await page.waitForLoadState('networkidle');

    // Capture screenshot
    await captureScreenshots(page, 'history');
  });

  test('jump to date navigates to correct date', async ({ page }) => {
    await page.goto('/app/history');
    await page.waitForLoadState('networkidle');

    // Find the Jump to date input
    const dateInput = page.getByLabel('Jump to date');

    // Set to today's date
    // Use local date (not UTC) to match how the app renders dates
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    await dateInput.fill(today);

    // Click Go button
    const goButton = page.getByRole('button', { name: 'Go' });
    await goButton.click();

    // Wait for navigation/update
    await page.waitForTimeout(500);

    // Verify "Today" header appears with seeded data
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible();
  });

  test('jump to past date shows empty state', async ({ page }) => {
    await page.goto('/app/history');
    await page.waitForLoadState('networkidle');

    // Find the Jump to date input
    const dateInput = page.getByLabel('Jump to date');

    // Fill with a past date that has no entries
    await dateInput.fill('2020-01-01');

    // Click Go button
    const goButton = page.getByRole('button', { name: 'Go' });
    await goButton.click();

    // Wait for page update
    await page.waitForTimeout(500);

    // Assert that "Today" heading is NOT visible
    await expect(page.getByRole('heading', { name: 'Today' })).not.toBeVisible();

    // Assert empty state is shown (no seeded food entries visible)
    const chickenVisible = await page.getByText('Grilled Chicken Breast').isVisible();
    const riceVisible = await page.getByText('Brown Rice').isVisible();
    expect(chickenVisible).toBe(false);
    expect(riceVisible).toBe(false);

    // Capture screenshot of past date empty state
    await captureScreenshots(page, 'history-past-date');
  });

  test('click entry navigates to food detail page', async ({ page, request }) => {
    await page.goto('/app/history');
    await page.waitForLoadState('networkidle');

    // Get entry ID from API first
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const firstEntry = body.data.entries[0];

    // Click on the entry (opens dialog)
    const entryButton = page.getByRole('button', { name: /Grilled Chicken Breast, \d+ calories/ });
    await entryButton.click();

    // Wait for dialog to open
    await page.waitForTimeout(500);

    // Look for "View details" or similar link in the dialog
    const viewDetailsLink = page.locator('a[href*="/app/food-detail/"]');
    await viewDetailsLink.click();

    // Verify navigation to food detail page
    await expect(page).toHaveURL(`/app/food-detail/${firstEntry.id}`);
  });

  test('back button from food detail returns to history', async ({ page, request }) => {
    // Get entry ID
    const response = await request.get('/api/food-history');
    const body = await response.json();
    const entryId = body.data.entries[0].id;

    // Navigate to history first to establish browser history
    await page.goto('/app/history');
    await page.waitForLoadState('networkidle');

    // Then navigate to food detail (so router.back() has history to go back to)
    await page.goto(`/app/food-detail/${entryId}`);
    await page.waitForLoadState('networkidle');

    // Click back button (uses router.back())
    const backButton = page.getByRole('button', { name: /Back/ });
    await backButton.click();

    // Verify return to history
    await expect(page).toHaveURL('/app/history');
  });

  test('displays meal type labels', async ({ page }) => {
    await page.goto('/app/history');
    await page.waitForLoadState('networkidle');

    // Seeded entries are Lunch (chicken + rice) and Dinner (broccoli)
    // Verify meal type labels are visible
    await expect(page.getByText('Lunch').first()).toBeVisible();

    // Dinner might be labeled differently based on meal type ID
    const dinnerLabel = await page.locator('text=/Dinner|Anytime/i').count();
    expect(dinnerLabel).toBeGreaterThan(0);
  });
});
