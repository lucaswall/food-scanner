import { truncateAllTables } from './fixtures/db';
import { closeDb } from '@/db/index';

/**
 * Global teardown for Playwright E2E tests.
 * Runs once after all tests.
 * - Truncates all database tables (cleanup)
 * - Closes database connection pool
 */
export default async function globalTeardown() {
  // Truncate all tables to clean up test data
  await truncateAllTables();

  // Close database connection pool
  await closeDb();
}
