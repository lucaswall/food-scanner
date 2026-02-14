import path from 'path';

/**
 * Path to the storage state file containing authenticated session cookies.
 * This file is created by global-setup.ts and used by the default test project.
 */
export const STORAGE_STATE_PATH = path.join(__dirname, '..', '.auth', 'storage-state.json');

/**
 * Constant for tests that need to run without authentication.
 * Use with test.use({ storageState: UNAUTHENTICATED }) to override
 * the default authenticated storage state.
 */
export const UNAUTHENTICATED = undefined;
