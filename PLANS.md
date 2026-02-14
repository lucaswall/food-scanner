# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-453-e2e-coverage-expansion
**Issues:** FOO-453, FOO-454, FOO-455, FOO-452, FOO-451, FOO-450, FOO-449, FOO-448, FOO-447, FOO-446, FOO-445, FOO-444
**Created:** 2026-02-14
**Last Updated:** 2026-02-14

## Summary

Expand E2E test coverage from the current 5 smoke tests to comprehensive page-level and interaction tests. Includes fixing the Playwright viewport to mobile dimensions (matching actual usage), fixing seed data bugs, adding navigation/interaction tests for all app pages, and adding API-level auth boundary tests. All tests build on the existing Playwright infrastructure (global-setup, db fixtures, test-login auth bypass).

## Issues

### FOO-453: E2E: API route auth protection — unauthenticated requests return 401

**Priority:** High
**Labels:** Security
**Description:** No E2E tests verify that protected API routes reject unauthenticated requests. Tests should cover browser-facing routes (cookie auth) and external API routes (Bearer token), plus confirm `/api/health` stays public.

**Acceptance Criteria:**
- [ ] Unauthenticated `GET /api/food-history` returns 401
- [ ] Unauthenticated `GET /api/common-foods` returns 401
- [ ] Unauthenticated `POST /api/log-food` returns 401
- [ ] Unauthenticated `POST /api/analyze-food` returns 401
- [ ] Unauthenticated `GET /api/auth/session` returns 401
- [ ] Unauthenticated `GET /api/nutrition-summary` returns 401
- [ ] `GET /api/v1/food-log` without Bearer token returns 401
- [ ] `GET /api/health` returns 200 (public)
- [ ] Response body matches `{ success: false, error: { code: "UNAUTHORIZED" } }` format

### FOO-454: E2E screenshots use desktop viewport and fullPage, not representative of mobile usage

**Priority:** Medium
**Labels:** Improvement
**Description:** Screenshots captured at 1280x720 with `fullPage: true` don't represent mobile usage. App is mobile-first with `max-w-md` containers. Fixed-position elements (bottom nav) render incorrectly in fullPage captures.

**Acceptance Criteria:**
- [ ] Playwright config uses mobile viewport (390x844, iPhone 14/15)
- [ ] Screenshot calls use viewport-only capture (no `fullPage: true`)
- [ ] Long pages use multiple scroll-position screenshots instead of fullPage
- [ ] Screenshots in `e2e/screenshots/` reflect actual mobile layout

### FOO-455: E2E seed data has wrong mealTypeId comment (7 is Anytime, not Dinner)

**Priority:** Low
**Labels:** Bug
**Description:** `e2e/fixtures/db.ts:159` uses `mealTypeId: 7` with comment `// Dinner`, but Fitbit mealTypeId 7 is "Anytime". Dinner is mealTypeId 5.

**Acceptance Criteria:**
- [ ] `mealTypeId` changed from 7 to 5 in seed data
- [ ] Comment correctly says `// Dinner`

### FOO-452: E2E: Logout flow — click logout, verify redirect to landing page

**Priority:** Medium
**Labels:** Improvement
**Description:** Logout button in SettingsContent calls `POST /api/auth/logout` then redirects to `/`. No E2E test covers this flow.

**Acceptance Criteria:**
- [ ] Test navigates to `/settings`
- [ ] Test clicks "Logout" button
- [ ] Verifies redirect to `/` (landing page)
- [ ] Verifies landing page shows "Login with Google" (confirming unauthenticated state)
- [ ] Test uses isolated context (doesn't break other tests' auth state)

### FOO-451: E2E: Settings interactions — theme switcher, logout, session info, credentials

**Priority:** Medium
**Labels:** Improvement
**Description:** Settings page tests only verify the page loads. Interactive elements (theme switcher, session info, Fitbit credentials section, Claude usage) are untested.

**Acceptance Criteria:**
- [ ] Session info shows test user email (`test@example.com`)
- [ ] Fitbit status displays (likely "Not connected" for test user)
- [ ] Theme buttons (Light, Dark, System) visible and clickable
- [ ] Clicking a theme button toggles the active state
- [ ] Logout button visible with destructive styling
- [ ] "Fitbit App Credentials" section heading visible
- [ ] "Appearance" section heading visible
- [ ] Claude usage section renders

