/**
 * Vitest config for the real-Postgres integration test suite.
 *
 * Run via:  INTEGRATION_DATABASE_URL=... npm run test:integration
 *
 * IMPORTANT: point INTEGRATION_DATABASE_URL at a dedicated throwaway Postgres
 * instance — NEVER at DATABASE_URL (dev/prod). The lead applies the schema
 * first via `drizzle-kit push` (see MIGRATIONS.md for the exact setup commands).
 *
 * These tests are excluded from the default `npm test` loop. They require a
 * live DB, take longer (~30 s), and are run as an E2E gate after merge.
 */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.integration.test.ts"],
    // Generous timeout — real Postgres I/O can take a few seconds per test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
