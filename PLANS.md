# Implementation Plan

**Status:** COMPLETE
**Branch:** feat/FOO-478-quick-select-scroll-fix-and-e2e
**Issues:** FOO-478, FOO-467, FOO-468, FOO-469, FOO-471, FOO-472, FOO-473, FOO-474, FOO-475, FOO-476, FOO-477
**Created:** 2026-02-15
**Last Updated:** 2026-02-15

## Summary

Fix the Quick Select infinite scroll flickering bug (FOO-478) and add E2E test coverage for untested user flows across analyze, chat, history, dashboard, and settings pages (FOO-467–FOO-477).

## Issues

### FOO-478: Quick Select infinite scroll flickers during pagination

**Priority:** Urgent
**Labels:** Bug
**Description:** Scrolling down on Quick Select causes rapid flickering. Root cause analysis:

1. **IntersectionObserver recreates on every validation cycle** — `isValidating` in the observer effect's dependency array (line 115 of `quick-select.tsx`) causes the observer to disconnect and reconnect every time SWR starts/finishes a fetch. When the sentinel is visible, the new observer immediately fires `setSize()`, triggering another fetch → creating a pagination loop.
2. **Missing `revalidateOnFocus: false`** — tab-switching triggers revalidation storms across all loaded pages.
3. **Empty state flashes during transitions** — condition `!searchLoading && foods.length === 0` (line 423) shows "No foods found" briefly during tab switches before data loads.

**Note:** The issue also mentions `isSearchActive` missing from `getKey` deps. After review, `getKey` does NOT reference `isSearchActive`, so this is not a bug. However, `getKey` should return `null` when search is active to avoid unnecessary background fetches — include this optimization.

**Acceptance Criteria:**
- [ ] IntersectionObserver does not recreate when `isValidating` changes
- [ ] `revalidateOnFocus: false` is set on `useSWRInfinite`
- [ ] Empty state does not flash during tab switches
- [ ] `getKey` returns `null` when search is active (optimization)
- [ ] Unit tests cover the fixed behaviors

### FOO-467: E2E: Analyze → Log to Fitbit full flow not tested

**Priority:** Medium
**Labels:** Feature
**Description:** The analyze page tests mock the analysis API and capture screenshots but never complete the full flow: receive analysis → select meal type → click "Log to Fitbit" → see confirmation screen.

**Acceptance Criteria:**
- [ ] E2E test completes the full analyze → log → confirmation flow
- [ ] Confirmation screen is verified (green checkmark, food name, "Log Another" button)

### FOO-475: E2E screenshots: Food log confirmation screen missing

**Priority:** Low
**Labels:** Improvement
**Description:** The confirmation screen (green checkmark, nutrition facts, Log Another/Done buttons) is never captured as a screenshot.

**Acceptance Criteria:**
- [ ] Screenshot of confirmation screen is captured (combined with FOO-467 flow)

### FOO-476: E2E screenshots: Quick Select food detail card missing

**Priority:** Low
**Labels:** Improvement
**Description:** When a food is tapped in Quick Select, the nutrition detail card expands. This state is never captured as a screenshot.

**Acceptance Criteria:**
- [ ] Screenshot of expanded Quick Select food detail card is captured

### FOO-468: E2E: Refine chat → Log flow not tested

**Priority:** Medium
**Labels:** Feature
**Description:** The refine chat spec only captures screenshots. The chat overlay's "Log to Fitbit" button is never exercised.

**Acceptance Criteria:**
- [ ] E2E test exercises the chat's Log to Fitbit button
- [ ] Confirmation screen renders after logging from chat
- [ ] The refined analysis values (not original) are sent to log-food API

### FOO-469: E2E: Analyze and chat error states not tested

**Priority:** Low
**Labels:** Feature
**Description:** No E2E test verifies error display and retry/dismiss behavior when analyze-food or chat-food APIs return errors.

**Acceptance Criteria:**
- [ ] E2E test mocks analyze-food API error and verifies error UI + retry button
- [ ] E2E test mocks chat-food API error and verifies dismissible error in chat