### FOO-450: E2E: Dashboard action links — Take Photo and Quick Select navigation

**Priority:** Medium
**Labels:** Improvement
**Description:** Dashboard's "Take Photo" and "Quick Select" action cards only checked for visibility, not navigation. Take Photo links to `/app/analyze?autoCapture=true`, Quick Select links to `/app/quick-select`.

**Acceptance Criteria:**
- [ ] Clicking "Take Photo" card navigates to `/app/analyze?autoCapture=true`
- [ ] Clicking "Quick Select" card navigates to `/app/quick-select`
- [ ] Both destination pages load successfully

### FOO-449: E2E: Bottom navigation — renders on all pages, active state, navigation

**Priority:** Medium
**Labels:** Improvement
**Description:** `BottomNav` component has 5 items (Home, Quick Select, Analyze, History, Settings) with `aria-current="page"` on active link. No E2E coverage.

**Acceptance Criteria:**
- [ ] Nav bar visible on `/app` with all 5 items
- [ ] Home item has `aria-current="page"` on `/app`
- [ ] Clicking Quick Select navigates to `/app/quick-select` with correct active state
- [ ] Clicking History navigates to `/app/history`
- [ ] Clicking Settings navigates to `/settings`
- [ ] Nav bar visible on all tested pages

### FOO-448: E2E: Food Detail page — renders entry detail for seeded data

**Priority:** Low
**Labels:** Improvement
**Description:** `/app/food-detail/[id]` page has zero E2E coverage. FoodDetail component renders nutrition details for a food log entry. Seeded entries exist with known data.

**Acceptance Criteria:**
- [ ] Navigate to a seeded entry's detail page (discover ID via API call)
- [ ] Page renders without errors
- [ ] Food name, nutrition data visible
- [ ] Screenshot capture

### FOO-447: E2E: Setup Fitbit page — form renders with back navigation

**Priority:** Low
**Labels:** Improvement
**Description:** `/app/setup-fitbit` page has zero E2E coverage. Has back button linking to `/app`, "Set Up Fitbit" heading, and FitbitSetupForm with Client ID and Client Secret inputs.

**Acceptance Criteria:**
- [ ] Page loads with "Set Up Fitbit" heading
- [ ] Back button links to `/app`
- [ ] Client ID and Client Secret inputs render
- [ ] Screenshot capture

### FOO-446: E2E: Analyze page — renders heading and FitbitSetupGuard

**Priority:** Low
**Labels:** Improvement
**Description:** `/app/analyze` page wraps FoodAnalyzer inside FitbitSetupGuard. Test user has no Fitbit credentials, so guard shows setup prompt.

**Acceptance Criteria:**
- [ ] Page loads with "Analyze Food" heading
- [ ] FitbitSetupGuard renders (setup prompt since test user lacks credentials)
- [ ] Page accessible via both `/app/analyze` and `/app/analyze?autoCapture=true`
- [ ] No console errors
- [ ] Screenshot capture

### FOO-445: E2E: Quick Select page — tabs, food list, search, food detail view

**Priority:** Medium
**Labels:** Improvement
**Description:** `/app/quick-select` multi-state component (list → detail → confirm) with seeded custom foods available. Wrapped in FitbitSetupGuard (test user has no Fitbit credentials — guard will show setup prompt instead of QuickSelect).

**Acceptance Criteria:**
- [ ] Page loads with "Quick Select" heading
- [ ] FitbitSetupGuard behavior verified (setup prompt likely shown for test user)
- [ ] Screenshot capture

### FOO-444: E2E: History page — entries display, date grouping, detail dialog

**Priority:** Medium
**Labels:** Improvement
**Description:** `/app/history` has seeded test data (3 entries: Grilled Chicken, Brown Rice, Steamed Broccoli). History page groups entries by date, shows nutrition summaries, has detail dialog.

**Acceptance Criteria:**
- [ ] Page loads with "History" heading
- [ ] Seeded entries visible (Grilled Chicken Breast, Brown Rice, Steamed Broccoli)
- [ ] Date grouping header shows today's date with calorie/macro summary
- [ ] Clicking an entry opens the detail dialog
- [ ] "Jump to date" input present
- [ ] Delete button visible on entries
- [ ] Screenshot capture

