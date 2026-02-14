# Implementation Plan

**Status:** COMPLETE
**Branch:** feat/FOO-439-e2e-playwright-setup
**Issues:** FOO-439, FOO-440, FOO-441, FOO-442, FOO-443
**Created:** 2026-02-14
**Last Updated:** 2026-02-14

## Summary

Add end-to-end browser testing with Playwright. This is a 5-step incremental implementation: Playwright infrastructure, test-auth bypass route, shared fixtures/utilities, initial smoke tests, and screenshot capture. All tests run against a production build served locally, using a dedicated test database with direct Drizzle seeding. The auth bypass route is gated by `ENABLE_TEST_AUTH` env var and cannot exist in production.

## Issues

### FOO-439: Set up Playwright infrastructure

**Priority:** Medium
**Labels:** Feature
**Description:** Install Playwright, configure it to test against a production build, create the `e2e/` directory structure, update project config files.

**Acceptance Criteria:**
- [ ] `@playwright/test` installed as dev dependency
- [ ] `playwright.config.ts` configured with `webServer` using production build on port 3001
- [ ] `e2e/` directory structure created: `fixtures/`, `tests/`
- [ ] `.gitignore` updated: `test-results/`, `playwright-report/`, `e2e/screenshots/`
- [ ] `package.json` has `e2e` script
- [ ] `.env.sample` updated with `ENABLE_TEST_AUTH` entry
- [ ] A trivial test proves the setup works

### FOO-440: Add test-only auth bypass route for E2E

**Priority:** Medium
**Labels:** Feature
**Description:** Create `POST /api/auth/test-login` route that bypasses Google OAuth for E2E tests. Gated on `ENABLE_TEST_AUTH=true` — returns 404 when unset. Reuses the same session machinery as the real OAuth callback.

**Acceptance Criteria:**
- [ ] Route at `src/app/api/auth/test-login/route.ts`
- [ ] Returns 404 when `ENABLE_TEST_AUTH` is not `"true"`
- [ ] Creates or finds test user via `getOrCreateUser()`
- [ ] Creates session via `createSession()`
- [ ] Sets iron-session cookie via `getRawSession()` + `save()`
- [ ] Returns 200 with user info on success
- [ ] Unit tests cover: happy path, env var gating, error cases

### FOO-441: Create E2E test fixtures and utilities

**Priority:** Medium
**Labels:** Feature
**Description:** Build shared E2E infrastructure: auth fixture (hits test-login, saves storage state), seed/truncate DB utilities with direct Drizzle access, global setup/teardown, and `.env.test` configuration.

**Acceptance Criteria:**
- [ ] Auth fixture authenticates via test-login and persists storage state for reuse
- [ ] Seed utilities insert test user, sample food entries, and custom foods
- [ ] Truncate utility clears all tables between test runs
- [ ] Global setup: truncate → seed → authenticate → save storage state
- [ ] Global teardown: truncate DB
- [ ] `.env.test` file with test-specific environment variables
- [ ] All E2E tests can import and use these fixtures

### FOO-442: Write initial E2E smoke tests

**Priority:** Medium
**Labels:** Feature
**Description:** Minimal browser tests to validate the E2E pipeline: landing page, auth redirects, authenticated dashboard access.

**Acceptance Criteria:**
- [ ] `landing.spec.ts`: Landing page loads, key content visible
- [ ] `auth.spec.ts`: Unauthenticated user redirected from `/app` to `/`; authenticated user can access `/app`
- [ ] `dashboard.spec.ts`: Dashboard loads with seeded data, food entries visible
- [ ] All tests pass against production build

### FOO-443: Add screenshot capture to E2E tests

**Priority:** Low
**Labels:** Feature
**Description:** Capture screenshots at key points in smoke tests. Saved to `e2e/screenshots/` (gitignored). Overwritten each run — no accumulation. For visual review only, not baseline diffing.

**Acceptance Criteria:**
- [ ] Screenshots captured for: landing page, dashboard, settings
- [ ] Saved to `e2e/screenshots/` directory
- [ ] Overwritten on each test run
- [ ] Screenshots can be viewed via Claude Code's Read tool

## Prerequisites

