import { Page } from '@playwright/test';

/**
 * Captures screenshots in both light and dark mode
 * @param page - Playwright page instance
 * @param name - Screenshot name (without extension)
 */
export async function captureScreenshots(page: Page, name: string) {
  // Light mode screenshot
  await page.screenshot({ path: `e2e/screenshots/light/${name}.png` });

  // Switch to dark mode
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  });
  // Wait for repaint
  await page.waitForTimeout(200);

  // Dark mode screenshot
  await page.screenshot({ path: `e2e/screenshots/dark/${name}.png` });

  // Restore light mode
  await page.evaluate(() => {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  });
}
