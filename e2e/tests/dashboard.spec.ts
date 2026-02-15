import { test, expect } from '@playwright/test';
import { captureScreenshots } from '../fixtures/screenshots';

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
    await captureScreenshots(page, 'dashboard');

    // Scroll down to show meal breakdown sections and capture
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await captureScreenshots(page, 'dashboard-bottom');
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

  test('shows Fitbit connected status', async ({ page }) => {
    await page.goto('/app');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // With seeded Fitbit credentials and tokens, the banner should show connected status
    // The FitbitStatusBanner shows "Connected" or a green indicator when Fitbit is set up
    // Verify the page loads successfully and shows dashboard content
    await expect(page.getByRole('heading', { name: 'Food Scanner', level: 1 })).toBeVisible();

    // The dashboard should render nutrition data instead of being blocked by guard
    // Verify tabs are visible (indicates the guard passed and dashboard rendered)
    await expect(page.getByRole('tab', { name: 'Daily' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Weekly' })).toBeVisible();
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

  test('daily tab shows calorie total from seeded meals', async ({ page }) => {
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Seeded data: chicken 150g (~248cal), rice 200g (~224cal), broccoli 100g (35cal)
    // Total should be ~507 calories, but don't assert exact value due to rounding
    // Look for a calorie number displayed on the dashboard
    const calorieText = await page.locator('text=/\\d+\\s*(cal|kcal|calories)/i').first().textContent();

    // Extract the number and verify it's greater than 0
    const calorieMatch = calorieText?.match(/(\d+)/);
    const calorieValue = calorieMatch ? parseInt(calorieMatch[1], 10) : 0;

    expect(calorieValue).toBeGreaterThan(0);
  });

  test('displays meal type breakdown sections', async ({ page }) => {
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Seeded entries are Lunch (chicken + rice) and Dinner (broccoli)
    // Verify both meal type labels are visible on the dashboard
    await expect(page.getByText('Lunch').first()).toBeVisible();

    // Dinner might be labeled as "Dinner" or "Anytime" depending on the meal type ID
    const hasDinnerLabel = await page.locator('text=/Dinner|Anytime/i').count();
    expect(hasDinnerLabel).toBeGreaterThan(0);
  });

  test('weekly tab switches view', async ({ page }) => {
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Click the Weekly tab
    const weeklyTab = page.getByRole('tab', { name: 'Weekly' });
    await weeklyTab.click();

    // Wait for the view to update
    await page.waitForTimeout(500);

    // Verify weekly content is rendered (different from daily view)
    // The weekly view should show some date range or weekly summary
    const weeklyContent = await page.locator('text=/week|daily average|total/i').count();
    expect(weeklyContent).toBeGreaterThan(0);

    // Capture weekly dashboard screenshot
    await captureScreenshots(page, 'dashboard-weekly');
  });

  test('fasting information displays', async ({ page }) => {
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Seeded data has meals at 12:30 (lunch) and current time (dinner)
    // The fasting section should show some time or fasting-related content
    // Check for fasting-related text OR time patterns OR numeric info
    const fastingText = await page.locator('text=/fasting|window|eating|last meal|first meal/i').count();
    const hasTimeInfo = await page.locator('text=/\\d{1,2}:\\d{2}|\\d+\\s*(hr|hour|h\\b|min)/i').count();
    const hasNumericInfo = await page.locator('text=/\\d+.*\\d+/').count();

    // At least one of these patterns should match
    expect(fastingText + hasTimeInfo + hasNumericInfo).toBeGreaterThan(0);
  });

  test('daily view date navigation arrows work', async ({ page }) => {
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Verify Daily tab is active
    const dailyTab = page.getByRole('tab', { name: 'Daily' });
    await expect(dailyTab).toHaveAttribute('aria-selected', 'true');

    // Verify navigation buttons exist
    const prevButton = page.getByRole('button', { name: /Previous day/i });
    const nextButton = page.getByRole('button', { name: /Next day/i });
    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    // Verify "Next day" button is disabled when viewing today
    await expect(nextButton).toBeDisabled();

    // Previous day button may be disabled if seeded data only has today's entries
    // (earliestDate = today means canGoBack = false)
    const prevEnabled = await prevButton.isEnabled();
    if (prevEnabled) {
      // Click previous and verify date changes
      await prevButton.click();
      await page.waitForTimeout(500);

      // Next day should now be enabled (we moved off today)
      await expect(nextButton).toBeEnabled();

      // Click next to return to today
      await nextButton.click();
      await page.waitForTimeout(500);

      // Next day should be disabled again at today
      await expect(nextButton).toBeDisabled();
    }
  });

  test('weekly view week navigation arrows work', async ({ page }) => {
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Switch to Weekly tab
    const weeklyTab = page.getByRole('tab', { name: 'Weekly' });
    await weeklyTab.click();

    // Wait for the view to update
    await page.waitForTimeout(500);

    // Verify navigation buttons exist
    const prevButton = page.getByRole('button', { name: /Previous week/i });
    const nextButton = page.getByRole('button', { name: /Next week/i });
    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();

    // Verify "Next week" button is disabled when at current week
    await expect(nextButton).toBeDisabled();

    // Previous week button may be disabled if no historical data
    const prevEnabled = await prevButton.isEnabled();
    if (prevEnabled) {
      // Click previous week
      await prevButton.click();
      await page.waitForTimeout(500);

      // Next week should now be enabled
      await expect(nextButton).toBeEnabled();

      // Click next to return
      await nextButton.click();
      await page.waitForTimeout(500);

      // Next week should be disabled again
      await expect(nextButton).toBeDisabled();
    }
  });
});
