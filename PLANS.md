# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-457-e2e-functional-coverage
**Issues:** FOO-457, FOO-458, FOO-459, FOO-460, FOO-461, FOO-462, FOO-463, FOO-464, FOO-465, FOO-466, FOO-456
**Created:** 2026-02-14
**Last Updated:** 2026-02-14

## Summary

Expand E2E test coverage from layout-only verification to full functional testing. The current 52 tests verify that pages load and elements exist but don't exercise core workflows (logging food, managing API keys, viewing nutrition data). This plan adds ~55 new tests covering: Fitbit guard bypass via seeded data, API data verification, CRUD operations, interactive flows (search, pagination, delete), empty/error states, and dark mode screenshots.

## Issues

### FOO-457: E2E tests show Fitbit guard screens instead of real UI when FITBIT_DRY_RUN=true

**Priority:** High
**Labels:** Bug
**Description:** The test user has no Fitbit credentials or tokens seeded, so `FitbitSetupGuard` blocks the real UI on analyze, quick-select, and dashboard pages. Since `FITBIT_DRY_RUN=true`, seeding mock credentials+tokens enables full UI testing without real Fitbit calls.

**Acceptance Criteria:**
- [ ] `seedTestData()` inserts a `fitbit_credentials` row for the test user
- [ ] `seedTestData()` inserts a `fitbit_tokens` row for the test user
- [ ] `/api/auth/session` returns `fitbitConnected: true` and `hasFitbitCredentials: true`
- [ ] Analyze page shows camera/upload UI instead of setup guard
- [ ] Quick Select page shows food tabs instead of setup guard
- [ ] Dashboard Fitbit banner shows connected status instead of setup prompt
- [ ] Existing guard-specific tests are updated to test the real UI behind the guard

### FOO-464: E2E: Authenticated API endpoints lack data verification tests

**Priority:** High
**Labels:** Feature
**Description:** API auth tests only verify 401 for unauthenticated requests. No tests verify that authenticated requests return correct data from seeded entries.

**Acceptance Criteria:**
- [ ] New test file verifies authenticated GET requests return 200 with correct response structure
- [ ] `GET /api/food-history` returns seeded entries (Grilled Chicken Breast, Brown Rice, Steamed Broccoli)
- [ ] `GET /api/nutrition-summary?date=<today>` returns non-zero totals matching seeded data
- [ ] `GET /api/common-foods?tab=recent` returns seeded foods
- [ ] `GET /api/fasting?date=<today>` returns fasting window from seeded meal times
- [ ] `GET /api/earliest-entry` returns today's date
- [ ] `GET /api/claude-usage` returns 200 with months array
- [ ] `GET /api/fitbit-credentials` returns `hasCredentials: true` (after FOO-457 seeds data)

### FOO-463: E2E: Fitbit credentials save/update flow untested

**Priority:** High
**Labels:** Feature
**Description:** The Fitbit setup form and settings credentials section have no tests for submitting, saving, or updating credentials. Tests only verify form inputs exist.

**Acceptance Criteria:**
- [ ] Submit empty form shows validation errors
- [ ] Submit valid Client ID + Secret returns success
- [ ] Settings page shows saved Client ID (masked)
- [ ] Update credentials from settings returns success

### FOO-461: E2E: Dashboard nutrition display has no functional coverage

**Priority:** Medium
**Labels:** Feature
**Description:** Dashboard tests only verify layout. No tests check nutrition data rendering, calorie totals, meal breakdown, or weekly tab.

**Acceptance Criteria:**
- [ ] Daily tab shows calorie total from seeded meals (non-zero number)
- [ ] Meal type sections visible (Lunch, Dinner from seeded data)
- [ ] Weekly tab click switches view and renders content
- [ ] Fasting information displays (derived from seeded lunch 12:30 / dinner times)

### FOO-458: E2E: Quick Select flow has no functional coverage

**Priority:** High
**Labels:** Feature
**Description:** Quick Select only tests page load and guard. Zero tests exercise browsing, searching, selecting, or logging food.

**Acceptance Criteria:**
- [ ] Suggested tab displays seeded foods
- [ ] Recent tab displays recently logged foods
- [ ] Tab switching works
- [ ] Search input filters results (min 2 chars)
- [ ] Select food shows nutrition detail
- [ ] Log food with meal type succeeds (dry-run mode)

### FOO-459: E2E: Food history interactions untested (scroll, date jump, navigation)

**Priority:** High
**Labels:** Feature
**Description:** History tests only verify data display. No tests for Jump to date, navigation from history to food detail and back.

**Acceptance Criteria:**
- [ ] Jump to date with today's date navigates correctly
- [ ] Click entry navigates to food detail page
- [ ] Back button from food detail returns to history
- [ ] History page displays meal type labels

### FOO-460: E2E: Food detail actions untested (delete entry, error states)

**Priority:** High
**Labels:** Feature
**Description:** Food detail tests only verify rendering. No tests for deleting entries, verifying exact nutrition values, or handling invalid IDs.

**Acceptance Criteria:**
- [ ] Verify specific nutrition values match seeded data (e.g., chicken = 165 cal per 100g)
- [ ] Delete entry with confirmation removes it from history
- [ ] Navigate to invalid entry ID shows error/not-found state
- [ ] Meal type and date display correctly

### FOO-462: E2E: API key management CRUD untested in settings

**Priority:** Medium
**Labels:** Feature
**Description:** Settings page tests verify the API key section exists but never exercise create, list, copy, or revoke operations.