## Prerequisites

- [ ] E2E infrastructure already set up (Playwright, global-setup, db fixtures)
- [ ] Test database available at `localhost:5432/food_scanner`
- [ ] `.env.test` configured with `ENABLE_TEST_AUTH=true`

## Implementation Tasks

### Task 1: Fix seed data mealTypeId bug

**Issue:** FOO-455
**Files:**
- `e2e/fixtures/db.ts` (modify)

**TDD Steps:**

1. **RED** — Run existing E2E tests to establish baseline. No test currently asserts on meal type, so this is a data-only fix.

2. **GREEN** — In `e2e/fixtures/db.ts`, change the third food log entry's `mealTypeId` from `7` to `5`. The comment `// Dinner` is already correct; the value is wrong. Fitbit meal types: 1=Breakfast, 2=Morning Snack, 3=Lunch, 4=Afternoon Snack, 5=Dinner, 6=Evening Snack, 7=Anytime.

3. **REFACTOR** — No refactoring needed.

**Notes:**
- Single-line fix. Enables future tests to assert "Dinner" labels correctly.

---

### Task 2: Switch Playwright to mobile viewport

**Issue:** FOO-454
**Files:**
- `playwright.config.ts` (modify)

**TDD Steps:**

1. **RED** — Current screenshots show desktop layout (1280x720). Visually verify by looking at existing screenshots.

2. **GREEN** — Replace `devices['Desktop Chrome']` with a custom device config that uses mobile viewport (390x844) while keeping Chromium. Set a `viewport` override in the project's `use` config. Keep the authenticated storage state.

3. **REFACTOR** — Verify the config is clean and well-commented.

**Notes:**
- Reference: `playwright.config.ts:38-46` for current project config.
- Use `viewport: { width: 390, height: 844 }` (iPhone 14/15 dimensions).
- Keep `...devices['Desktop Chrome']` for Chromium user-agent, override just the viewport. Or use a named device like `'iPhone 14'` — evaluate which gives better Chromium compatibility.
- This change affects ALL tests globally, which is the desired behavior.

---

### Task 3: Fix existing screenshot calls to remove fullPage

**Issue:** FOO-454
**Files:**
- `e2e/tests/dashboard.spec.ts` (modify)
- `e2e/tests/landing.spec.ts` (modify)
- `e2e/tests/settings.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Screenshots currently use `{ fullPage: true }`, producing misleading captures with bottom-nav overlay issues.

2. **GREEN** — Remove `fullPage: true` from all `page.screenshot()` calls in existing test files. For short pages (landing), a single viewport screenshot is sufficient. For longer pages (dashboard, settings), add a second screenshot at a scrolled position to capture below-fold content.

3. **REFACTOR** — Ensure screenshot naming is consistent (e.g., `dashboard-top.png`, `dashboard-scrolled.png` for multi-shot pages, or just `dashboard.png` for single viewport shots).

**Notes:**
- Reference: `e2e/tests/dashboard.spec.ts:22`, `e2e/tests/landing.spec.ts` (similar line), `e2e/tests/settings.spec.ts:20`.
- With mobile viewport (390x844), most pages will need scrolling to see all content.
- Consider whether scroll-position screenshots add value vs complexity. If not clearly valuable, a single viewport-only screenshot per page is acceptable.

---

### Task 4: Add API route auth protection tests

**Issue:** FOO-453
**Files:**
- `e2e/tests/api-auth.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create `e2e/tests/api-auth.spec.ts` with tests for each protected API route. Use `test.use({ storageState: { cookies: [], origins: [] } })` to simulate unauthenticated state. Use Playwright's `request` fixture for API calls (same pattern as `health.spec.ts`).

2. **GREEN** — Write tests that:
   - `GET /api/food-history` → 401 with `{ success: false, error: { code: "UNAUTHORIZED" } }`
   - `GET /api/common-foods` → 401
   - `POST /api/log-food` → 401
   - `POST /api/analyze-food` → 401
   - `GET /api/auth/session` → 401
   - `GET /api/nutrition-summary` → 401
   - `GET /api/v1/food-log` without Bearer → 401
   - `GET /api/health` → 200 (public, control case)
   - Verify response body format matches the standardized error response

