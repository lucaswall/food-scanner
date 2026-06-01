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
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Integration tests require a live Postgres (INTEGRATION_DATABASE_URL) and
    // run via `npm run test:integration` with the dedicated config. Excluded here
    // so the default fast loop stays ~5s and never touches dev/prod databases.
    exclude: ["src/**/*.integration.test.ts"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
