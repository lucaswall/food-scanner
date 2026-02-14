import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';
import { STORAGE_STATE_PATH } from './e2e/fixtures/auth';

// Load test environment variables (override ensures .env.local doesn't take precedence)
config({ path: '.env.test', override: true });

export default defineConfig({
  testDir: './e2e/tests',
  outputDir: 'test-results',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: 'html',

  // Shared settings for all the projects below
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },

  // Configure global setup and teardown
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        // Use authenticated storage state for all tests by default
        storageState: STORAGE_STATE_PATH,
      },
    },
  ],

  // Run your local dev server before starting the tests
  // NODE_ENV=test prevents Next.js from loading .env.local (which has different SESSION_SECRET)
  webServer: {
    command: 'NODE_ENV=test npm run build && PORT=3001 NODE_ENV=test npm start',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000, // 2 minutes for build + start
  },
});