### FOO-471: E2E: History date navigation not tested

**Priority:** Low
**Labels:** Feature
**Description:** History E2E tests only verify today's entries. The date picker is never used to navigate to a different date.

**Acceptance Criteria:**
- [ ] E2E test uses jump-to-date to navigate to a past date
- [ ] Verifies empty state when no entries exist for the selected date

### FOO-477: E2E screenshots: History with date filter applied missing

**Priority:** Low
**Labels:** Improvement
**Description:** No screenshot shows the history page with a date filter applied.

**Acceptance Criteria:**
- [ ] Screenshot captured showing history with date filter active (combined with FOO-471)

### FOO-472: E2E: Dashboard date and week navigation not tested

**Priority:** Low
**Labels:** Feature
**Description:** Dashboard E2E tests never click the prev/next navigation arrows on daily or weekly views.

**Acceptance Criteria:**
- [ ] E2E test clicks prev arrow on daily view and verifies date change
- [ ] E2E test clicks next arrow to return to today
- [ ] E2E test clicks prev/next arrows on weekly view
- [ ] Verifies next arrow is disabled when at today/current week

### FOO-473: E2E: Settings Fitbit re-auth and secret replacement not tested

**Priority:** Low
**Labels:** Feature
**Description:** Settings page has "Reconnect Fitbit" and "Replace Secret" flows that are not tested.

**Acceptance Criteria:**
- [ ] E2E test exercises the "Replace Secret" flow (click → enter secret → save)
- [ ] E2E test clicks "Reconnect Fitbit" button and verifies redirect behavior

### FOO-474: E2E: Claude Usage display with seeded data not tested

**Priority:** Low
**Labels:** Feature
**Description:** No `claude_usage` rows are seeded, so the Claude API Usage section always shows empty state.

**Acceptance Criteria:**
- [ ] claude_usage rows seeded in E2E test data
- [ ] E2E test verifies usage metrics display (month card, requests, cost, tokens)

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Node modules installed
- [ ] E2E dependencies installed (Playwright)

## Implementation Tasks

### Task 1: Fix IntersectionObserver recreation bug

**Issue:** FOO-478
**Files:**
- `src/components/__tests__/quick-select.test.tsx` (create or modify)
- `src/components/quick-select.tsx` (modify)

**TDD Steps:**

1. **RED** — Write a test for the QuickSelect component that verifies IntersectionObserver behavior. The test should render QuickSelect with mocked `useSWRInfinite` returning paginated data with `hasMore=true`. Assert that when `isValidating` changes from `true` to `false`, `setSize` is NOT called repeatedly (i.e., no rapid-fire pagination loop). Mock `IntersectionObserver` globally in the test. Use the pattern from existing component tests in `src/components/__tests__/`.
   - Run: `npm test -- quick-select`
   - Verify: Test fails because current implementation recreates observer on every `isValidating` change

2. **GREEN** — Fix `src/components/quick-select.tsx`:
   - Add a `useRef` to track `isValidating` without triggering effect recreation: `const isValidatingRef = useRef(false); isValidatingRef.current = isValidating;`
   - Remove `isValidating` from the `useEffect` dependency array (line 115), replacing the direct `isValidating` reference in the callback with `isValidatingRef.current`
   - Final deps should be: `[hasMore, setSize, isSearchActive]`
   - Run: `npm test -- quick-select`
   - Verify: Test passes — observer is stable across validation changes

3. **REFACTOR** — No additional refactoring needed; change is surgical.

### Task 2: Add revalidateOnFocus and optimize getKey for search

