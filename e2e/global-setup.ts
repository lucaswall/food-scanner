import { chromium } from '@playwright/test';
import { config } from 'dotenv';
import { STORAGE_STATE_PATH } from './fixtures/auth';
import { truncateAllTables, seedTestData } from './fixtures/db';

// Ensure .env.test values are loaded. Locally, override any .env.local values.
// In CI, do NOT override: the workflow supplies DATABASE_URL pointing at the
// Postgres service host (not localhost), and .env.test only fills gaps. Must match
// the same conditional in playwright.config.ts so the seed/teardown DB connection
// uses the right host.
config({ path: '.env.test', override: !process.env.CI });

/**
 * Global setup for Playwright E2E tests.
 * Runs once before all tests.
 * - Truncates all database tables
 * - Authenticates via test-login endpoint (creates test user + session)
 * - Seeds test data (custom foods, food log entries, Google Health tokens)
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
  const loginResponse = await page.request.post(`${baseURL}/api/auth/test-login`);

  if (!loginResponse.ok()) {
    throw new Error(
      `Test login failed: ${loginResponse.status()} ${await loginResponse.text()}`
    );
  }

  // Seed test data (custom foods, food log entries, Google Health tokens)
  // HEALTH_DRY_RUN=true is set in the test environment — all Health API calls are no-ops
  await seedTestData();

  // Save the authenticated state (includes session cookies)
  await context.storageState({ path: STORAGE_STATE_PATH });

  // Cleanup
  await browser.close();
}
