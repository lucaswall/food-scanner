import { test, expect } from '@playwright/test';

test.describe('Authenticated Access', () => {
  test('can access protected /app route with authentication', async ({ page }) => {
    // Navigate to the protected dashboard
    await page.goto('/app');

    // Should NOT redirect to landing page (/)
    // If authenticated, should stay on /app
    await expect(page).toHaveURL('/app');

    // Verify we're seeing the dashboard content, not the login page
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });
});