**Issue:** FOO-478
**Files:**
- `src/components/__tests__/quick-select.test.tsx` (modify)
- `src/components/quick-select.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests:
   - Test that `useSWRInfinite` is called with `revalidateOnFocus: false` in its options
   - Test that `getKey` returns `null` when `isSearchActive` is true (prevents background pagination during search)
   - Run: `npm test -- quick-select`
   - Verify: Tests fail

2. **GREEN** — Fix `src/components/quick-select.tsx`:
   - Add `revalidateOnFocus: false` to the `useSWRInfinite` options object (line 86-88)
   - In `getKey`, add an early return `null` when search is active. Add `isSearchActive` to the `useCallback` dependency array. Since `isSearchActive` is derived from `debouncedQuery` (not state), pass `debouncedQuery.length >= 2` check or restructure to include `isSearchActive` as a stable dependency.
   - Run: `npm test -- quick-select`
   - Verify: Tests pass

3. **REFACTOR** — Clean up if needed.

### Task 3: Fix empty state flash during tab switches

**Issue:** FOO-478
**Files:**
- `src/components/__tests__/quick-select.test.tsx` (modify)
- `src/components/quick-select.tsx` (modify)

**TDD Steps:**

1. **RED** — Write a test that renders QuickSelect with `loadingFoods=true` (via mocked `useSWRInfinite`) and `foods=[]`. Assert that the "No foods found" empty state text is NOT visible during loading. Currently the empty state condition (line 423) only checks `!searchLoading && foods.length === 0` but does not check `loadingFoods`.
   - Run: `npm test -- quick-select`
   - Verify: Test fails — empty state shows even when loading

2. **GREEN** — Fix the empty state condition at line 423 of `quick-select.tsx`:
   - Change `!searchLoading && foods.length === 0` to also exclude the loading state. Add `!loadingFoods` to the condition: `!searchLoading && !loadingFoods && foods.length === 0`
   - Also guard against `isValidating` with no data: add `!isLoadingMore` or check `!isValidating || (pages && pages.length > 0)`
   - Run: `npm test -- quick-select`
   - Verify: Test passes

3. **REFACTOR** — Verify all loading/empty state transitions are correct.

**Notes:**
- The existing "Loading state" guard (lines 347-358) only triggers when `loadingFoods && !pages`, so it won't catch all cases during tab switches where `pages` might briefly be undefined.

### Task 4: E2E: Analyze → Log → Confirmation flow + screenshot

**Issue:** FOO-467, FOO-475
**Files:**
- `e2e/tests/analyze.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add a new test `'completes full analyze → log → confirmation flow'` to `e2e/tests/analyze.spec.ts`:
   - Mock `/api/analyze-food` to return `MOCK_ANALYSIS` (already imported in the file)
   - Mock `/api/find-matches` to return empty matches
   - Mock `/api/log-food` to return `{ success: true, data: { success: true, reusedFood: false, foodLogId: 12345 } }`
   - Fill description → click "Analyze Food" → wait for result
   - Click "Log to Fitbit" button
   - Assert `FoodLogConfirmation` renders: look for "logged successfully" text pattern, "Log Another" button, and "Done" button
   - Capture screenshot with `captureScreenshots(page, 'analyze-confirmation')` — this satisfies FOO-475
   - Run: `npm run e2e -- --grep "full analyze"`
   - Verify: Test passes

2. **GREEN** — No app code changes needed. The test exercises existing functionality.

3. **REFACTOR** — Ensure mock patterns are consistent with existing tests in the file.

**Notes:**
- Follow the mock pattern from the existing `'captures screenshot with analysis result'` test (lines 33-70)
- The `FoodLogConfirmation` component renders a green checkmark icon, the food name, nutrition facts card, and "Log Another" / "Done" buttons
- Use `MOCK_ANALYSIS` from `e2e/fixtures/mock-data.ts` (already imported)

### Task 5: E2E: Quick Select food detail card screenshot

**Issue:** FOO-476
**Files:**
- `e2e/tests/quick-select.spec.ts` (modify)

**TDD Steps:**

1. **RED/GREEN** — In the existing `'select food shows nutrition detail'` test, add a screenshot capture after the assertions. Add `import { captureScreenshots } from '../fixtures/screenshots';` at the top (if not already imported). After verifying nutrition info is visible (line 119), call `captureScreenshots(page, 'quick-select-detail')`.
   - Run: `npm run e2e -- --grep "nutrition detail"`
   - Verify: Test passes and screenshot is captured