3. **REFACTOR** — Consider extracting a helper that tests a route and asserts 401 + error format, to reduce repetition across the 7+ route assertions.

**Notes:**
- Reference pattern: `e2e/tests/health.spec.ts` for API testing with `request` fixture.
- Auth override pattern: `e2e/fixtures/auth.ts` exports `UNAUTHENTICATED`.
- Protected browser-facing routes use `getSession()` + `validateSession()` from `@/lib/session`.
- v1 routes use `validateApiRequest()` from `@/lib/api-auth` (Bearer token).
- Error format: `src/lib/api-response.ts` and `ErrorCode` in `src/types/index.ts`.

---

### Task 5: Add bottom navigation tests

**Issue:** FOO-449
**Files:**
- `e2e/tests/navigation.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create `e2e/tests/navigation.spec.ts` with a `describe('Bottom Navigation')` block.

2. **GREEN** — Write tests that:
   - On `/app`, verify all 5 nav items visible (Home, Quick Select, Analyze, History, Settings) inside `nav[aria-label="Main navigation"]`
   - On `/app`, verify Home has `aria-current="page"`
   - Click Quick Select → verify URL is `/app/quick-select` and Quick Select has `aria-current="page"`
   - Click History → verify URL is `/app/history`
   - Click Settings → verify URL is `/settings`
   - Verify nav bar is visible after each navigation

3. **REFACTOR** — Ensure test assertions use accessible queries (role, aria attributes) matching the `BottomNav` component implementation.

**Notes:**
- Reference: `src/components/bottom-nav.tsx` for nav item structure, `aria-current` usage, and `aria-label="Main navigation"`.
- Nav items use `Link` components with `aria-current={active ? "page" : undefined}`.

---

### Task 6: Add dashboard action link navigation tests

**Issue:** FOO-450
**Files:**
- `e2e/tests/dashboard.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Existing dashboard test only checks text visibility. Add a new test in the same file that verifies click navigation.

2. **GREEN** — Add a test that:
   - On `/app`, click the "Take Photo" link → verify URL includes `/app/analyze` with `autoCapture=true`
   - Navigate back to `/app`, click "Quick Select" → verify URL is `/app/quick-select`
   - Both destination pages render their heading ("Analyze Food", "Quick Select")

3. **REFACTOR** — Keep the new test alongside existing dashboard tests. Use `page.getByText('Take Photo').first()` (matching existing pattern for duplicate text from nav).

**Notes:**
- Reference: `src/app/app/page.tsx:27-40` for link targets.
- The links are inside `<Link>` components wrapped in cards. Click on the text should trigger navigation.
- "Take Photo" text appears both in the action card and possibly in the bottom nav — use `.first()` to target the card.

---

### Task 7: Add history page tests

**Issue:** FOO-444
**Files:**
- `e2e/tests/history.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create `e2e/tests/history.spec.ts` with a `describe('History Page')` block.

2. **GREEN** — Write tests that:
   - Page loads at `/app/history` with "History" heading
   - Wait for network idle, then verify seeded food names visible: "Grilled Chicken Breast", "Brown Rice", "Steamed Broccoli"
   - Verify a date group header is present (today's entries)
   - Click on an entry → verify a detail dialog opens (check for dialog role or overlay)
   - Verify "Jump to date" input is present
   - Capture screenshot

3. **REFACTOR** — Ensure tests wait for data loading (history fetches via SWR).

**Notes:**
- Reference: `src/components/food-history.tsx` for component structure.
- Seeded data: 3 entries for today (2 lunch + 1 dinner after FOO-455 fix).
- The history component fetches data client-side via SWR — tests need `waitForLoadState('networkidle')` or explicit element waits.

---

### Task 8: Add quick select page tests

**Issue:** FOO-445
**Files:**
- `e2e/tests/quick-select.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create `e2e/tests/quick-select.spec.ts` with a `describe('Quick Select Page')` block.

2. **GREEN** — Write tests that:
   - Page loads at `/app/quick-select` with "Quick Select" heading
   - Verify FitbitSetupGuard behavior — test user has no Fitbit credentials, so the guard will likely render a setup prompt or redirect. Verify what actually renders.
   - If setup guard blocks: verify the setup prompt is visible and actionable
   - Capture screenshot

