import { chromium } from '@playwright/test';
import { STORAGE_STATE_PATH } from './fixtures/auth';
import { truncateAllTables, seedTestData } from './fixtures/db';

/**
 * Global setup for Playwright E2E tests.
 * Runs once before all tests.
 * - Truncates all database tables
 * - Authenticates via test-login endpoint (creates test user + session)
 * - Seeds test data (custom foods, food log entries)
 * - Saves session cookies to storage state file
 */
export default async function globalSetup() {
  const baseURL = process.env.APP_URL || 'http://localhost:3001';

  // Truncate all tables before starting tests
  await truncateAllTables();

  // Launch browser and create a new context
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Authenticate via test-login endpoint (creates test user + session in DB)
  const response = await page.request.post(`${baseURL}/api/auth/test-login`);

  if (!response.ok()) {
    throw new Error(
      `Test login failed: ${response.status()} ${await response.text()}`
    );
  }

  // Seed test data (test user now exists in DB)
  await seedTestData();

  // Save the authenticated state (includes session cookies)
  await context.storageState({ path: STORAGE_STATE_PATH });

  // Cleanup
  await browser.close();
}
