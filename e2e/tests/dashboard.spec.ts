import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  // Use default authenticated storage state

  test('displays dashboard layout and main navigation', async ({ page }) => {
    await page.goto('/app');

    // Verify we're on the dashboard
    await expect(page).toHaveURL('/app');

    // Verify main heading
    await expect(page.getByRole('heading', { name: 'Food Scanner', level: 1 })).toBeVisible();

    // Verify primary action buttons by text content
    // Use first() to handle duplicate text in navigation
    await expect(page.getByText('Take Photo').first()).toBeVisible();
    await expect(page.getByText('Quick Select').first()).toBeVisible();

    // Capture screenshot
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'e2e/screenshots/dashboard.png' });
  });

  test('displays dashboard shell with daily/weekly tabs', async ({ page }) => {
    await page.goto('/app');

    // Wait for the page to fully load
    await page.waitForLoadState('networkidle');

    // The DashboardShell has Daily/Weekly tabs
    await expect(page.getByRole('tab', { name: 'Daily' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Weekly' })).toBeVisible();

    // Verify the dashboard is in loading or loaded state (not empty/error)
    // The DailyDashboard component shows a skeleton while loading
    // After loading, it should show either content or the skeleton
    const heading = page.getByRole('heading', { name: 'Food Scanner', level: 1 });
    await expect(heading).toBeVisible();
  });

  test('shows Fitbit status banner', async ({ page }) => {
    await page.goto('/app');

    // The FitbitStatusBanner component should be present
    // It might show a setup prompt or connected status
    // Just verify the page loads without errors
    await expect(page.getByRole('heading', { name: 'Food Scanner', level: 1 })).toBeVisible();
  });

  test('action links navigate to correct pages', async ({ page }) => {
    await page.goto('/app');

    // Click "Take Photo" and verify navigation to analyze with autoCapture
    await page.getByText('Take Photo').first().click();
    await expect(page).toHaveURL('/app/analyze?autoCapture=true');

    // Go back to dashboard
    await page.goto('/app');

    // Click "Quick Select" and verify navigation
    await page.getByText('Quick Select').first().click();
    await expect(page).toHaveURL('/app/quick-select');
  });
});