3. **REFACTOR** — Scope tests to what's actually visible given the test user's state (no Fitbit credentials).

**Notes:**
- Reference: `src/app/app/quick-select/page.tsx` wraps QuickSelect in FitbitSetupGuard.
- Reference: `src/components/fitbit-setup-guard.tsx` for guard behavior.
- **Important:** The test user created by test-login has NO Fitbit credentials seeded. The guard may show a "Set up Fitbit" prompt instead of the QuickSelect content. The test should verify what actually renders, not assume the full QuickSelect is visible.
- If full QuickSelect testing is desired, seed Fitbit credentials in the fixture. This is a scoping decision — document it.

---

### Task 9: Add analyze page tests

**Issue:** FOO-446
**Files:**
- `e2e/tests/analyze.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create `e2e/tests/analyze.spec.ts` with a `describe('Analyze Page')` block.

2. **GREEN** — Write tests that:
   - Page loads at `/app/analyze` with "Analyze Food" heading
   - FitbitSetupGuard renders (same guard behavior as quick-select — setup prompt for test user without credentials)
   - Page also loads at `/app/analyze?autoCapture=true` without errors
   - No console errors
   - Capture screenshot

3. **REFACTOR** — Use the console error detection pattern from `landing.spec.ts`.

**Notes:**
- Reference: `src/app/app/analyze/page.tsx` wraps FoodAnalyzer in FitbitSetupGuard.
- Same FitbitSetupGuard consideration as Task 8 — test user has no Fitbit credentials.
- Camera/AI flow cannot be E2E tested; focus on page structure and guard behavior.

---

### Task 10: Add setup-fitbit page tests

**Issue:** FOO-447
**Files:**
- `e2e/tests/setup-fitbit.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create `e2e/tests/setup-fitbit.spec.ts` with a `describe('Setup Fitbit Page')` block.

2. **GREEN** — Write tests that:
   - Page loads at `/app/setup-fitbit` with "Set Up Fitbit" heading
   - Back button (ArrowLeft icon in a ghost button) is visible with `aria-label="Back to Food Scanner"`
   - Clicking back button navigates to `/app`
   - Client ID and Client Secret form inputs are present
   - Capture screenshot

3. **REFACTOR** — Use accessible selectors (aria-label for back button, input roles for form fields).

**Notes:**
- Reference: `src/app/app/setup-fitbit/page.tsx` for page structure.
- Reference: `src/components/fitbit-setup-form.tsx` for form field names.
- The back button uses `Button asChild variant="ghost"` wrapping a `Link href="/app"` with `aria-label="Back to Food Scanner"`.

---

### Task 11: Add food detail page tests

**Issue:** FOO-448
**Files:**
- `e2e/tests/food-detail.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create `e2e/tests/food-detail.spec.ts` with a `describe('Food Detail Page')` block.

2. **GREEN** — Write tests that:
   - First, discover a seeded entry ID by calling `GET /api/food-history` with the authenticated `request` fixture and extracting the first entry's ID
   - Navigate to `/app/food-detail/{id}`
   - Verify the page renders without errors
   - Verify food name or nutrition data is visible
   - Capture screenshot

3. **REFACTOR** — Extract the "get entry ID" step into a `test.beforeAll` or the first test's setup.

**Notes:**
- Reference: `src/app/app/food-detail/[id]/page.tsx` and `src/components/food-detail.tsx`.
- The seeded entries have known food names (Grilled Chicken Breast, Brown Rice, Steamed Broccoli).
- The API call pattern from `health.spec.ts` works for this — use `request.get('/api/food-history')` with authenticated context to get IDs.

---

### Task 12: Add settings interaction tests

**Issue:** FOO-451
**Files:**
- `e2e/tests/settings.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Existing settings tests are minimal. Add new tests to the same file.

2. **GREEN** — Add tests that verify:
   - User email (`test@example.com`) visible on the page
   - Fitbit status displayed (likely "Not connected")
   - "Appearance" section heading visible
   - Theme buttons (Light, Dark, System) are visible
   - Clicking a theme button changes the active/selected state
   - "Logout" button visible (should have destructive styling)
   - "Fitbit App Credentials" section heading visible
   - Claude usage section renders