**Notes:**
- This is a minimal change — just one line added to an existing test plus import if needed.
- Check if `captureScreenshots` is already imported in the file (it IS imported on line 2).

### Task 6: E2E: Refine chat → Log flow

**Issue:** FOO-468
**Files:**
- `e2e/tests/refine-chat.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add a new test `'logs refined analysis from chat overlay'` to `e2e/tests/refine-chat.spec.ts`:
   - Use the existing `setupChatOverlay` helper to get to the chat overlay
   - Mock `/api/chat-food` to return `MOCK_REFINED_ANALYSIS` with a message (same pattern as existing conversation test)
   - Mock `/api/log-food` to return success: `{ success: true, data: { success: true, reusedFood: false, foodLogId: 12345 } }`
   - Send a chat message → wait for refined analysis response
   - Click the "Log to Fitbit" button within the chat overlay header
   - Verify the confirmation screen renders (food name, success message)
   - Optionally verify that the logged values match `MOCK_REFINED_ANALYSIS` by intercepting the `/api/log-food` request and checking the body
   - Run: `npm run e2e -- --grep "logs refined"`
   - Verify: Test passes

2. **GREEN** — No app code changes needed.

3. **REFACTOR** — Ensure consistent mock patterns.

**Notes:**
- The chat overlay's "Log to Fitbit" button is in the chat header, separate from the main analyze page's log button
- The chat uses `latestAnalysis` from conversation state (the refined values), not the original analysis
- Reference existing mock pattern in the `'captures refine chat with conversation'` test (lines 68-98)

### Task 7: E2E: Analyze and chat error states

**Issue:** FOO-469
**Files:**
- `e2e/tests/analyze.spec.ts` (modify)
- `e2e/tests/refine-chat.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add test `'shows error and retry button on analysis failure'` to `e2e/tests/analyze.spec.ts`:
   - Mock `/api/analyze-food` to return `{ success: false, error: { code: "ANALYSIS_FAILED", message: "Failed to analyze food" } }` with status 500
   - Fill description → click "Analyze Food"
   - Assert error message visible (look for `role="alert"` or the error text)
   - Assert "Retry" or "Analyze" button is still visible for retry
   - Run: `npm run e2e -- --grep "error and retry"`
   - Verify: Test passes

2. **RED** — Add test `'shows dismissible error in chat on API failure'` to `e2e/tests/refine-chat.spec.ts`:
   - Use `setupChatOverlay` to get to the chat
   - Mock `/api/chat-food` to return `{ success: false, error: { code: "CHAT_FAILED", message: "Failed to process message" } }` with status 500
   - Send a message → wait for error
   - Assert error banner visible in the chat message stream
   - Click the dismiss X button
   - Assert error is no longer visible
   - Run: `npm run e2e -- --grep "dismissible error"`
   - Verify: Test passes

3. **GREEN** — No app code changes needed.

**Notes:**
- `food-analyzer.tsx` shows error with `role="alert"` and `aria-live="polite"` — use these selectors
- `food-chat.tsx` error banner has a dismiss button with X icon (lines 458-469)
- Error scenarios include: analysis failure, chat failure, timeout (30s chat, 15s log)

### Task 8: E2E: History date navigation + screenshot