**Acceptance Criteria:**
- [ ] Initially shows empty state or no keys
- [ ] Create key with name shows full key value
- [ ] Created key appears in list with prefix (`fs_...`)
- [ ] Revoke key removes it from list

### FOO-465: E2E: v1 external API has no valid-key access tests

**Priority:** Medium
**Labels:** Feature
**Description:** v1 API tests only check 401 without token. No tests verify valid key access or that endpoints return data.

**Acceptance Criteria:**
- [ ] Create API key, use as Bearer token for v1 endpoints
- [ ] `GET /api/v1/food-log?date=<today>` returns 200 with seeded data
- [ ] `GET /api/v1/nutrition-summary?date=<today>` returns 200 with nutrition totals
- [ ] `GET /api/v1/lumen-goals?date=<today>` returns 200 (goals null, no Lumen data seeded)
- [ ] Invalid/revoked key returns 401

### FOO-466: E2E: Empty and error states have no coverage

**Priority:** Medium
**Labels:** Feature
**Description:** All tests run against seeded data. No tests verify what a fresh user sees — empty dashboards, "no entries" messages, zero-calorie states.

**Acceptance Criteria:**
- [ ] Fresh user dashboard shows zero calories / empty meal state
- [ ] Fresh user history shows empty/no-entries message
- [ ] Fresh user quick-select suggested tab shows empty state
- [ ] Invalid food detail ID shows error state

### FOO-456: E2E screenshots capture only light mode, missing dark mode

**Priority:** Medium
**Labels:** Improvement
**Description:** Screenshots only capture light mode. Dark mode rendering cannot be verified by visual QA.

**Acceptance Criteria:**
- [ ] Light mode screenshots saved to `e2e/screenshots/light/`
- [ ] Dark mode screenshots saved to `e2e/screenshots/dark/`
- [ ] All 8 existing screen captures have both light and dark variants
- [ ] `.gitignore` updated if directory pattern changes

## Prerequisites

- [ ] Docker PostgreSQL running locally (for E2E database)
- [ ] `.env.test` configured with `FITBIT_DRY_RUN=true` and `ENABLE_TEST_AUTH=true`
- [ ] No active plan in progress

## Implementation Tasks

### Task 1: Seed Fitbit mock data in E2E global setup

**Issue:** FOO-457
**Files:**
- `e2e/fixtures/db.ts` (modify)
- `src/db/schema.ts` (read — reference for column shapes)

**TDD Steps:**

1. **RED** — Run existing E2E suite. The `analyze.spec.ts` and `quick-select.spec.ts` guard tests pass (they expect guard screens). After seeding Fitbit data, these tests will break because the guard no longer appears.

2. **GREEN** — Modify `seedTestData()` in `e2e/fixtures/db.ts`:
   - After creating the test user lookup, insert a row into `fitbitCredentials` with the test user's ID, a dummy `fitbitClientId` (e.g., `"TEST_CLIENT_ID"`), and a dummy `encryptedClientSecret` (e.g., `"TEST_ENCRYPTED_SECRET"`).
   - Insert a row into `fitbitTokens` with the test user's ID, a dummy `fitbitUserId` (e.g., `"TEST_FITBIT_USER"`), dummy `accessToken` and `refreshToken` strings, and an `expiresAt` far in the future (e.g., 1 year from now).
   - The `fitbitCredentials` insert must come before `fitbitTokens` insert (no FK dependency, but logical ordering).
   - Reference: existing `customFoods` insert pattern in same file for `.insert().values({...}).returning()` style.

3. **REFACTOR** — Verify the insert order in `TABLES_IN_TRUNCATION_ORDER` already handles cleanup correctly. `fitbitTokens` is truncated before `fitbitCredentials`, which is correct since tokens reference credentials' user but not the credentials table directly.

**Notes:**
- The session endpoint (`/api/auth/session`) derives `fitbitConnected` from `getFitbitTokens()` and `hasFitbitCredentials` from `hasFitbitCredentials()` — both query by userId. Seeding these rows is sufficient to make the guard pass.
- `encryptedClientSecret` is just a text column — the encryption happens in the API route when saving real credentials. For test purposes, any string works since the Fitbit API is never called (dry-run mode).
- Run: `npm run e2e` — existing guard tests will now fail (expected).

---

### Task 2: Update existing guard tests for real UI behind guards

**Issue:** FOO-457
**Files:**
- `e2e/tests/analyze.spec.ts` (modify)
- `e2e/tests/quick-select.spec.ts` (modify)
- `e2e/tests/dashboard.spec.ts` (modify)

**TDD Steps:**

1. **RED** — After Task 1, the guard tests fail because `FitbitSetupGuard` now renders children instead of setup prompts. The tests that assert "Set up your Fitbit credentials" text will fail.

2. **GREEN** — Update each affected test:
   - `analyze.spec.ts`: The "shows Fitbit setup guard" test should be rewritten to verify the analyze page renders its real UI (camera/upload section, image input, or descriptive text). The guard is no longer visible. Keep the heading test and console error test as-is.
   - `quick-select.spec.ts`: The "shows Fitbit setup guard" test should verify that the suggested foods tab renders with seeded food names visible (Grilled Chicken Breast, Brown Rice, Steamed Broccoli). The guard no longer blocks.
   - `dashboard.spec.ts`: The "shows Fitbit status banner" test should verify the banner shows a connected state (e.g., "Connected" text or green indicator) instead of setup prompt. Keep layout and navigation tests as-is.
   - Reference: `history.spec.ts` for pattern of checking seeded food names after `networkidle`.