3. **REFACTOR** — Replace the existing minimal tests with these more comprehensive ones (or add alongside).

**Notes:**
- Reference: `src/components/settings-content.tsx` for component structure and section headings.
- Reference: `src/app/settings/page.tsx` for the overall page composition (SettingsContent + ApiKeyManager + ClaudeUsageSection).
- Theme buttons in SettingsContent use `variant` prop to show active state.

---

### Task 13: Add logout flow test

**Issue:** FOO-452
**Files:**
- `e2e/tests/logout.spec.ts` (create)

**TDD Steps:**

1. **RED** — Create `e2e/tests/logout.spec.ts` with a `describe('Logout Flow')` block.

2. **GREEN** — Write a test that:
   - Navigates to `/settings`
   - Finds and clicks the "Logout" button
   - Waits for redirect to `/` (landing page)
   - Verifies landing page shows "Login with Google" button (confirming unauthenticated state)
   - Verifies navigating to `/app` redirects back to `/` (session is destroyed)

3. **REFACTOR** — This test should use a **fresh browser context** (not the shared storage state) to avoid destroying the session for other parallel tests. Create a new context within the test, authenticate it via the test-login endpoint, then test logout.

**Notes:**
- Reference: `src/components/settings-content.tsx` for the logout button.
- The logout button calls `POST /api/auth/logout` → `src/app/api/auth/logout/route.ts`.
- **Critical isolation concern:** Playwright runs tests in parallel. If this test uses the shared authenticated storage state and logs out, it will invalidate the server-side session, potentially breaking concurrent tests. The test MUST create its own isolated browser context + session.
- Pattern: Use `browser.newContext()` → navigate to test-login endpoint → save context → run test → context is discarded after test.

---

### Task 14: Integration & Verification

**Issue:** FOO-453, FOO-454, FOO-455, FOO-452, FOO-451, FOO-450, FOO-449, FOO-448, FOO-447, FOO-446, FOO-445, FOO-444
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full E2E test suite: `npm run e2e`
2. Verify all new tests pass
3. Review captured screenshots in `e2e/screenshots/` — confirm mobile viewport
4. Run linter: `npm run lint`
5. Run type checker: `npm run typecheck`
6. Run unit tests: `npm test`
7. Build check: `npm run build`

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Unauthenticated API request | 401 with standardized error body | Task 4 (api-auth.spec.ts) |
| Logout destroys session | Redirect to landing, subsequent requests redirect | Task 13 (logout.spec.ts) |
| Missing Fitbit credentials | FitbitSetupGuard shows setup prompt | Tasks 8, 9 |
| Page navigation | Bottom nav updates active state | Task 5 |

## Risks & Open Questions

- [ ] **FitbitSetupGuard blocking content:** Tasks 8 (Quick Select) and 9 (Analyze) may render a setup prompt instead of the main component because the test user has no Fitbit credentials. Tests should verify what actually renders rather than assuming full content access. If deeper testing is needed, seed Fitbit credentials in `e2e/fixtures/db.ts`.
- [ ] **Logout test isolation:** Task 13 must use an isolated browser context to avoid destroying the shared session. This is a well-understood Playwright pattern but requires careful implementation.
- [ ] **Screenshot scroll positions:** Task 3 needs to decide between single viewport-only screenshots vs multiple scroll-position captures for long pages. Single viewport is simpler and recommended unless visual regression tooling is planned.

## Scope Boundaries

**In Scope:**
- Mobile viewport configuration for Playwright
- Fixing seed data mealTypeId bug
- Removing fullPage from existing screenshots
- New test files for all untested pages
- API-level auth boundary tests
- Navigation and interaction tests for existing pages
- Logout flow with session isolation

**Out of Scope:**
- Camera/AI flow testing (hardware-dependent)
- Fitbit OAuth flow testing (requires real OAuth)
- Visual regression tooling (screenshot comparison)
- CI/CD pipeline for E2E tests (separate backlog item)
- Seeding Fitbit credentials for deeper quick-select/analyze testing

---

## Iteration 1

**Implemented:** 2026-02-14
**Method:** Agent team (4 workers)