**Issue:** FOO-471, FOO-477
**Files:**
- `e2e/tests/history.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add test `'jump to past date shows empty state'` to `e2e/tests/history.spec.ts`:
   - Navigate to history page, wait for load
   - Find the "Jump to date" input (`page.getByLabel('Jump to date')`)
   - Fill with a past date that has no entries (e.g., `2020-01-01`)
   - Click "Go" button
   - Wait for page update
   - Assert that "Today" heading is NOT visible
   - Assert empty state is shown (no food entries, empty message or different date header)
   - Capture screenshot with `captureScreenshots(page, 'history-past-date')` — this satisfies FOO-477
   - Run: `npm run e2e -- --grep "past date"`
   - Verify: Test passes

2. **GREEN** — No app code changes needed.

3. **REFACTOR** — Ensure the empty state message is descriptive enough for the screenshot.

**Notes:**
- The history API returns entries for a specific date. A date with no seeded entries should show an empty state.
- Use the existing `captureScreenshots` import (already in the file on line 2).
- The existing `'jump to date navigates to correct date'` test (line 82) fills today's date — the new test should use a past date.

### Task 9: E2E: Dashboard date and week navigation

**Issue:** FOO-472
**Files:**
- `e2e/tests/dashboard.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add test `'daily view date navigation arrows work'` to `e2e/tests/dashboard.spec.ts`:
   - Navigate to dashboard, wait for load
   - Verify Daily tab is active
   - Find the "Previous day" button (`page.getByRole('button', { name: /Previous day/i })`)
   - Click it
   - Verify the displayed date changes (the date text in `DateNavigator` should show yesterday's date)
   - Find the "Next day" button and click it to return to today
   - Verify the "Next day" button is disabled when viewing today (the component disables it when `!canGoForward`)
   - Run: `npm run e2e -- --grep "date navigation arrows"`
   - Verify: Test passes

2. **RED** — Add test `'weekly view week navigation arrows work'` to the same file:
   - Navigate to dashboard, switch to Weekly tab
   - Find the "Previous week" button (`page.getByRole('button', { name: /Previous week/i })`)
   - Click it
   - Verify the week range text changes
   - Click "Next week" to return
   - Verify "Next week" button is disabled when at current week
   - Run: `npm run e2e -- --grep "week navigation"`
   - Verify: Test passes

3. **GREEN** — No app code changes needed.

**Notes:**
- `date-navigator.tsx` uses `aria-label`: "Previous day" / "Next day"
- `week-navigator.tsx` uses `aria-label`: "Previous week" / "Next week"
- Both disable the forward button when at today/current week and backward button when at earliest date
- Use `toBeDisabled()` assertion for the disabled state check

### Task 10: E2E: Settings Fitbit secret replacement and re-auth

**Issue:** FOO-473
**Files:**
- `e2e/tests/settings.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add test `'replace secret flow works'` to `e2e/tests/settings.spec.ts`:
   - Navigate to settings, wait for load
   - Find and click the "Replace Secret" button
   - Verify a Client Secret input appears
   - Fill with a new secret value (e.g., `NEW_TEST_SECRET`)
   - Click "Save" button
   - Wait for save to complete
   - Verify success feedback (secret saved, input hidden, masked secret shown)
   - Run: `npm run e2e -- --grep "replace secret"`
   - Verify: Test passes

2. **RED** — Add test `'reconnect Fitbit button redirects to auth'` to the same file:
   - Navigate to settings, wait for load
   - Find the "Reconnect Fitbit" button (or similar text like "Reconnect" / "Re-authorize")
   - Verify it's visible
   - Click it
   - Verify redirect to `/api/auth/fitbit` or that the page URL changes to the Fitbit OAuth flow
   - Since the OAuth flow involves external redirect, just verify the navigation attempt starts (URL contains `fitbit` or `api/auth`)
   - Run: `npm run e2e -- --grep "reconnect Fitbit"`
   - Verify: Test passes

3. **GREEN** — No app code changes needed.

**Notes:**
- The existing `'update credentials from settings succeeds'` test (line 80) shows the pattern for interacting with the credentials form
- The "Replace Secret" button triggers a different UI flow than "Edit" (Client ID)
- "Reconnect Fitbit" may redirect to the Fitbit OAuth URL — the test should handle the redirect gracefully (mock the route or just check URL change)

### Task 11: E2E: Seed claude_usage data and test display

**Issue:** FOO-474
**Files:**
- `e2e/fixtures/db.ts` (modify)
- `e2e/tests/settings.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Add a test `'displays Claude API usage metrics'` to `e2e/tests/settings.spec.ts`:
   - Navigate to settings, wait for load
   - Scroll to the Claude API Usage section
   - Assert that usage data is visible: month name, request count, cost, or token counts
   - Run: `npm run e2e -- --grep "Claude API usage"`
   - Verify: Test fails because no claude_usage rows are seeded

2. **GREEN** — Seed claude_usage data in `e2e/fixtures/db.ts`:
   - In the `seedTestData` function, after existing seeding, insert 2-3 `claude_usage` rows for the test user
   - Use the schema fields: `userId`, `model` (e.g., "claude-sonnet-4-5-20250929"), `operation` (e.g., "analyze-food"), `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens`, `inputPricePerMToken`, `outputPricePerMToken`, `costUsd`, `createdAt`
   - Use realistic values: e.g., model "claude-sonnet-4-5-20250929", operation "analyze-food", inputTokens 1500, outputTokens 800, costUsd "0.012"
   - Set `createdAt` to a recent date within the current month so it shows in the usage display
   - Run: `npm run e2e -- --grep "Claude API usage"`
   - Verify: Test passes — usage metrics are visible

3. **REFACTOR** — Ensure seeded data doesn't affect other settings tests.

**Notes:**
- Schema: `claudeUsage` table in `src/db/schema.ts` (lines 115-128)
- The `ClaudeUsageSection` component groups usage by month and shows request count, cost, and token breakdown
- Import `claudeUsage` from `@/db/schema` in `e2e/fixtures/db.ts` (already imported on line 11)

### Task 12: Integration & Verification

**Issue:** FOO-478, FOO-467, FOO-468, FOO-469, FOO-471, FOO-472, FOO-473, FOO-474, FOO-475, FOO-476, FOO-477
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full unit test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run full E2E suite: `npm run e2e`
5. Build check: `npm run build`

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| IntersectionObserver rapid-fire pagination | Observer stays stable across validation changes | Unit test (Task 1) |
| Tab switch empty state flash | Empty state hidden during loading | Unit test (Task 3) |
| Analysis API error | Error message + retry button displayed | E2E test (Task 7) |
| Chat API error | Dismissible error banner in chat | E2E test (Task 7) |
| Log API error | Error message displayed with retry | Existing coverage |

## Risks & Open Questions

- [ ] **IntersectionObserver mocking complexity**: Mocking `IntersectionObserver` in jsdom requires a global mock. If too complex, consider testing the behavior at E2E level instead of unit test level.
- [ ] **Chat overlay Log button selector**: The chat overlay's "Log to Fitbit" button may need a specific selector if it's visually different from the main page's log button. Inspect the DOM during implementation.
- [ ] **Reconnect Fitbit redirect**: The OAuth redirect goes to an external URL. The E2E test should mock the route or verify only the initial navigation attempt, not the full OAuth flow.
- [ ] **claude_usage seed data**: Seeded records must have `createdAt` in the current month for the usage section to display them. Use `new Date()` or a date within the current month.

## Scope Boundaries

**In Scope:**
- Fix Quick Select infinite scroll flicker (all 4 sub-issues from FOO-478)
- E2E tests for analyze → log flow, chat → log flow, error states
- E2E tests for date/week navigation in history and dashboard
- E2E tests for settings credential rotation
- E2E test for Claude usage display with seeded data
- Screenshots: confirmation, quick select detail, history date filter

**Out of Scope:**
- FOO-470 (Canceled): Quick Select delete food — the component has no delete button
- Quick Select performance optimization beyond the scroll fix
- Adding new UI features or components
- Modifying the Fitbit OAuth flow
- Adding unit tests for E2E-tested-only functionality

---

## Iteration 1

**Implemented:** 2026-02-14
**Method:** Agent team (4 workers)

### Tasks Completed This Iteration
- Task 1: Fix IntersectionObserver recreation bug (worker-1) — FOO-478
- Task 2: Add revalidateOnFocus and optimize getKey for search (worker-1) — FOO-478
- Task 3: Fix empty state flash during tab switches (worker-1) — FOO-478
- Task 4: E2E: Analyze → Log → Confirmation flow + screenshot (worker-2) — FOO-467, FOO-475
- Task 5: E2E: Quick Select food detail card screenshot (worker-3) — FOO-476
- Task 6: E2E: Refine chat → Log flow (worker-2) — FOO-468
- Task 7: E2E: Analyze and chat error states (worker-2) — FOO-469
- Task 8: E2E: History date navigation + screenshot (worker-3) — FOO-471, FOO-477
- Task 9: E2E: Dashboard date and week navigation (worker-3) — FOO-472
- Task 10: E2E: Settings Fitbit secret replacement and re-auth (worker-4) — FOO-473
- Task 11: E2E: Seed claude_usage data and test display (worker-4) — FOO-474
- Task 12: Integration & Verification (lead)

### Files Modified
- `src/components/quick-select.tsx` — Fixed IntersectionObserver recreation with useRef, added revalidateOnFocus: false, getKey returns null during search, fixed empty state flash, added optional chaining on entries[0]
- `src/components/__tests__/quick-select.test.tsx` — 5 new unit tests covering observer stability, revalidateOnFocus, getKey null during search, empty state during loading
- `e2e/tests/analyze.spec.ts` — 2 new tests: full analyze→log→confirmation flow, error state with retry button
- `e2e/tests/refine-chat.spec.ts` — 2 new tests: chat→log flow with refined analysis verification, dismissible error on API failure
- `e2e/tests/quick-select.spec.ts` — Added screenshot capture for food detail card
- `e2e/tests/history.spec.ts` — 1 new test: jump to past date shows empty state with screenshot
- `e2e/tests/dashboard.spec.ts` — 2 new tests: daily view date navigation, weekly view week navigation
- `e2e/tests/settings.spec.ts` — 3 new tests: replace secret flow, reconnect Fitbit auth flow, Claude API usage metrics display
- `e2e/fixtures/db.ts` — Added claude_usage seeding with deterministic timestamps

### Linear Updates
- FOO-478: Todo → In Progress → Review
- FOO-467: Todo → In Progress → Review
- FOO-468: Todo → In Progress → Review
- FOO-469: Todo → In Progress → Review
- FOO-471: Todo → In Progress → Review
- FOO-472: Todo → In Progress → Review
- FOO-473: Todo → In Progress → Review
- FOO-474: Todo → In Progress → Review
- FOO-475: Todo → In Progress → Review
- FOO-476: Todo → In Progress → Review
- FOO-477: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 8 issues (1 HIGH, 3 MEDIUM, 4 LOW). Fixed 5: deterministic timestamps in claude_usage seed, optional chaining on IntersectionObserver entries, visibility assertion before dismiss button click, removed unnecessary .catch() in history spec, fixed setupChatOverlay strict mode violation.
- verifier: All 1688 unit tests pass, zero warnings, build clean
- E2E: All 110 tests pass

### Work Partition
- Worker 1: Tasks 1, 2, 3 (quick-select.tsx + unit tests — TDD workflow)
- Worker 2: Tasks 4, 6, 7 (analyze.spec.ts + refine-chat.spec.ts — E2E write-only)
- Worker 3: Tasks 5, 8, 9 (quick-select.spec.ts + history.spec.ts + dashboard.spec.ts — E2E write-only)
- Worker 4: Tasks 10, 11 (settings.spec.ts + db.ts — E2E write-only)

### Review Findings

Files reviewed: 9
Reviewers: security, reliability, quality (agent team)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found - all implementations are correct and follow project conventions.

**Discarded findings (not bugs):**
- [DISCARDED] ASYNC/RESOURCE: Pending resubmit fetch has no AbortController cleanup (`src/components/quick-select.tsx:156-197`) — React 18+ silently ignores setState on unmounted components (no warnings or leaks). This is a mount-only effect on a page-level component, and aborting a POST request mid-flight would be worse behavior (food logged on server but user gets no confirmation).

### Linear Updates
- FOO-478: Review → Merge
- FOO-467: Review → Merge
- FOO-468: Review → Merge
- FOO-469: Review → Merge
- FOO-471: Review → Merge
- FOO-472: Review → Merge
- FOO-473: Review → Merge
- FOO-474: Review → Merge
- FOO-475: Review → Merge
- FOO-476: Review → Merge
- FOO-477: Review → Merge

<!-- REVIEW COMPLETE -->

### Continuation Status
All tasks completed.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