3. **REFACTOR** — Remove any guard-specific assertions that no longer apply. Ensure all updated tests wait for `networkidle` before asserting content.

**Notes:**
- The analyze page may show a camera permission prompt or upload area. Check what `src/app/app/analyze/page.tsx` renders inside the guard. The test should assert on visible elements from that real UI.
- Run: `npm run e2e` — all tests should pass again.

---

### Task 3: Authenticated API data verification tests

**Issue:** FOO-464
**Files:**
- `e2e/tests/api-data.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create new test file. Tests will use the Playwright `request` fixture with the default authenticated storage state (session cookies inherited). Each test calls an API endpoint and verifies response structure and data.

2. **GREEN** — Write tests for each authenticated endpoint:
   - `GET /api/food-history`: Assert 200, `success: true`, `data.entries` is an array with 3 items, each entry has `foodName`, `calories`, `mealTypeId`, `date` fields. Verify one entry is "Grilled Chicken Breast".
   - `GET /api/nutrition-summary?date=<today>`: Assert 200, `data.meals` is array, `data.totals.calories` is greater than 0, `data.totals.proteinG` is greater than 0. Use `new Date().toISOString().split('T')[0]` for today's date.
   - `GET /api/common-foods?tab=recent`: Assert 200, `data.foods` is array containing seeded food names.
   - `GET /api/fasting?date=<today>`: Assert 200. The response should have `data.window` with `firstMealTime` and/or `lastMealTime` (derived from seeded 12:30 lunch and current-time dinner).
   - `GET /api/earliest-entry`: Assert 200, `data.date` equals today's date string.
   - `GET /api/claude-usage`: Assert 200, `data.months` is an array (may be empty — no Claude usage seeded).
   - `GET /api/fitbit-credentials`: Assert 200, `data.hasCredentials` is `true` (after Task 1 seeds credentials).
   - `DELETE /api/food-history/<id>`: This is a destructive test — if included, it must run last or use a separate entry. Consider skipping delete in this file and covering it in Task 8 (FOO-460) instead.
   - Reference: `api-auth.spec.ts` for request fixture pattern and response assertion style.

3. **REFACTOR** — Extract shared constants (today's date, expected food names) to the top of the file. Ensure no test depends on another test's side effects.

**Notes:**
- All these endpoints set `Cache-Control: private, no-cache`, so responses are always fresh.
- The `common-foods?tab=suggested` endpoint uses time-of-day ranking, which may return different orderings. Use `tab=recent` for deterministic results from seeded log entries.
- Run: `npm run e2e -- --grep "API Data"` to test in isolation.

---

### Task 4: Fitbit credentials save/update flow tests

**Issue:** FOO-463
**Files:**
- `e2e/tests/setup-fitbit.spec.ts` (modify)
- `e2e/tests/settings.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add new tests to `setup-fitbit.spec.ts` for form submission and to `settings.spec.ts` for credential management.

2. **GREEN** — Write tests:
   - `setup-fitbit.spec.ts` — "submit empty form shows validation errors": Navigate to `/app/setup-fitbit`, click "Connect Fitbit" without filling inputs, verify validation error messages appear. The form should prevent submission or show required-field errors.
   - `setup-fitbit.spec.ts` — "submit valid credentials triggers save": Fill Client ID and Client Secret inputs with test values, click "Connect Fitbit". The `POST /api/fitbit-credentials` should succeed (or if credentials already exist from seed data, it may fail — check the endpoint behavior). Verify the response: either a redirect to Fitbit OAuth URL or a success message. Since the test user already has seeded credentials (Task 1), the POST may return a conflict error. In that case, test the PATCH flow instead from settings.
   - `settings.spec.ts` — "displays saved Fitbit Client ID": Navigate to `/settings`, verify the Fitbit App Credentials section shows a masked or partial Client ID from the seeded credentials.
   - `settings.spec.ts` — "update credentials from settings succeeds": In the Fitbit App Credentials section, update the Client ID and Client Secret fields, submit the form. Verify the `PATCH /api/fitbit-credentials` returns success. Verify the updated Client ID appears.
   - Reference: `setup-fitbit.spec.ts` for existing form element selectors (`getByLabel('Fitbit Client ID')`, etc.).

3. **REFACTOR** — Ensure credential tests don't break other tests by restoring original values if they modify credentials. Since global setup re-seeds on each run, this is handled automatically.

**Notes:**
- The seeded credentials from Task 1 use dummy values. The settings page shows `clientId` from `GET /api/fitbit-credentials`. The masked display logic is in the UI component — verify whatever text is rendered.
- The `POST /api/fitbit-credentials` endpoint may reject if credentials already exist (from seed). Check the endpoint for conflict handling and test accordingly.
- The form submission on setup-fitbit may redirect to an external Fitbit OAuth URL. The test should intercept or verify the redirect URL pattern without following it.

---

### Task 5: Dashboard nutrition display functional tests

