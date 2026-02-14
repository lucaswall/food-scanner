import { test, expect } from '@playwright/test';

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

    // Verify seeded food names are visible (use first() to handle duplicates in navigation/dialogs)
    await expect(page.getByText('Grilled Chicken Breast').first()).toBeVisible();
    await expect(page.getByText('Brown Rice').first()).toBeVisible();
    await expect(page.getByText('Steamed Broccoli').first()).toBeVisible();
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
    await page.screenshot({ path: 'e2e/screenshots/history.png' });
  });
});
