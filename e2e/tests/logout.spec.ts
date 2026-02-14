import { test, expect } from '@playwright/test';

// Use empty storage state to avoid using the shared authenticated session
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Logout Flow', () => {
  test('logout flow clears session and redirects to landing page', async ({ browser }) => {
    // Create a fresh browser context
    const context = await browser.newContext();
    const page = await context.newPage();

    // Authenticate via test-login endpoint
    await page.request.post('http://localhost:3001/api/auth/test-login');

    // Navigate to settings page
    await page.goto('/settings');
    await expect(page).toHaveURL('/settings');

    // Click the logout button
    await page.getByRole('button', { name: /logout/i }).click();

    // Verify redirect to landing page
    await expect(page).toHaveURL('/');

    // Verify landing page shows "Login with Google" button (confirming unauthenticated state)
    await expect(page.getByRole('button', { name: /login with google/i })).toBeVisible();

    // Verify navigating to /app redirects back to / (session is destroyed)
    await page.goto('/app');
    await expect(page).toHaveURL('/');

    // Clean up
    await context.close();
  });
});