**Issue:** FOO-461
**Files:**
- `e2e/tests/dashboard.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add new tests to the existing Dashboard describe block that verify nutrition data rendering.

2. **GREEN** — Write tests:
   - "daily tab shows calorie total from seeded meals": Navigate to `/app`, wait for networkidle. The seeded data has 3 entries: chicken 150g (165 cal/100g → ~248 cal), rice 200g (112 cal/100g → ~224 cal), broccoli 100g (35 cal). The dashboard should show a non-zero calorie number. Don't assert exact values (rounding may vary) — assert the calorie display contains a number greater than 0. Look for the calorie count in the `CalorieRing` or summary section.
   - "displays meal type breakdown sections": The seeded entries are Lunch (chicken + rice) and Dinner (broccoli). The daily dashboard should show sections or labels for "Lunch" and "Dinner". Verify both meal type labels are visible.
   - "weekly tab switches view": Click the "Weekly" tab, verify the view changes (different content appears). The weekly view uses a date range summary. Verify it renders without error and contains some content (even if no 7-day data).
   - "fasting information displays": The seeded data has meals at 12:30 (lunch) and current time (dinner). The fasting card should show some time information. Verify the fasting-related element is present and contains time text.
   - Reference: existing `dashboard.spec.ts` for tab selector pattern (`getByRole('tab', { name: 'Daily' })`).

3. **REFACTOR** — Ensure tests are independent of each other. Each test navigates fresh to `/app`.

**Notes:**
- The exact calorie display depends on how the app calculates per-serving nutrition (amount × cal/100g). The seeded amounts are 150g chicken, 200g rice, 100g broccoli. Don't hard-code exact totals — use `toBeGreaterThan(0)` or regex patterns for numbers.
- The `DailyDashboard` component fetches from `/api/nutrition-summary?date=<today>`. With seeded data, this returns non-empty results.
- Depends on Task 1 (Fitbit credentials seeded) so the `FitbitStatusBanner` shows connected state instead of blocking.

---

### Task 6: Quick Select functional tests

**Issue:** FOO-458
**Files:**
- `e2e/tests/quick-select.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add functional tests to the existing Quick Select describe block.

2. **GREEN** — Write tests:
   - "suggested tab displays foods": Navigate to `/app/quick-select`, wait for networkidle. The suggested tab (default) should show seeded foods ranked by time-of-day. Verify at least one food name from the seeded data appears. Use a flexible assertion since time-of-day ranking varies.
   - "recent tab displays recently logged foods": Click the "Recent" tab. The seeded food log entries should appear. Verify seeded food names are visible (Grilled Chicken Breast, Brown Rice, Steamed Broccoli).
   - "tab switching works": Click "Recent", verify content changes. Click "Suggested", verify content changes back. Both tabs should render without error.
   - "search input filters results": Find the search input, type a query with at least 2 characters (e.g., "chicken"). Verify that results update and show matching food (Grilled Chicken Breast). Verify that non-matching foods are not visible.
   - "search with less than 2 chars shows validation": Type a single character in search. Verify no search is triggered or a validation message appears.
   - "select food shows nutrition detail": Click on a food item in the list. Verify a detail view or dialog appears showing nutrition information (calories, protein, etc.) and a meal type selector.
   - "log food with meal type succeeds": Select a food, choose a meal type (e.g., Lunch), submit. The `POST /api/log-food` with `reuseCustomFoodId` should succeed in dry-run mode. Verify success feedback (toast, redirect, or confirmation message).
   - Reference: `history.spec.ts` for pattern of asserting seeded food names.

3. **REFACTOR** — Ensure the log food test doesn't interfere with other tests. Since it creates a new log entry, subsequent runs of other tests see extra data. This is OK since global setup re-seeds on each run.

**Notes:**
- The `QuickSelect` component wraps content in `FitbitSetupGuard`. After Task 1 seeds Fitbit data, the guard passes and the real UI renders.
- The "suggested" tab uses `GET /api/common-foods?tab=suggested&clientTime=HH:mm:ss&clientDate=YYYY-MM-DD` with time-of-day ranking. Results may vary by time of test run. Use flexible assertions.
- Search uses `GET /api/search-foods?q=<query>&limit=10`. The endpoint searches against the user's custom foods by food name.
- Log food uses `POST /api/log-food` with `reuseCustomFoodId`. With `FITBIT_DRY_RUN=true`, the Fitbit API call is skipped and the entry is saved to local DB only.

---

### Task 7: History interaction tests

**Issue:** FOO-459
**Files:**
- `e2e/tests/history.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add interaction tests to the existing History describe block.

2. **GREEN** — Write tests:
   - "jump to date navigates to correct date": Navigate to `/app/history`, find the date input (`getByLabel('Jump to date')`), set its value to today's date string, click the "Go" button. Verify the page shows the "Today" header with seeded data. Also test with a date that has no entries — verify an appropriate empty/no-data state.
   - "click entry navigates to food detail page": Navigate to `/app/history`, click on a food entry (e.g., the button matching "Grilled Chicken Breast, NNN calories"). Instead of verifying the dialog (already tested), verify that clicking the entry's detail link/button navigates to `/app/food-detail/<id>`. If the current flow opens a dialog with a "View details" link, click through to the full detail page.
   - "back button from food detail returns to history": After navigating to food detail from history, click the back button. Verify the page returns to `/app/history`.
   - "displays meal type labels": Verify the seeded entries show meal type context (e.g., "Lunch" label for chicken and rice entries, "Dinner" label for broccoli).
   - Reference: existing `history.spec.ts` for entry button selector pattern (`getByRole('button', { name: /Grilled Chicken Breast, \d+ calories/ })`).

3. **REFACTOR** — Ensure navigation tests clean up properly (no stale page state).

**Notes:**
- The history page uses cursor-based pagination via `GET /api/food-history`. With only 3 seeded entries, pagination/infinite-scroll testing is limited. Focus on the Jump to date and navigation flows.
- The dialog that opens on entry click may contain a link to the full food detail page, or the click may navigate directly. Check the `FoodHistory` component behavior.

---

### Task 8: Food detail action tests

**Issue:** FOO-460
**Files:**
- `e2e/tests/food-detail.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add action and verification tests to the existing Food Detail describe block.