- [ ] Docker Postgres running locally (existing `docker-compose.yml`)
- [ ] Local `.env` file configured
- [ ] Node dependencies installed (`npm install`)

## Implementation Tasks

### Task 1: Install Playwright and create directory structure

**Issue:** FOO-439
**Files:**
- `playwright.config.ts` (create)
- `e2e/tests/.gitkeep` (create — placeholder for test directory)
- `package.json` (modify — add script + dependency)
- `.gitignore` (modify — add Playwright artifacts)
- `.env.sample` (modify — add `ENABLE_TEST_AUTH`)

**TDD Steps:**

1. **RED** — Install `@playwright/test` as dev dependency. Install Playwright browsers (`npx playwright install --with-deps chromium` — only Chromium needed for smoke tests, saves CI time). Create `playwright.config.ts` at project root. Key config:
   - `testDir`: `./e2e/tests`
   - `webServer`: run `npm run build && npm start` on port 3001 (use `PORT` env var)
   - `baseURL`: `http://localhost:3001`
   - `outputDir`: `test-results`
   - `use.trace`: `on-first-retry`
   - Single project: Chromium desktop
   - `globalSetup` and `globalTeardown` pointing to `e2e/global-setup.ts` and `e2e/global-teardown.ts` (will be created in Task 5)
   - `retries`: 0 for local, configurable
   - Environment: load `.env.test` via `dotenv` in config (Playwright doesn't auto-load .env files — use `dotenv/config` or `loadEnvFile` at top of config)

   Create `e2e/tests/` directory. Add `e2e` script to `package.json`: `npx playwright test`. Create a trivial test `e2e/tests/health.spec.ts` that hits `GET /api/health` and asserts 200 + `status: "ok"`. Run `npm run e2e`. Expect it to fail because global setup/teardown files don't exist yet.

2. **GREEN** — Create stub `e2e/global-setup.ts` and `e2e/global-teardown.ts` files (empty async functions). Run `npm run e2e` again. The health check test should pass.

3. **REFACTOR** — Update `.gitignore` with `test-results/`, `playwright-report/`, `e2e/screenshots/`. Add `ENABLE_TEST_AUTH` to `.env.sample` with comment. Verify `npm run build` still succeeds (Playwright config shouldn't affect Next.js build).

**Notes:**
- Playwright's `webServer` will build + start the app automatically when running tests
- Port 3001 avoids conflict with dev server on 3000
- Only installing Chromium keeps the install fast
- The `.env.test` file will be created in Task 5 — for now, the health endpoint doesn't need auth

### Task 2: Create test-login route (unit tests first)

**Issue:** FOO-440
**Files:**
- `src/app/api/auth/test-login/route.ts` (create)
- `src/app/api/auth/test-login/__tests__/route.test.ts` (create)

**TDD Steps:**

1. **RED** — Write unit tests in `src/app/api/auth/test-login/__tests__/route.test.ts`. Follow the mocking patterns from existing auth route tests (e.g., `src/app/api/auth/google/callback/__tests__/route.test.ts` for how to mock session, user, and iron-session modules). Tests to write:
   - When `ENABLE_TEST_AUTH` is not set → returns 404 response
   - When `ENABLE_TEST_AUTH` is `"false"` → returns 404 response
   - When `ENABLE_TEST_AUTH` is `"true"`:
     - Calls `getOrCreateUser()` with a test email (e.g., `test@example.com`) and name
     - Calls `createSession()` with the returned user ID
     - Gets raw iron-session via `getRawSession()`, sets `sessionId`, calls `save()`
     - Returns 200 JSON with `{ success: true, data: { userId, email } }`
   - When `getOrCreateUser()` throws → returns 500 error
   - When `createSession()` throws → returns 500 error

   Mock `@/lib/user` (`getOrCreateUser`), `@/lib/session` (`createSession`, `getRawSession`), and `iron-session` (`getIronSession`). Use `vi.stubEnv()` for the env var.

   Run: `npm test -- test-login`
   Verify: All tests fail (route doesn't exist)

2. **GREEN** — Create `src/app/api/auth/test-login/route.ts`. Export a `POST` handler that:
   - Checks `process.env.ENABLE_TEST_AUTH === 'true'` — if not, return 404 (use `NextResponse.json` with status 404, or use the project's `errorResponse` helper)
   - Calls `getOrCreateUser('test@example.com', 'Test User')` from `@/lib/user`
   - Calls `createSession(user.id)` from `@/lib/session`
   - Gets `getRawSession(cookies())` (follow pattern from Google OAuth callback), sets `sessionId = session.id`, calls `save()`
   - Returns 200 with `apiResponse({ userId: user.id, email: user.email })`
   - Wraps in try/catch, returns 500 on error

   Reference: `src/app/api/auth/google/callback/route.ts` for the exact session creation pattern (iron-session cookie setting).

   Run: `npm test -- test-login`
   Verify: All tests pass

3. **REFACTOR** — Ensure error responses use the project's standardized format (`apiResponse` / `errorResponse` from `@/lib/api-response.ts`). Use pino logger for errors. Verify the route is excluded from middleware auth (it's under `/api/auth/` which is already excluded by the middleware matcher).

**Notes:**
- The middleware matcher excludes `/api/auth/*` paths, so this route won't be blocked
- Use `ALLOWED_EMAILS` from env for the test user email? No — the test-login route is a bypass, so use a hardcoded test email. But `getOrCreateUser` will insert it into the users table, and the `ALLOWED_EMAILS` check only happens in the Google callback, not in `getOrCreateUser`. So any email works.
- Actually, check if the test email should match `ALLOWED_EMAILS` — the Google callback checks this, but test-login bypasses that check entirely. The route itself is the security boundary (gated by `ENABLE_TEST_AUTH`).

### Task 3: Create auth fixture and storage state

**Issue:** FOO-441
**Files:**
- `e2e/fixtures/auth.ts` (create)
- `.env.test` (create)

**TDD Steps:**

1. **RED** — Create `.env.test` with test environment variables:
   - `DATABASE_URL` pointing to local Postgres (same Docker instance, could use a separate `food_scanner_test` DB or the dev DB — since this is single-user, reusing dev DB with truncation is acceptable, but a separate test DB is safer)
   - `SESSION_SECRET` (any 32+ char string)
   - `APP_URL=http://localhost:3001`
   - `ALLOWED_EMAILS=test@example.com`
   - `ENABLE_TEST_AUTH=true`
   - `FITBIT_DRY_RUN=true`
   - `ANTHROPIC_API_KEY=test-key` (won't actually call Claude in smoke tests)
   - `PORT=3001`

   Create `e2e/fixtures/auth.ts` — a Playwright fixture that extends the base `test` object. It should:
   - Provide an `authenticatedPage` fixture: makes a POST to `/api/auth/test-login`, captures the response cookies, saves to a `storageState` file
   - Alternatively, use Playwright's `storageState` option with global setup

   The preferred approach: in global setup, make a fetch to `http://localhost:3001/api/auth/test-login`, save the returned cookie to a storage state JSON file, then configure Playwright to use that storage state for authenticated test projects.

   Write a simple E2E test `e2e/tests/auth-fixture.spec.ts` that uses the authenticated context and verifies it can access `/app` without redirect. Run `npm run e2e`. Expect failure (global setup doesn't authenticate yet).

2. **GREEN** — Update `e2e/global-setup.ts` to:
   - Make a POST request to `http://localhost:3001/api/auth/test-login`
   - Save the response cookies as Playwright storage state to `e2e/.auth/storage-state.json`
   - Use Playwright's `request.newContext()` API for cookie management

   Update `playwright.config.ts`:
   - Add a `setup` project that runs `e2e/global-setup.ts` as a setup dependency
   - Alternatively, use `globalSetup` with programmatic auth (both patterns are valid — the `globalSetup` approach is simpler for a single-user app)
   - Configure the main test project to use `storageState: 'e2e/.auth/storage-state.json'`

   Add `e2e/.auth/` to `.gitignore`.

   Run `npm run e2e`. The auth fixture test should pass — authenticated page reaches `/app`.

3. **REFACTOR** — Ensure storage state file path is a constant shared between setup and config. Consider whether to also export a `createUnauthenticatedContext` helper for tests that need to verify redirect behavior (unauthenticated users). Add `e2e/.auth/` to `.gitignore`.

**Notes:**
- Playwright's `globalSetup` runs before any tests and the server is already started by `webServer` config
- The `.env.test` file should NOT be gitignored — it contains no secrets (test values only) and other developers need it
- Decision: use a separate test database `food_scanner_test`? For a single-user app with truncation, the dev DB is fine. But a separate DB avoids accidents. Recommend creating `food_scanner_test` in docker-compose or using the same DB with truncation. The simpler approach: add a `food_scanner_test` database to docker-compose initialization.

### Task 4: Create seed and truncate utilities

**Issue:** FOO-441
**Files:**
- `e2e/fixtures/db.ts` (create)

**TDD Steps:**

1. **RED** — Create `e2e/fixtures/db.ts` with two exported functions:
   - `seedTestData()` — inserts a test user, sample custom foods, and sample food log entries using direct Drizzle access. Import from `@/db/index` (the `getDb()` function) and `@/db/schema` for table references.
   - `truncateAllTables()` — deletes all rows from all tables in reverse-dependency order (food_log_entries → custom_foods → claude_usage → daily_calorie_goals → lumen_goals → api_keys → fitbit_tokens → fitbit_credentials → sessions → users)

   The seed data should be realistic enough for smoke tests:
   - 1 user: `test@example.com` / `Test User`
   - 2-3 custom foods with varying nutrition data
   - 2-3 food log entries for today's date
   - 1 session for the test user (must match what test-login creates)

   Actually, the test-login route creates the user and session dynamically. So seeding should focus on food data that the user would see on the dashboard. The user and session are created by the auth flow.

   Revised approach: `seedTestData(userId: string)` takes a userId (obtained after auth) and inserts sample food data. But global setup needs the userId... The simpler pattern: test-login creates user+session, then seed uses the known test email to look up the user and insert food data.

   Run `npm run e2e` — expect existing tests still pass but new seed functions are untested at this point. They'll be validated when integrated into global setup.

2. **GREEN** — Update `e2e/global-setup.ts` to call `truncateAllTables()` before auth, then call `seedTestData()` after auth (so the test user exists). Update `e2e/global-teardown.ts` to call `truncateAllTables()`.

   Important: the E2E fixtures need to import from `@/db/` — this requires the `@/` path alias to resolve in the Playwright context. Options:
   - Configure `tsconfig` paths in Playwright (Playwright respects `tsconfig.json` automatically when using TypeScript)
   - Or use relative imports from `e2e/` to `src/db/`

   Playwright should resolve `@/` paths if the root `tsconfig.json` is configured — verify this works.

   Run `npm run e2e`. All tests should still pass, and seeded food data should be visible on the dashboard.

3. **REFACTOR** — Extract table truncation order into a constant. Add a `closeDb()` call in global teardown to cleanly close the DB pool after tests. Ensure seed data matches the types expected by the dashboard components.

**Notes:**
- Drizzle schema imports work because Playwright runs in Node.js, not in the browser
- The `getDb()` function from `src/db/index.ts` uses `DATABASE_URL` from the environment — `.env.test` must be loaded before these imports
- `dotenv` config loading in `playwright.config.ts` ensures env vars are available when global setup runs
- The database connection pool should be closed in global teardown to avoid hanging processes
- Consider: do we need fitbit_tokens/fitbit_credentials seeded? The dashboard might require Fitbit connection. Check what `validateSession({ requireFitbit: true })` checks — if smoke tests hit pages that require Fitbit, we need to seed mock tokens. However, the test-login route only creates user+session, not Fitbit data. For the initial smoke tests, test the dashboard in "setup Fitbit" state or seed Fitbit credentials/tokens too. The simpler approach for initial smoke tests: verify pages load, don't test Fitbit-dependent features yet.

### Task 5: Write landing page smoke test

**Issue:** FOO-442
**Files:**
- `e2e/tests/landing.spec.ts` (create)

**TDD Steps:**

1. **RED** — Write `e2e/tests/landing.spec.ts`. This test should NOT use the authenticated storage state (test as unauthenticated visitor):
   - Navigate to `/`
   - Assert the page title or key heading is visible (check what the landing page renders — look at `src/app/page.tsx` for the actual heading text)
   - Assert the "Login with Google" button/link is visible
   - Assert the page loads without errors (no console errors)

   Run: `npm run e2e -- landing`
   Verify: Tests should pass (landing is public, no auth needed)

2. **GREEN** — If any assertions fail, adjust the selectors/text to match the actual page content. The landing page may redirect to `/app` if a session exists — ensure this test uses an unauthenticated context (no storage state).

   In `playwright.config.ts`, consider having two projects:
   - `authenticated` — uses storage state (default for most tests)
   - `unauthenticated` — no storage state (for landing page and auth redirect tests)

   Or: individual tests can override storage state with `test.use({ storageState: undefined })`.

3. **REFACTOR** — Ensure test assertions use accessible selectors (roles, text) rather than CSS classes or data-testid.

### Task 6: Write auth redirect smoke test

**Issue:** FOO-442
**Files:**
- `e2e/tests/auth.spec.ts` (create)

**TDD Steps:**

1. **RED** — Write `e2e/tests/auth.spec.ts` with two test cases:
   - **Unauthenticated redirect:** Navigate to `/app` without auth cookies. Assert redirect to `/` (the middleware redirects unauthenticated users). Use `test.use({ storageState: undefined })` or an unauthenticated project.
   - **Authenticated access:** Navigate to `/app` with auth cookies (from storage state). Assert the page loads (no redirect), key dashboard element is visible.

   Run: `npm run e2e -- auth`
   Verify: Tests pass

2. **GREEN** — If the redirect assertion needs adjustment (e.g., check final URL is `/`), update accordingly. The middleware returns 302 redirect for page routes.

3. **REFACTOR** — Consider testing `/settings` redirect too (same middleware protection). Keep tests focused on verifying the auth boundary works, not page content.

### Task 7: Write dashboard smoke test

**Issue:** FOO-442
**Files:**
- `e2e/tests/dashboard.spec.ts` (create)

**TDD Steps:**

1. **RED** — Write `e2e/tests/dashboard.spec.ts` using the authenticated context:
   - Navigate to `/app`
   - Assert the dashboard heading/layout is visible
   - Assert key interactive elements exist ("Take Photo" button or similar, based on actual dashboard content)
   - If food data was seeded, assert food entries are visible in the food log

   Note: The dashboard may require Fitbit connection (`validateSession({ requireFitbit: true })`). If so, the test may need to either:
   - Seed fitbit_credentials and fitbit_tokens for the test user, OR
   - Navigate to a page that doesn't require Fitbit (e.g., `/app/setup-fitbit`), OR
   - Accept that the dashboard redirects to setup and test that flow instead

   Check what the actual dashboard page does when Fitbit is not connected — the `getSession()` response includes `hasFitbitTokens` and `hasFitbitCredentials`. The page component decides what to show.

   Run: `npm run e2e -- dashboard`
   Verify: Test results show what actually renders (may need seed data adjustment)

2. **GREEN** — Based on what the dashboard actually renders without Fitbit tokens:
   - If it shows a "Setup Fitbit" prompt → assert that prompt is visible, test passes
   - If it requires Fitbit → add Fitbit credential/token seeding to `seedTestData()` so the full dashboard renders
   - Adjust assertions to match actual page content

3. **REFACTOR** — Ensure test data is realistic. The dashboard should render meaningful content for visual verification in the screenshot step.

**Notes:**
- The dashboard behavior depends on Fitbit connection state — the test should document what state it's testing
- If Fitbit seeding is needed: insert rows into `fitbit_credentials` (client ID + encrypted secret) and `fitbit_tokens` (access token + refresh token + future expiry). The tokens don't need to be real since `FITBIT_DRY_RUN=true` prevents actual API calls. But encrypted secret in `fitbit_credentials` uses `encryptSecret()` from `src/lib/encryption.ts` — seed must use the same encryption or insert pre-encrypted values.

### Task 8: Add screenshot capture to smoke tests

**Issue:** FOO-443
**Files:**
- `e2e/tests/landing.spec.ts` (modify)
- `e2e/tests/dashboard.spec.ts` (modify)
- `e2e/tests/auth.spec.ts` (modify — optional)

**TDD Steps:**

1. **RED** — Add `page.screenshot({ path: 'e2e/screenshots/<name>.png', fullPage: true })` calls to existing smoke tests:
   - `landing.spec.ts` → `e2e/screenshots/landing.png`
   - `dashboard.spec.ts` → `e2e/screenshots/dashboard.png`
   - Consider `settings.spec.ts` if a settings test exists, or add a screenshot-only test for `/settings`

   Create `e2e/screenshots/` directory (add `.gitkeep` since the directory is gitignored but needs to exist).

   Run: `npm run e2e`
   Verify: Screenshots are saved to `e2e/screenshots/`

2. **GREEN** — If screenshots don't render properly (e.g., page not fully loaded), add `page.waitForLoadState('networkidle')` before capturing. Ensure the `e2e/screenshots/` directory is created by the test or by global setup.

3. **REFACTOR** — Consider extracting a helper function `captureScreenshot(page, name)` in `e2e/fixtures/screenshots.ts` that handles directory creation and consistent naming. Keep it simple — a one-liner helper is fine.

**Notes:**
- `fullPage: true` captures the entire scrollable page, not just the viewport
- Screenshots are overwritten each run (Playwright's default behavior with fixed paths)
- The `e2e/screenshots/` directory is already in `.gitignore` from Task 1
- These screenshots can be read by Claude Code's Read tool for visual design reviews

### Task 9: Settings page test and final integration

**Issue:** FOO-442, FOO-443
**Files:**
- `e2e/tests/settings.spec.ts` (create)
- Various existing files (verify)

**TDD Steps:**

1. **RED** — Write `e2e/tests/settings.spec.ts`:
   - Navigate to `/settings` (authenticated)
   - Assert key settings sections are visible
   - Capture screenshot to `e2e/screenshots/settings.png`

2. **GREEN** — Ensure the settings page renders with the test user's data. Adjust assertions to match actual content.

3. **REFACTOR** — Run the full E2E suite: `npm run e2e`. Verify:
   - All tests pass
   - Screenshots are generated
   - No console errors in browser
   - Run `npm test` (unit tests still pass)
   - Run `npm run lint` (no lint errors)
   - Run `npm run typecheck` (no type errors)
   - Run `npm run build` (build succeeds)

### Task 10: Update documentation

**Issue:** FOO-439, FOO-440, FOO-441, FOO-442, FOO-443
**Files:**
- `CLAUDE.md` (modify)
- `DEVELOPMENT.md` (modify)
- `.env.sample` (verify already updated)

**Steps:**

1. Update `CLAUDE.md`:
   - Add `e2e/` to the STRUCTURE section with description
   - Add `npm run e2e` to COMMANDS section
   - Add note about `ENABLE_TEST_AUTH` in SECURITY section
   - Add test-login route to the API route auth convention list

2. Update `DEVELOPMENT.md`:
   - Add E2E testing section: how to run, prerequisites, test database setup
   - Document the `.env.test` file and its purpose
   - Note: `npx playwright install chromium` needed on first setup

3. Verify `.env.sample` has `ENABLE_TEST_AUTH` entry.

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move FOO-439 through FOO-443 to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| `ENABLE_TEST_AUTH` not set | test-login returns 404 | Unit test |
| `ENABLE_TEST_AUTH` set to `"false"` | test-login returns 404 | Unit test |
| Test user creation fails | test-login returns 500 | Unit test |
| Session creation fails | test-login returns 500 | Unit test |
| Unauthenticated access to `/app` | Redirect to `/` | E2E auth test |
| Database connection failure in E2E | Global setup fails with clear error | Manual verification |

## Risks & Open Questions

- [ ] **Fitbit connection state:** The dashboard may require Fitbit credentials/tokens. If `validateSession({ requireFitbit: true })` is called on `/app`, the test user needs seeded Fitbit data. The implementer should check what the dashboard renders without Fitbit and decide whether to seed tokens or test the "setup" state.
- [ ] **Path alias resolution:** Playwright TypeScript support should resolve `@/` paths from `tsconfig.json`. If it doesn't, the seed/truncate utilities will need relative imports from `e2e/` to `src/`. Verify during Task 4.
- [ ] **CI/CD consideration:** These tests require a running Postgres. CI pipeline setup is out of scope — this plan covers local development only. A separate backlog issue can address CI integration.
- [ ] **Test database isolation:** Using the dev database with truncation is simple but risks conflicts if dev server is running simultaneously. A separate `food_scanner_test` DB is safer. Recommend adding it to `docker-compose.yml` init script or using a Playwright setup script.

## Scope Boundaries

**In Scope:**
- Playwright installation and configuration
- Test-only auth bypass route with env var gating
- E2E fixtures: auth, seed, truncate, global setup/teardown
- Smoke tests: landing, auth redirects, dashboard, settings
- Screenshot capture for visual review
- Documentation updates

**Out of Scope:**
- CI/CD pipeline for E2E tests (separate backlog issue)
- Visual regression testing (baseline snapshot diffing)
- Mobile viewport testing (can be added later)
- Food analysis E2E tests (requires Claude API mocking — future scope)
- Fitbit OAuth flow E2E tests (requires Fitbit API mocking — future scope)
- Performance/load testing

---

## Iteration 1

**Implemented:** 2026-02-14
**Method:** Agent team (2 workers)

### Tasks Completed This Iteration
- Task 1: Install Playwright and create directory structure (FOO-439) - worker-1
- Task 2: Create test-login route (FOO-440) - worker-2
- Task 3: Create auth fixture and storage state (FOO-441) - worker-1
- Task 4: Create seed and truncate utilities (FOO-441) - worker-1
- Task 5: Write landing page smoke test (FOO-442) - worker-1
- Task 6: Write auth redirect smoke test (FOO-442) - worker-1
- Task 7: Write dashboard smoke test (FOO-442) - worker-1
- Task 8: Add screenshot capture to smoke tests (FOO-443) - worker-1
- Task 9: Settings page test and final integration (FOO-442, FOO-443) - worker-1
- Task 10: Update documentation (FOO-439–443) - worker-1

### Files Modified
- `playwright.config.ts` - Created Playwright config with webServer, globalSetup, storageState
- `e2e/global-setup.ts` - Truncate DB, authenticate via test-login, seed data, save storage state
- `e2e/global-teardown.ts` - Truncate DB, close DB pool
- `e2e/fixtures/auth.ts` - STORAGE_STATE_PATH constant, UNAUTHENTICATED helper
- `e2e/fixtures/db.ts` - truncateAllTables(), seedTestData() with Drizzle direct access
- `e2e/tests/health.spec.ts` - Health check API test
- `e2e/tests/landing.spec.ts` - Landing page content + screenshot
- `e2e/tests/auth.spec.ts` - Auth redirect tests (4 cases: unauth/auth × /app /settings)
- `e2e/tests/dashboard.spec.ts` - Dashboard layout + tabs + screenshot
- `e2e/tests/settings.spec.ts` - Settings page + screenshot
- `src/app/api/auth/test-login/route.ts` - POST handler with ENABLE_TEST_AUTH gating
- `src/app/api/auth/test-login/__tests__/route.test.ts` - 8 unit tests
- `.env.test` - Test environment variables
- `.env.sample` - Added ENABLE_TEST_AUTH entry
- `.gitignore` - Added Playwright artifacts, e2e/.auth/
- `package.json` - Added @playwright/test, dotenv, e2e script
- `CLAUDE.md` - Added E2E docs to COMMANDS, STRUCTURE, SECURITY sections
- `DEVELOPMENT.md` - Added E2E testing section

### Linear Updates
- FOO-439: Todo → In Progress → Review
- FOO-440: Todo → In Progress → Review
- FOO-441: Todo → In Progress → Review
- FOO-442: Todo → In Progress → Review
- FOO-443: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 critical (missing Request param), 1 medium (env loading concern). Fixed critical, medium was false positive (Playwright dotenv inherits to child).
- verifier: All 1683 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 1, 3, 4, 5, 6, 7, 8, 9, 10 (E2E infrastructure, fixtures, tests, docs)
- Worker 2: Task 2 (test-login route + unit tests)

### Continuation Status
All tasks completed.

## Status: COMPLETE