### Tasks Completed This Iteration
- Task 1: Fix seed data mealTypeId bug (FOO-455) - Changed mealTypeId from 7 to 5 for Steamed Broccoli entry (worker-1)
- Task 2: Switch Playwright to mobile viewport (FOO-454) - Replaced Desktop Chrome with 390x844 mobile viewport (worker-1)
- Task 3: Fix existing screenshot calls to remove fullPage (FOO-454) - Removed fullPage: true from 3 existing test files (worker-1)
- Task 4: Add API route auth protection tests (FOO-453) - Created api-auth.spec.ts with 8 tests verifying 401 responses (worker-2)
- Task 5: Add bottom navigation tests (FOO-449) - Created navigation.spec.ts with 6 tests for nav visibility, active state, routing (worker-2)
- Task 6: Add dashboard action link navigation tests (FOO-450) - Added test verifying Take Photo and Quick Select navigation (worker-1)
- Task 7: Add history page tests (FOO-444) - Created history.spec.ts with 6 tests for entries, date grouping, detail dialog (worker-4)
- Task 8: Add quick select page tests (FOO-445) - Created quick-select.spec.ts with 2 tests for page load and FitbitSetupGuard (worker-3)
- Task 9: Add analyze page tests (FOO-446) - Created analyze.spec.ts with 4 tests including autoCapture and console errors (worker-3)
- Task 10: Add setup-fitbit page tests (FOO-447) - Created setup-fitbit.spec.ts with 3 tests for form and back navigation (worker-3)
- Task 11: Add food detail page tests (FOO-448) - Created food-detail.spec.ts with 3 tests using API-discovered entry IDs (worker-4)
- Task 12: Add settings interaction tests (FOO-451) - Added 5 tests for session info, theme, credentials, logout button (worker-1)
- Task 13: Add logout flow test (FOO-452) - Created logout.spec.ts with isolated browser context test (worker-2)
- Task 14: Integration & Verification - Full verification suite passed (lead)

### Files Modified
- `e2e/fixtures/db.ts` - Fixed mealTypeId from 7 to 5 for Steamed Broccoli entry
- `playwright.config.ts` - Mobile viewport (390x844), removed devices import
- `e2e/tests/dashboard.spec.ts` - Removed fullPage screenshot, added navigation test
- `e2e/tests/landing.spec.ts` - Removed fullPage screenshot
- `e2e/tests/settings.spec.ts` - Removed fullPage screenshot, added 5 interaction tests
- `e2e/tests/api-auth.spec.ts` - Created: 8 API auth boundary tests
- `e2e/tests/navigation.spec.ts` - Created: 6 bottom nav tests
- `e2e/tests/logout.spec.ts` - Created: 1 isolated logout flow test
- `e2e/tests/quick-select.spec.ts` - Created: 2 quick select page tests
- `e2e/tests/analyze.spec.ts` - Created: 4 analyze page tests
- `e2e/tests/setup-fitbit.spec.ts` - Created: 3 setup-fitbit page tests
- `e2e/tests/history.spec.ts` - Created: 6 history page tests
- `e2e/tests/food-detail.spec.ts` - Created: 3 food detail page tests

### Linear Updates
- FOO-455: Todo → In Progress → Review
- FOO-454: Todo → In Progress → Review
- FOO-453: Todo → In Progress → Review
- FOO-449: Todo → In Progress → Review
- FOO-450: Todo → In Progress → Review
- FOO-451: Todo → In Progress → Review
- FOO-452: Todo → In Progress → Review
- FOO-445: Todo → In Progress → Review
- FOO-446: Todo → In Progress → Review
- FOO-447: Todo → In Progress → Review
- FOO-444: Todo → In Progress → Review
- FOO-448: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 issues — fixed fullPage inconsistency (5 files) and APIResponse type error (1 file)
- verifier: All 271 unit tests pass, 52 E2E tests pass, zero warnings, clean build

### Work Partition
- Worker 1: Tasks 1, 2, 3, 6, 12 (config fixes + existing test modifications)
- Worker 2: Tasks 4, 5, 13 (API auth + navigation + logout tests)
- Worker 3: Tasks 8, 9, 10 (Fitbit-related page tests)
- Worker 4: Tasks 7, 11 (history + food detail page tests)

### Continuation Status
All tasks completed.