2. **GREEN** — Write tests:
   - "displays correct nutrition values for seeded entry": Discover entry ID via `GET /api/food-history`, find the Grilled Chicken Breast entry specifically (by iterating entries and matching `foodName`). Navigate to its detail page. Verify the displayed calories match expected value. The seeded chicken is 100 cal per 100g at 150g amount — verify the rendered calories are approximately 248 (165 × 1.5). Also verify protein, carbs, fat labels show non-zero values.
   - "displays meal type and date": On the food detail page, verify the meal type label ("Lunch") and date ("Today" or today's date) are visible.
   - "delete entry removes it from history": Navigate to a food detail page. Click the delete button. If a confirmation dialog appears, confirm. Verify redirect to `/app/history`. Then verify the deleted entry is no longer visible in the history list. **Important:** This test modifies seeded data — it should run last in the file or the deleted entry should be one that won't affect other tests (e.g., use the Steamed Broccoli entry since other tests primarily reference Grilled Chicken Breast).
   - "invalid entry ID shows error state": Navigate to `/app/food-detail/99999`. Verify an error message appears (e.g., "Failed to load food entry details" or a not-found message). Verify the page doesn't crash.
   - Reference: existing `food-detail.spec.ts` for entry ID discovery pattern via API.

3. **REFACTOR** — Order tests so destructive operations (delete) run last. Use `test.describe.serial` if needed to enforce order.

**Notes:**
- The delete flow calls `DELETE /api/food-history/<id>`. With `FITBIT_DRY_RUN=true`, the Fitbit log delete is skipped and only the local DB entry is removed.
- The nutrition values displayed may be calculated as amount × (nutrition per serving). The seeded data uses `amount: '150'` for chicken with `calories: 165` (per 100g base). The displayed value depends on how the detail page calculates it.
- Running the delete test modifies the shared seeded data. Since Playwright runs tests in parallel by default, this test file should use `test.describe.serial` to ensure the delete test runs after all other food-detail tests.

---

### Task 9: API key management CRUD tests

**Issue:** FOO-462
**Files:**
- `e2e/tests/api-keys.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create new test file for API key lifecycle.

2. **GREEN** — Write tests as a serial describe block (each test depends on the previous):
   - "API key section shows empty state initially": Navigate to `/settings`, verify the API key manager section is present. If no keys exist, verify an empty state message or that the key list is empty. The seeded data from Task 1 doesn't include API keys, so this should be the initial state.
   - "create API key with name shows full key": Find the API key creation form (name input + create button). Enter a name (e.g., "Test Key"), click create. Verify the response shows the full key value (displayed only once). The key format starts with `fs_`. Capture the key value for subsequent tests using a variable.
   - "created key appears in list": After creation, verify the key appears in the list with its name ("Test Key") and a masked prefix (`fs_...`).
   - "revoke key removes it from list": Click the revoke/delete button for the created key. If a confirmation dialog appears, confirm. Verify the key is removed from the list or shows a revoked state.
   - Reference: `settings.spec.ts` for settings page navigation pattern.

3. **REFACTOR** — Use `test.describe.serial` to enforce test ordering since each test builds on the previous state.

**Notes:**
- The `POST /api/api-keys` endpoint returns the full key only on creation. The test must capture this value if it needs to pass it to v1 API tests (Task 10).
- The API key manager component is rendered within the settings page at `/settings`.
- Keys are stored with a `keyHash` (bcrypt) and `keyPrefix` (first 8 chars). The full key is returned only on creation and cannot be retrieved again.

---

### Task 10: v1 external API tests with valid key

**Issue:** FOO-465
**Files:**
- `e2e/tests/api-v1.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create new test file for v1 API endpoints using Bearer token auth.

2. **GREEN** — Write tests:
   - **Setup:** In a `test.beforeAll`, create an API key by calling `POST /api/api-keys` with the authenticated request fixture. Store the full key value.
   - "GET /api/v1/food-log returns data with valid key": Call with `Authorization: Bearer <key>` header and `date=<today>` query param. Assert 200, `success: true`, response has `data.meals` array and `data.totals` with calorie values matching seeded data.
   - "GET /api/v1/nutrition-summary returns data with valid key": Same structure as food-log. Assert 200 with nutrition totals.
   - "GET /api/v1/lumen-goals returns data with valid key": Call with `date=<today>`. Assert 200, `data.goals` is null (no Lumen goals seeded).
   - "GET /api/v1/activity-summary returns graceful response": This endpoint calls Fitbit API. With `FITBIT_DRY_RUN=true` or mock tokens, it may fail with a Fitbit-related error. Assert the endpoint returns a well-formed response (200 with empty data, or a specific error code like `FITBIT_CREDENTIALS_MISSING`). The test should verify the response doesn't crash.
   - "invalid Bearer token returns 401": Call any v1 endpoint with `Authorization: Bearer invalid_token`. Assert 401.
   - **Teardown:** In `test.afterAll`, revoke the created API key via `DELETE /api/api-keys/<id>`.
   - Reference: `api-auth.spec.ts` for the existing 401 test pattern on `/api/v1/food-log`.

3. **REFACTOR** — Extract the Bearer token header into a shared helper. Ensure the key is cleaned up even if tests fail (use afterAll).

**Notes:**
- v1 endpoints use `validateApiRequest()` which looks up the API key by hash. The Bearer token is the full key returned on creation.
- The `food-log` and `nutrition-summary` v1 endpoints return the same `NutritionSummary` format as the browser route — they don't call Fitbit API.
- The `activity-summary` and `nutrition-goals` v1 endpoints DO call Fitbit API. With dummy tokens and `FITBIT_DRY_RUN=true`, the behavior depends on whether the route checks dry-run before calling Fitbit. If it doesn't, expect a Fitbit error. Test for graceful error handling.
- The test file should NOT rely on storage state (v1 uses Bearer tokens, not cookies). Override storage state to empty and use explicit headers.

---

### Task 11: Empty and error state tests

**Issue:** FOO-466
**Files:**
- `e2e/tests/empty-states.spec.ts` (create)
- `e2e/fixtures/auth.ts` (read — reference for UNAUTHENTICATED constant pattern)

**TDD Steps:**

1. **RED** — Create new test file that uses a fresh user context without seeded data.

2. **GREEN** — Write tests using a fresh browser context:
   - **Setup:** Create a fresh browser context. Call `POST /api/auth/test-login` to create a new session (this reuses the same `test@example.com` user but with a fresh browser context). However, this user already has seeded data. **Alternative approach:** Use the `request` fixture to call test-login with the existing user but clear specific tables via a test-specific API, OR — simpler — create tests that navigate to known-empty states:
     - "invalid food detail ID shows error state": Navigate to `/app/food-detail/99999`. Verify error message appears ("Failed to load food entry details" or not-found). This doesn't need a fresh user.
     - "history page with future date shows no entries": Navigate to `/app/history`, use Jump to date with a far-future date (e.g., 2030-01-01). Verify no entries message or empty state.
   - **For true empty-user tests**, the approach is: create a second test user by extending the test-login endpoint to accept an optional email parameter, OR use a `beforeAll` that truncates food-specific tables (food_log_entries, custom_foods) in a separate browser context, run empty state tests, then re-seed. The simplest approach: test invalid/empty states that don't require a separate user (invalid ID, future date with no data).
   - Reference: `food-detail.spec.ts` for invalid ID error assertion pattern.

3. **REFACTOR** — Keep empty state tests minimal and focused. Don't try to test every page's empty state if it requires complex user isolation.

**Notes:**
- True empty-user testing requires either a second test user or table truncation within the test. Since global setup creates one user with seeded data, the simplest approach is to test empty states using date boundaries and invalid IDs rather than creating a separate user.
- If a second test user is needed, extend `POST /api/auth/test-login` to accept an optional email parameter (e.g., `empty-test@example.com`). Add this email to `ALLOWED_EMAILS` in `.env.test`. This is a code change and should be done carefully.
- The most valuable empty state tests: invalid food detail ID (error handling) and history with no data for a specific date (empty list handling).

---

### Task 12: Dark mode screenshot capture

**Issue:** FOO-456
**Files:**
- `e2e/tests/analyze.spec.ts` (modify — screenshot section)
- `e2e/tests/dashboard.spec.ts` (modify — screenshot section)
- `e2e/tests/history.spec.ts` (modify — screenshot section)
- `e2e/tests/food-detail.spec.ts` (modify — screenshot section)
- `e2e/tests/landing.spec.ts` (modify — screenshot section)
- `e2e/tests/quick-select.spec.ts` (modify — screenshot section)
- `e2e/tests/settings.spec.ts` (modify — screenshot section)
- `e2e/tests/setup-fitbit.spec.ts` (modify — screenshot section)
- `.gitignore` (modify — update screenshot path patterns)

**TDD Steps:**

1. **RED** — Existing screenshot tests save to `e2e/screenshots/<name>.png`. After this task, they should save to `e2e/screenshots/light/<name>.png` and `e2e/screenshots/dark/<name>.png`.

2. **GREEN** — For each spec file that captures a screenshot:
   - Update the light mode screenshot path from `e2e/screenshots/<name>.png` to `e2e/screenshots/light/<name>.png`.
   - After the light mode screenshot, inject dark mode by evaluating JavaScript in the page to set `localStorage.setItem('theme', 'dark')` and add `class="dark"` to the `<html>` element (or use the app's theme toggling mechanism). Wait for repaint.
   - Capture a second screenshot to `e2e/screenshots/dark/<name>.png`.
   - Restore light mode after dark screenshot (optional — each test navigates fresh).
   - **Alternative approach:** Instead of modifying each test file, create a shared helper function `captureScreenshots(page, name)` in `e2e/fixtures/` that captures both variants. Call it from each spec.
   - Update `.gitignore` to match the new directory structure (`e2e/screenshots/light/` and `e2e/screenshots/dark/`).
   - Reference: `settings.spec.ts` for existing theme button interaction pattern (Light/Dark/System buttons).

3. **REFACTOR** — Extract the dual-screenshot logic into a reusable helper in `e2e/fixtures/screenshots.ts` to avoid duplication across 8 test files. Each test file calls `await captureScreenshots(page, 'dashboard')` instead of manual light+dark logic.

**Notes:**
- The app uses next-themes with localStorage. The theme classes (`dark`, `light`) are applied to the `<html>` element. Injecting `document.documentElement.classList.add('dark')` and setting localStorage should switch the theme immediately.
- The Playwright viewport is already set to 390x844 (iPhone 14 Pro) — dark mode screenshots use the same viewport.
- The `frontend-review` skill's visual QA reviewer should be updated to analyze both screenshot sets. This is a documentation/skill change, not an E2E test change — note for follow-up.

---

### Task 13: Integration & Verification

**Issue:** FOO-457, FOO-458, FOO-459, FOO-460, FOO-461, FOO-462, FOO-463, FOO-464, FOO-465, FOO-466, FOO-456
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full E2E test suite: `npm run e2e`
2. Verify all new and existing tests pass
3. Run linter: `npm run lint`
4. Run type checker: `npm run typecheck`
5. Run unit tests to ensure no regressions: `npm test`
6. Build check: `npm run build`
7. Review screenshot output: verify both light and dark directories have 8 screenshots each
8. Manual spot-check: review 2-3 screenshots visually for correctness

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Invalid food detail ID | Shows error/not-found message | Task 8, Task 11 |
| Empty history date | Shows no-entries state | Task 11 |
| Invalid API key | Returns 401 with error body | Task 10 |
| Fitbit API timeout (dry-run) | Skipped in dry-run mode | Implicitly covered by log-food tests |
| Missing session cookie | Returns 401 | Already covered by `api-auth.spec.ts` |

## Risks & Open Questions

- [ ] **Risk: Quick Select log-food may fail if `requireFitbit` check is strict.** The seeded tokens have dummy values. If the log-food route validates token format before checking dry-run mode, the log test in Task 6 may fail. Mitigation: verify the route checks `FITBIT_DRY_RUN` before attempting Fitbit API calls.
- [ ] **Risk: v1 activity-summary and nutrition-goals endpoints may not support dry-run.** These endpoints call Fitbit API directly. If they don't check `FITBIT_DRY_RUN`, tests will get Fitbit errors with dummy tokens. Mitigation: test for graceful error handling (well-formed error response) rather than 200 success.
- [ ] **Risk: Parallel test execution may cause flaky tests.** The delete test in Task 8 modifies shared state. Mitigation: use `test.describe.serial` for destructive tests and run delete tests last.
- [ ] **Risk: Empty state tests limited without second test user.** True empty-user testing requires user isolation. Mitigation: focus on date-boundary and invalid-ID empty states rather than full empty-user flows. Consider extending test-login for a future improvement.
- [ ] **Question: Should dark mode screenshots use CSS emulation or app theme toggle?** Playwright's `colorScheme: 'dark'` emulates `prefers-color-scheme: dark` at the browser level. If the app's theme system respects `prefers-color-scheme`, this is cleaner than injecting localStorage. Check how next-themes handles system preference.

## Scope Boundaries

**In Scope:**
- Seeding Fitbit mock data for E2E guard bypass
- Updating existing guard tests for real UI
- Adding API data verification tests (authenticated + v1)
- Adding functional E2E tests for dashboard, quick-select, history, food-detail, settings
- Adding API key CRUD tests
- Adding empty/error state tests (within single-user constraints)
- Adding dark mode screenshot capture

**Out of Scope:**
- Modifying application source code (routes, components, etc.) — this plan is E2E tests only
- Second test user infrastructure for full empty-state isolation
- Analyze page camera/upload functional testing (requires image mocking)
- Lumen goals upload testing (requires screenshot image mocking)
- Frontend-review skill update for dual screenshot analysis
- CI pipeline changes for E2E test execution

---

## Iteration 1

**Implemented:** 2026-02-14
**Method:** Agent team (3 workers)

### Tasks Completed This Iteration
- Task 1: Seed Fitbit mock data in E2E global setup (worker-1) — FOO-457
- Task 2: Update existing guard tests for real UI behind guards (worker-1) — FOO-457
- Task 3: Authenticated API data verification tests (worker-2) — FOO-464
- Task 4: Fitbit credentials save/update flow tests (worker-1) — FOO-463
- Task 5: Dashboard nutrition display functional tests (worker-1) — FOO-461
- Task 6: Quick Select functional tests (worker-1) — FOO-458
- Task 7: History interaction tests (worker-1) — FOO-459
- Task 8: Food detail action tests (worker-1) — FOO-460
- Task 9: API key management CRUD tests (worker-2) — FOO-462
- Task 10: v1 external API tests with valid key (worker-3) — FOO-465
- Task 11: Empty and error state tests (worker-3) — FOO-466
- Task 12: Dark mode screenshot capture (worker-2) — FOO-456

### Tasks Remaining
- Task 13: Integration & Verification — all E2E tests must pass, lint, typecheck, build

### BLOCKER: SESSION_SECRET Mismatch Between Seed and Server Processes

**Status:** UNSOLVED — blocks 67 of 95 E2E tests

**Symptom:** All tests that load authenticated pages fail with `Invalid authentication tag length: 0` thrown by `decryptToken()` in `src/lib/token-encryption.ts`. This crashes SSR rendering of any page that calls `getFitbitCredentials()`.

**Root Cause Analysis:**
- `seedTestData()` in `e2e/fixtures/db.ts` calls `encryptToken('TEST_CLIENT_SECRET')` using the `SESSION_SECRET` from `.env.test` (`test-session-secret-min-32-chars-required-for-iron-session`)
- The Next.js server subprocess (started by Playwright's `webServer` config) decrypts the same value with `decryptToken()` — but uses a DIFFERENT `SESSION_SECRET`, producing the auth tag error
- `.env.local` has a different `SESSION_SECRET` (`xqdBSzCvlmYkM1/yUUPEeBtP0jNO+4sqQPe21evooPk=`)
- Despite `NODE_ENV=test` in the webServer command (which should prevent Next.js from loading `.env.local`) and `dotenv.config({ override: true })` in both `playwright.config.ts` and `global-setup.ts`, the server subprocess still appears to use the wrong key

**What Was Tried:**
1. Added `dotenv.config({ path: '.env.test', override: true })` to `playwright.config.ts` and `e2e/global-setup.ts`
2. Changed webServer command to prefix `NODE_ENV=test` (prevents `@next/env` from loading `.env.local`)
3. Verified `encryptToken` roundtrip works in isolation (`npx tsx` script confirmed)
4. Verified the seed process uses the correct `.env.test` SECRET (debug log confirmed)
5. Cleaned `.next/` cache and rebuilt
6. Reviewed `@next/env` source code — claims it doesn't override existing env vars

**What the Next Agent Should Try:**
1. Add a temporary `console.log('SERVER SESSION_SECRET:', process.env.SESSION_SECRET?.substring(0, 10))` in `src/lib/token-encryption.ts` `getKey()` function, then run `npm run e2e` and check the server output to definitively confirm what SECRET the server is using
2. If the server IS using `.env.local`'s secret, the fix may be to: (a) set `SESSION_SECRET` explicitly in the webServer command env, or (b) rename/remove `.env.local` during E2E runs, or (c) use Playwright's `env` option on the webServer config to force the variable
3. If the server is using the correct secret, the problem may be in how the seed process imports `token-encryption.ts` (module caching, env var timing)

### Bug Fixes Applied (from bug-hunter)
- `e2e/tests/quick-select.spec.ts` line 101: Fixed syntax error `broccoli Visible` → `broccoliVisible`
- `e2e/tests/quick-select.spec.ts` line 106: Fixed incorrect assertion `expect(a || b).not.toBe(true)` → separate `expect(a).toBe(false); expect(b).toBe(false)`
- `e2e/tests/food-detail.spec.ts`: Fixed race condition — replaced `waitForTimeout(1000)` with `waitFor({ state: 'visible', timeout: 3000 })` for confirmation dialog
- `e2e/tests/api-keys.spec.ts`: Fixed unsafe array access — added `await expect(keyElement).toBeVisible()` before `.textContent()`

### Files Modified
- `e2e/fixtures/db.ts` — Added Fitbit credentials + tokens seeding with `encryptToken()`
- `e2e/fixtures/screenshots.ts` — Created shared light+dark mode screenshot helper
- `e2e/global-setup.ts` — Added dotenv with override: true for .env.test
- `e2e/tests/analyze.spec.ts` — Updated guard tests → real UI tests, added dark mode screenshots
- `e2e/tests/api-data.spec.ts` — Created: 7 authenticated API data verification tests
- `e2e/tests/api-keys.spec.ts` — Created: API key CRUD lifecycle tests (serial)
- `e2e/tests/api-v1.spec.ts` — Created: 7 v1 external API tests with Bearer auth
- `e2e/tests/dashboard.spec.ts` — Added nutrition display + dark mode screenshots
- `e2e/tests/empty-states.spec.ts` — Created: 3 empty/error state tests
- `e2e/tests/food-detail.spec.ts` — Added delete, nutrition values, error state tests
- `e2e/tests/history.spec.ts` — Added 4 interaction tests (jump-to-date, navigation, meal types)
- `e2e/tests/landing.spec.ts` — Updated to use shared screenshot helper
- `e2e/tests/quick-select.spec.ts` — Added functional tests (tabs, search, select, log food)
- `e2e/tests/settings.spec.ts` — Added Fitbit credentials display + theme tests
- `e2e/tests/setup-fitbit.spec.ts` — Added form validation + OAuth redirect tests
- `playwright.config.ts` — Added dotenv override + NODE_ENV=test in webServer command

### Linear Updates
- FOO-457: Todo → In Progress → Review
- FOO-458: Todo → In Progress → Review
- FOO-459: Todo → In Progress → Review
- FOO-460: Todo → In Progress (incomplete — blocked by SESSION_SECRET issue)
- FOO-461: Todo → In Progress → Review
- FOO-462: Todo → In Progress → Review
- FOO-463: Todo → In Progress → Review
- FOO-464: Todo → In Progress → Review
- FOO-465: Todo → In Progress (incomplete — blocked by SESSION_SECRET issue)
- FOO-466: Todo → In Progress → Review
- FOO-456: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 7 bugs, 4 high-priority fixed before stopping
- verifier (E2E): 16 passed, 67 failed, 12 skipped — blocked by SESSION_SECRET mismatch

### Work Partition
- Worker 1: Tasks 1, 2, 4, 5, 6, 7, 8 (guard bypass, UI functional tests)
- Worker 2: Tasks 3, 9, 12 (API data, API keys, screenshots)
- Worker 3: Tasks 10, 11 (v1 API, empty states)

### Continuation Status
Tasks 1-12 code written. Task 13 (Integration & Verification) NOT completed — blocked by SESSION_SECRET encryption mismatch causing 67/95 E2E test failures. Fresh agent needed to debug the env var inheritance issue between Playwright's webServer subprocess and the seed process.
