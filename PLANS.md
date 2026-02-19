# Implementation Plan

**Status:** COMPLETE
**Branch:** feat/FOO-621-ui-consistency-polish
**Issues:** FOO-621, FOO-622, FOO-628, FOO-629, FOO-632, FOO-635, FOO-638, FOO-640
**Created:** 2026-02-19
**Last Updated:** 2026-02-19

## Summary

A batch of UI consistency and polish improvements across the Food Scanner app. These address visual inconsistencies (tab border-radius, action card sizing, button hierarchy), information density problems (food history layout, dense macro summaries), and UX refinements (removing technical Log ID from success screen, settings back arrow, food detail heading standardization, analyze button enabled state).

## Issues

### FOO-621: Inconsistent tab/segmented-control border-radius

**Priority:** Medium
**Labels:** Improvement
**Description:** Quick Select tab buttons use `rounded-lg` while Dashboard shell (Daily/Weekly toggle) uses `rounded-full`. Both are tab/segmented-control patterns that should look identical.

**Acceptance Criteria:**
- [ ] All tab/segmented-control patterns use the same border-radius
- [ ] Visual consistency across Quick Select and Dashboard shell

### FOO-622: Home page action cards have inconsistent visual weight

**Priority:** Medium
**Labels:** Improvement
**Description:** "Take Photo" and "Quick Select" cards use `p-4` + `h-8 w-8` icons while "Chat" card uses `p-3` + `h-6 w-6` icon. The size difference feels haphazard rather than intentional.

**Acceptance Criteria:**
- [ ] All action cards use consistent padding and icon sizes, OR
- [ ] Clear intentional visual hierarchy between primary and secondary actions

### FOO-628: Food history names truncate too early and macro summary is dense

**Priority:** Medium
**Labels:** Improvement
**Description:** (1) Food names truncate prematurely via `truncate` CSS class even though names aren't particularly long — the bold calorie value takes too much horizontal space. (2) Date header macro summary (`420 cal | P:30.0g C:45.0g F:12.0g`) is a dense wall of abbreviated text.

**Acceptance Criteria:**
- [ ] Food names display fully or wrap instead of truncating prematurely
- [ ] Macro summary is scannable at a glance

### FOO-629: Settings page has back arrow despite being a root page

**Priority:** Medium
**Labels:** Improvement
**Description:** Settings has a back arrow in its header (`settings-content.tsx:112-119`), but every other bottom-nav destination (Home, Quick Select, Analyze, History) has no back arrow.

**Acceptance Criteria:**
- [ ] Settings page has no back arrow in its header
- [ ] Navigation pattern consistent across all bottom-nav destinations

### FOO-632: Food detail views use different heading approaches from different entry points

**Priority:** Medium
**Labels:** Improvement
**Description:** From Quick Select: page heading remains "Quick Select" with food content below. From History (food-detail page): page heading IS the food name with "Back" above. Same food detail context uses two different navigation patterns.

**Acceptance Criteria:**
- [ ] Food detail views use consistent heading pattern regardless of entry point
- [ ] Navigation (back link) consistent across entry points

### FOO-635: Food log confirmation exposes technical Log ID

**Priority:** Low
**Labels:** Improvement
**Description:** The success screen shows `Log ID: {response.fitbitLogId}` at `food-log-confirmation.tsx:60-62` which is meaningless to the user.

**Acceptance Criteria:**
- [ ] Log ID not shown to users on the success screen

### FOO-638: Dashboard "Update Lumen goals" button has inconsistent visual weight

**Priority:** Low
**Labels:** Improvement
**Description:** The "Update Lumen goals" button is a centered `variant="secondary" size="sm"` button (`daily-dashboard.tsx:280-293`), while other action buttons in the app are full-width.

**Acceptance Criteria:**
- [ ] Button styling consistent with secondary action patterns in the app

### FOO-640: Analyze Food button looks disabled even with content entered

**Priority:** Low
**Labels:** Improvement
**Description:** The "Analyze Food" button (`food-analyzer.tsx:636-642`) uses the default Button variant. The enabled vs disabled visual distinction relies solely on `disabled:opacity-50`, which is subtle. The enabled state should be more prominent.

**Acceptance Criteria:**
- [ ] Enabled Analyze Food button clearly distinct from disabled state
- [ ] Primary action button styling consistent with other primary buttons in the app

## Prerequisites

- [ ] All existing tests pass (`npm test`)
- [ ] Clean working tree on feature branch

## Implementation Tasks

### Task 1: Remove Log ID from confirmation screen

**Issue:** FOO-635
**Files:**
- `src/components/food-log-confirmation.tsx` (modify)
- `src/components/__tests__/food-log-confirmation.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update existing test `"displays fitbitLogId"` (line 86-95) to assert that the Log ID is NOT displayed. The test currently asserts `screen.getByText(/67890/)` — change it to assert `screen.queryByText(/Log ID/)` returns null.
   - Run: `npm test -- food-log-confirmation`
   - Verify: Test fails because Log ID is still rendered.

2. **GREEN** — Remove the conditional `{response.fitbitLogId != null && (...)}` block at lines 60-62 of `food-log-confirmation.tsx`.
   - Run: `npm test -- food-log-confirmation`
   - Verify: Test passes.

3. **REFACTOR** — No refactoring needed; this is a simple removal.

**Notes:**
- The existing test at line 86 (`"displays fitbitLogId"`) should be renamed to something like `"does not display fitbitLogId"` to reflect the new behavior.

---

### Task 2: Remove back arrow from Settings page

**Issue:** FOO-629
**Files:**
- `src/components/settings-content.tsx` (modify)
- `src/components/__tests__/settings-content.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add a test asserting that no back arrow link exists. Use `screen.queryByLabelText("Back to Food Scanner")` and assert it returns null. Also check that the h1 "Settings" is still rendered without the link wrapper.
   - Run: `npm test -- settings-content`
   - Verify: Test fails because the back arrow link exists.

2. **GREEN** — Remove the `<Button asChild variant="ghost" size="icon">` wrapping the `<Link href="/app">` with `<ArrowLeft>` at lines 113-117 of `settings-content.tsx`. Keep the `<h1>Settings</h1>` heading. Remove the `ArrowLeft` import if unused.
   - Run: `npm test -- settings-content`
   - Verify: Test passes.

3. **REFACTOR** — The heading's container `<div className="flex items-center gap-2">` may need adjustment since it was flexed to align the arrow with the heading. Simplify to just `<h1>` if the flex wrapper is no longer needed.

**Notes:**
- Compare with other root pages (Home at `src/app/app/page.tsx:22`, Analyze at `src/app/app/analyze/page.tsx:25`, Quick Select at `src/app/app/quick-select/page.tsx:17`) — they all use `<h1 className="text-2xl font-bold">`.

---

### Task 3: Standardize tab/segmented-control border-radius

**Issue:** FOO-621
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests for the Quick Select tab buttons asserting they use `rounded-full` class (matching the dashboard shell pattern). Query for the tab buttons by their `aria-pressed` attribute or id (`tab-suggested`, `tab-recent`) and assert `.toHaveClass("rounded-full")`.
   - Run: `npm test -- quick-select`
   - Verify: Tests fail because buttons currently use `rounded-lg`.

2. **GREEN** — In `quick-select.tsx`, change the tab buttons' className from `rounded-lg` to `rounded-full` (lines 295, 308). Also wrap the tab bar in a container matching the dashboard shell pattern: `<div className="flex gap-1 p-1 bg-muted rounded-full">` instead of the current `<div className="flex gap-2">`.
   - Run: `npm test -- quick-select`
   - Verify: Tests pass.

3. **REFACTOR** — Verify the inactive tab styling matches dashboard-shell's pattern. Dashboard shell uses `text-muted-foreground hover:text-foreground` for inactive state vs quick-select which uses `bg-muted text-muted-foreground`. With the new `p-1 bg-muted rounded-full` wrapper, the inactive tab should NOT have its own `bg-muted` (the container provides it). Update inactive tab styling to match: remove `bg-muted` from inactive state, add `hover:text-foreground`.

**Notes:**
- Reference: `src/components/dashboard-shell.tsx:16-41` for the target segmented control pattern.
- The active state uses `bg-primary text-primary-foreground` in both components — this is already consistent.
- Add `px-4 py-2` to the tab buttons to match dashboard-shell sizing (currently the tabs only have `min-h-[44px]` for touch target).

---

### Task 4: Normalize home page action card visual weight

**Issue:** FOO-622
**Files:**
- `src/app/app/page.tsx` (modify)

**TDD Steps:**

1. **RED** — This is a styling-only change on a Server Component. The existing page uses consistent Link elements but with different padding/icon classes. Since this is purely visual, write a test (or update existing if present) that verifies all three action cards use the same structural classes. The test approach: render the page, query by link href, and assert consistent class patterns on the icon elements.
   - However, since `app/page.tsx` is a Server Component with async getSession(), testing it directly requires mocking. Instead, verify via the component structure.
   - This task can rely on visual verification + existing E2E screenshots.

2. **GREEN** — Unify all three action cards to the same padding and icon size. Make the Chat card match the primary cards: change `p-3` to `p-4` and `h-6 w-6` to `h-8 w-8`. Since Chat is full-width (not in the grid), give it `flex-row` layout (horizontal icon + text) instead of `flex-col` to differentiate it visually while keeping consistent sizing. This provides intentional hierarchy: primary actions (grid, vertical, prominent) vs secondary action (full-width, horizontal, inline).
   - Update at `src/app/app/page.tsx:43-49`: change padding to `p-4`, icon to `h-8 w-8`.

3. **REFACTOR** — Ensure the Chat card's horizontal layout feels balanced. It should have the same `shadow-sm` and `rounded-xl border bg-card` pattern.

**Notes:**
- The current layout: 2-column grid for Take Photo + Quick Select, then full-width Chat below. Keep this structure — it already provides hierarchy.
- The fix normalizes icon/padding sizes while the layout (grid vs full-width) provides the visual distinction.

---

### Task 5: Improve Analyze Food button enabled state contrast

**Issue:** FOO-640
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add a test that verifies the Analyze Food button has `data-variant="default"` when enabled (it should already have this since the Button component sets it). Also add a test that the button does NOT have any additional opacity class when enabled. The real fix is visual — ensure the button renders with the primary variant styling.
   - Run: `npm test -- food-analyzer`
   - Verify: Test may already pass for variant check.

2. **GREEN** — The button at line 636-642 already uses the default variant. The issue is that the default variant's visual weight relies on the `bg-primary` color, and `disabled:opacity-50` is the only distinction. To make the enabled state more prominent and the disabled state more clearly inactive, add explicit `data-variant="default"` attribute and add a subtle shadow class (e.g., `shadow-sm`) to the enabled button to make it pop. The disabled state inherits `disabled:opacity-50` from the base button styles, which combined with no shadow gives good distinction.
   - Modify the Button at line 636: add `shadow-sm` to the className — `className="w-full min-h-[44px] shadow-sm"`.
   - Also ensure `data-variant="default"` is set (the Button component does this automatically, no change needed).

3. **REFACTOR** — Verify the button looks consistent with other primary action buttons (e.g., "Log to Fitbit" in quick-select.tsx at line 260-266). If "Log to Fitbit" doesn't have shadow-sm, add it there too for consistency.

**Notes:**
- The core issue is that `disabled:opacity-50` on a dark button makes it look gray, and without additional visual cues (shadow, etc.) the enabled/disabled states are hard to distinguish on mobile.
- A `shadow-sm` addition gives the enabled button slight elevation, making it feel more interactive.
- Also check if there's a `data-variant` attribute being used in tests — the Button component already outputs this.

---

### Task 6: Make Lumen goals button full-width secondary

**Issue:** FOO-638
**Files:**
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add a test querying the "Update Lumen goals" button and asserting it has `w-full` class. Currently the button is centered in a `flex flex-col items-center` container and has `size="sm"`.
   - Run: `npm test -- daily-dashboard`
   - Verify: Test fails because button lacks `w-full`.

2. **GREEN** — In `daily-dashboard.tsx` at lines 279-297:
   - Change the container from `<div className="flex flex-col items-center gap-2">` to `<div className="flex flex-col gap-2">` (remove centering).
   - Change the button: remove `size="sm"`, add `w-full` to className, keep `variant="secondary"`.
   - Result: `<Button variant="secondary" onClick={handleUpdateLumenGoals} disabled={isUploadingLumen} className="w-full min-h-[44px]">`.
   - Run: `npm test -- daily-dashboard`
   - Verify: Test passes.

3. **REFACTOR** — Verify the error message `{lumenUploadError && ...}` still renders correctly without the centering container.

**Notes:**
- Reference other secondary/outline full-width buttons: "Reconnect Fitbit" in settings at `settings-content.tsx:150` uses `variant="outline" className="w-full"`.
- The button should be outlined or secondary, full-width, matching the app's action button hierarchy.

---

### Task 7: Improve food history layout and macro readability

**Issue:** FOO-628
**Files:**
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests for the improved layout:
   - Test that the food name does NOT have the `truncate` class (allowing it to wrap).
   - Test that the date header renders calories and macros in a readable format — instead of the dense `P:30.0g C:45.0g F:12.0g` format, use a more spaced format like `P: 30g · C: 45g · F: 12g` or render macros on a separate line.
   - Run: `npm test -- food-history`
   - Verify: Tests fail.

2. **GREEN** — In `food-history.tsx`:

   **Food entry row (lines 328-341):**
   - Remove `truncate` class from the food name `<p>` at line 330. Allow the name to wrap naturally to a second line. Keep `font-medium` on the name.
   - Move the calorie display to be on its own line or reduce its visual weight so it doesn't compress the name. Currently the right column (`shrink-0 ml-2`) takes horizontal space. Consider: keep the layout but remove `truncate` and let `min-w-0` handle natural wrapping.

   **Date header (lines 309-313):**
   - Break the dense macro summary into a more readable format. Instead of all on one line after the date, render:
     - Line 1: date heading + total calories (e.g., "Today" on left, "420 cal" on right)
     - Line 2: macros in a spaced, readable format below (e.g., "P: 30g · C: 45g · F: 12g" in `text-xs text-muted-foreground`)
   - This splits the dense single-line summary into a scannable two-line header.

   - Run: `npm test -- food-history`
   - Verify: Tests pass.

3. **REFACTOR** — Ensure the entry row layout handles long food names gracefully (e.g., "Grilled Chicken Breast with Vegetables and Rice" should wrap to 2 lines without breaking the calorie/macro column alignment). Round macro values to integers in the date header for cleaner display (use `Math.round()` instead of `.toFixed(1)`).

**Notes:**
- Currently: `{Math.round(group.totalCalories)} cal | P:{group.totalProteinG.toFixed(1)}g C:{group.totalCarbsG.toFixed(1)}g F:{group.totalFatG.toFixed(1)}g`
- Target: split into two lines — calories on the header line, macros below.
- For the entry rows: macros at `text-xs` on the right side are fine, just ensure the food name can wrap.

---

### Task 8: Standardize food detail heading pattern

**Issue:** FOO-632
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify)

**TDD Steps:**

1. **RED** — When a food is selected in Quick Select (detail/confirm view), the component should render the food name as a heading element. Add a test that when a food is selected, an `<h2>` with the food name is rendered. Currently the food name only appears inside the NutritionFactsCard.
   - Run: `npm test -- quick-select`
   - Verify: Test fails because no heading with the food name exists in the detail view.

2. **GREEN** — In `quick-select.tsx`, in the detail/confirm view (lines 208-268):
   - After the "Back" button and before the NutritionFactsCard, add a heading with the food name: `<h2 className="text-2xl font-bold">{selectedFood.foodName}</h2>`.
   - This matches the food-detail component pattern at `food-detail.tsx:99` which uses `<h1 className="text-2xl font-bold">{data.foodName}</h1>`.
   - Use `<h2>` because the page's `<h1>` is "Quick Select" (from `quick-select/page.tsx:17`). In food-detail, the food name is `<h1>` because there's no other heading on the page.
   - Run: `npm test -- quick-select`
   - Verify: Test passes.

3. **REFACTOR** — Verify the heading spacing works well with the NutritionFactsCard below it. The `space-y-4` on the parent div should provide adequate spacing.

**Notes:**
- The goal is NOT to make both views identical — Quick Select detail is a pre-log confirmation (with meal selector + Log button), while Food Detail is a historical view. The heading pattern should be consistent though: food name visible as a heading in both contexts.
- Keep the "Back" ghost button pattern consistent across both views (both already use `<Button variant="ghost">` with `<ArrowLeft>`).

---

### Task 9: Integration & Verification

**Issues:** FOO-621, FOO-622, FOO-628, FOO-629, FOO-632, FOO-635, FOO-638, FOO-640
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification checklist:
   - [ ] Settings page has no back arrow, heading matches other root pages
   - [ ] Quick Select tabs use rounded-full pill style matching Dashboard Daily/Weekly toggle
   - [ ] Home page action cards have consistent icon sizes and padding
   - [ ] Analyze Food button is visually prominent when enabled, clearly dimmed when disabled
   - [ ] Update Lumen goals button is full-width secondary style
   - [ ] Food history: food names wrap instead of truncating, date header has readable macro layout
   - [ ] Quick Select detail view shows food name as heading above nutrition card
   - [ ] Success screen after logging food does NOT show a Log ID

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

No new error handling is needed — all tasks are UI styling/layout changes to existing components.

## Risks & Open Questions

- [ ] **Quick Select tab wrapper change (Task 3):** Adding the `p-1 bg-muted rounded-full` wrapper changes the visual appearance significantly. Verify the active/inactive contrast works well in both light and dark modes.
- [ ] **Food name wrapping (Task 7):** Removing `truncate` allows long food names to wrap. Verify this doesn't break the row layout when names are 3+ lines long.
- [ ] **Chat card layout change (Task 4):** Switching to horizontal layout changes the card's feel. Verify it still looks intentional on mobile widths.

## Scope Boundaries

**In Scope:**
- UI consistency fixes across 8 components
- Test updates for changed behavior
- Visual hierarchy improvements

**Out of Scope:**
- No new features or functionality
- No API changes
- No database changes
- No routing changes

---

## Iteration 1

**Implemented:** 2026-02-19
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Remove Log ID from confirmation screen - Removed fitbitLogId display block, updated test (worker-1)
- Task 2: Remove back arrow from Settings page - Removed ArrowLeft/Link/Button, simplified heading, updated tests (worker-1)
- Task 3: Standardize tab/segmented-control border-radius - Changed to rounded-full pill style matching dashboard-shell, updated tab container and inactive styling (worker-2)
- Task 4: Normalize home page action card visual weight - Unified Chat card padding/icon size to match primary cards (worker-1)
- Task 5: Improve Analyze Food button enabled state contrast - Added shadow-sm to enabled button (worker-3)
- Task 6: Make Lumen goals button full-width secondary - Removed centering, removed size="sm", added w-full (worker-3)
- Task 7: Improve food history layout and macro readability - Split date header into two lines (calories + macros with · separators), removed truncate from food names, rounded macros to integers (worker-3)
- Task 8: Standardize food detail heading pattern - Added h2 food name heading in Quick Select detail view (worker-2)

### Files Modified
- `src/components/food-log-confirmation.tsx` - Removed Log ID display
- `src/components/__tests__/food-log-confirmation.test.tsx` - Updated test to assert Log ID not shown
- `src/components/settings-content.tsx` - Removed back arrow, simplified heading
- `src/components/__tests__/settings-content.test.tsx` - Updated test to assert no back arrow
- `src/app/settings/__tests__/page.test.tsx` - Updated page-level test for back arrow removal
- `src/app/app/page.tsx` - Unified Chat card padding/icon sizes
- `src/components/quick-select.tsx` - Rounded-full tabs, food name heading in detail view
- `src/components/__tests__/quick-select.test.tsx` - Updated tab tests, added heading test
- `src/components/food-analyzer.tsx` - Added shadow-sm to Analyze button
- `src/components/__tests__/food-analyzer.test.tsx` - Added shadow-sm assertion
- `src/components/daily-dashboard.tsx` - Full-width Lumen goals button
- `src/components/__tests__/daily-dashboard.test.tsx` - Added w-full assertion
- `src/components/food-history.tsx` - Two-line date header, removed truncate
- `src/components/__tests__/food-history.test.tsx` - Updated macro format tests, added layout tests

### Linear Updates
- FOO-621: Todo → In Progress → Review
- FOO-622: Todo → In Progress → Review
- FOO-628: Todo → In Progress → Review
- FOO-629: Todo → In Progress → Review
- FOO-632: Todo → In Progress → Review
- FOO-635: Todo → In Progress → Review
- FOO-638: Todo → In Progress → Review
- FOO-640: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 issues (stray blank line, fragile test assertion, vacuous test query), all fixed
- verifier: All 2041 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 1, 2, 4 (isolated changes — confirmation, settings, home page)
- Worker 2: Tasks 3, 8 (Quick Select domain — tabs, heading)
- Worker 3: Tasks 5, 6, 7 (dashboard/analyzer — button styling, food history layout)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: merged cleanly (no conflicts), typecheck passed
- Worker 3: merged cleanly (no conflicts), typecheck passed
- Post-merge: 2 test failures in page-level settings test (still expected removed back arrow), fixed

### Review Findings

Summary: 5 issue(s) found (Team: security, reliability, quality reviewers)
- FIX: 5 issue(s) — Linear issues created
- DISCARDED: 4 finding(s) — false positives / not applicable

**Issues requiring fix:**
- [MEDIUM] BUG: Optimistic update fires success side-effects (vibrateSuccess, invalidateFoodCaches) before API confirms (`src/components/food-analyzer.tsx:318-323, 396-401`) — FOO-661
- [MEDIUM] TIMEOUT: Lumen goals upload fetch has no timeout — UI can get permanently stuck (`src/components/daily-dashboard.tsx:133-136`) — FOO-662
- [MEDIUM] ASYNC: Race condition between Load More and Jump to Date — stale data appended to fresh results (`src/components/food-history.tsx:161-170, 217-222`) — FOO-663
- [MEDIUM] BUG: SWR error state not handled in quick-select and settings-content — silent failures (`src/components/quick-select.tsx:90-93`, `src/components/settings-content.tsx:34-41`) — FOO-664
- [LOW] EDGE CASE: Missing test for dryRun confirmation path (`src/components/__tests__/food-log-confirmation.test.tsx`) — FOO-665

**Discarded findings (not bugs):**
- [DISCARDED] CONVENTION: Button styling tests nested inside wrong describe block in food-log-confirmation test — style-only, zero correctness impact
- [DISCARDED] CONVENTION: Hardcoded inline Tailwind instead of Button asChild in daily-dashboard empty state CTAs — style preference, not enforced by CLAUDE.md
- [DISCARDED] CONVENTION: SessionInfo/CredentialsInfo interfaces defined locally in settings-content.tsx instead of src/types/ — structural improvement, not causing drift now
- [DISCARDED] TYPE: `as { ... }` type assertions on safeResponseJson results without full runtime validation — code checks .success field before accessing typed properties, providing adequate runtime guard

### Linear Updates
- FOO-621: Review → Merge
- FOO-622: Review → Merge
- FOO-628: Review → Merge
- FOO-629: Review → Merge
- FOO-632: Review → Merge
- FOO-635: Review → Merge
- FOO-638: Review → Merge
- FOO-640: Review → Merge
- FOO-661: Created in Todo (Fix: optimistic update side-effects)
- FOO-662: Created in Todo (Fix: missing timeout on Lumen upload)
- FOO-663: Created in Todo (Fix: race condition Load More vs Jump to Date)
- FOO-664: Created in Todo (Fix: SWR error handling)
- FOO-665: Created in Todo (Fix: missing dryRun test)

<!-- REVIEW COMPLETE -->

### Continuation Status
Fix Plan created — more implementation needed.

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [FOO-661](https://linear.app/lw-claude/issue/FOO-661), [FOO-662](https://linear.app/lw-claude/issue/FOO-662), [FOO-663](https://linear.app/lw-claude/issue/FOO-663), [FOO-664](https://linear.app/lw-claude/issue/FOO-664), [FOO-665](https://linear.app/lw-claude/issue/FOO-665)

### Fix 1: Remove optimistic update pattern in food-analyzer
**Linear Issue:** [FOO-661](https://linear.app/lw-claude/issue/FOO-661)

1. Write test in `src/components/__tests__/food-analyzer.test.tsx` verifying that `vibrateSuccess` is NOT called before the API response resolves
2. Remove optimistic `setLogResponse(...)` before `fetch()` in `handleLogToFitbit` (line 318-323) — only set after API confirms success
3. Apply same fix to `handleUseExisting` (line 396-401)
4. Follow QuickSelect's pattern: "Only set response after API confirms success"

### Fix 2: Add timeout to Lumen goals upload
**Linear Issue:** [FOO-662](https://linear.app/lw-claude/issue/FOO-662)

1. Write test in `src/components/__tests__/daily-dashboard.test.tsx` verifying fetch is called with `AbortSignal.timeout(15000)`
2. Add `signal: AbortSignal.timeout(15000)` to the fetch call at `daily-dashboard.tsx:133-136`
3. Handle AbortError in catch block with user-friendly timeout message

### Fix 3: Add request cancellation to food history
**Linear Issue:** [FOO-663](https://linear.app/lw-claude/issue/FOO-663)

1. Write test in `src/components/__tests__/food-history.test.tsx` for concurrent Load More + Jump to Date — verify stale Load More result is discarded
2. Add `useRef<AbortController>` to manage in-flight requests in `food-history.tsx`
3. In `fetchEntries`, abort previous controller before creating new one
4. Pass `controller.signal` to fetch calls
5. In catch block, skip error handling for `AbortError` (intentional cancellation)

### Fix 4: Handle SWR error state in quick-select and settings-content
**Linear Issue:** [FOO-664](https://linear.app/lw-claude/issue/FOO-664)

1. Write tests in `src/components/__tests__/quick-select.test.tsx` and `src/components/__tests__/settings-content.test.tsx` verifying error message renders when SWR returns an error
2. In `quick-select.tsx:90-93`: destructure `error` from `useSWR`, render error message in search results area
3. In `settings-content.tsx:34-41`: destructure `error` from `useSWR`, render error message with retry option in credentials section

### Fix 5: Add dryRun test for food-log-confirmation
**Linear Issue:** [FOO-665](https://linear.app/lw-claude/issue/FOO-665)

1. Add test case in `src/components/__tests__/food-log-confirmation.test.tsx` with `dryRun: true` in response prop
2. Assert "Saved locally (Fitbit API skipped)" text is rendered
3. Assert success vibration and cache invalidation still fire (dryRun is still a successful save)

---

## Iteration 2

**Implemented:** 2026-02-19
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Fix 1: Remove optimistic update pattern in food-analyzer - Removed optimistic `setLogResponse` from `handleLogToFitbit` and `handleUseExisting`, only set after API confirms success (worker-1)
- Fix 2: Add timeout to Lumen goals upload - Added `AbortSignal.timeout(15000)` to fetch call, handle timeout error with user-friendly message (worker-2)
- Fix 3: Add request cancellation to food history - Added `useRef<AbortController>` with abort-on-new-request, manual timeout pattern (iOS 16 compat), guarded `finally` block to prevent loading state race (worker-2)
- Fix 4: Handle SWR error state in quick-select and settings-content - Destructured `error` from `useSWR`, added `role="alert"` error displays with retry option in credentials section (worker-3)
- Fix 5: Add dryRun test for food-log-confirmation - Added 3 tests covering dryRun text, vibration, and cache invalidation (worker-1)

### Files Modified
- `src/components/food-analyzer.tsx` - Removed 2 optimistic update blocks
- `src/components/__tests__/food-analyzer.test.tsx` - Updated tests for non-optimistic flow
- `src/components/__tests__/food-log-confirmation.test.tsx` - Added 3 dryRun tests
- `src/components/daily-dashboard.tsx` - Added AbortSignal.timeout to Lumen upload fetch
- `src/components/__tests__/daily-dashboard.test.tsx` - Added 2 timeout tests
- `src/components/food-history.tsx` - Added AbortController with manual timeout, guarded finally block
- `src/components/__tests__/food-history.test.tsx` - Added 2 abort/cancellation tests
- `src/components/quick-select.tsx` - Added SWR error destructuring and error display
- `src/components/__tests__/quick-select.test.tsx` - Added 2 SWR error tests
- `src/components/settings-content.tsx` - Added credentials SWR error display with retry
- `src/components/__tests__/settings-content.test.tsx` - Added 3 SWR error tests
- `src/app/settings/__tests__/page.test.tsx` - Fixed 3 tests for multiple error elements (post-merge)

### Linear Updates
- FOO-661: Todo → In Progress → Review
- FOO-662: Todo → In Progress → Review
- FOO-663: Todo → In Progress → Review
- FOO-664: Todo → In Progress → Review
- FOO-665: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 real bugs (AbortSignal.any() compat regression, loading state race condition), both fixed before proceeding. 1 false positive (SWR error propagation — apiFetcher already propagates correctly).
- verifier: All 2053 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Fix 1, Fix 5 (food-analyzer + food-log-confirmation)
- Worker 2: Fix 2, Fix 3 (daily-dashboard + food-history)
- Worker 3: Fix 4 (quick-select + settings-content)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: merged cleanly, typecheck passed
- Worker 3: merged cleanly, typecheck passed
- Post-merge: 3 test failures in page-level settings test (duplicate error text from dual SWR error handling), fixed with getAllByText
- Post-bug-hunter: Replaced AbortSignal.any() with manual timeout pattern (iOS 16 compat), added guarded finally block to prevent loading state race

### Review Findings

Summary: 3 issue(s) found, fixed inline (Team: security, reliability, quality reviewers)
- FIXED INLINE: 3 issue(s) — verified via TDD + bug-hunter

**Issues fixed inline:**
- [MEDIUM] RESOURCE: Missing unmount cleanup for abortControllerRef — in-flight requests continue after navigation away (`src/components/food-history.tsx:85`) — added useEffect cleanup + test — FOO-666
- [MEDIUM] TIMEOUT: PATCH requests in settings credentials have no timeout — UI stuck on "saving" indefinitely (`src/components/settings-content.tsx:66,90`) — added AbortSignal.timeout(15000) + TimeoutError handling + tests — FOO-667
- [LOW] ASYNC: TimeoutError not distinguished from generic errors in log/delete handlers — user sees raw "signal timed out" string (`src/components/quick-select.tsx:186`, `src/components/food-history.tsx:223`) — added DOMException name check for user-friendly message + tests — FOO-668

**Discarded findings (not bugs):**
- [DISCARDED] SECURITY: API error messages rendered in UI — React JSX escapes content (no XSS), API layer sanitizes errors
- [DISCARDED] SECURITY: No CSRF token on Fitbit reconnect forms — SameSite=Lax cookie policy mitigates CSRF
- [DISCARDED] TYPE: Type assertion precision in quick-select FoodLogResponse — access guarded by !response.ok check, no runtime impact
- [DISCARDED] TYPE: FoodChat mock omits optional initialMealTypeId prop — test quality concern, no production impact

### Linear Updates
- FOO-661: Review → Merge
- FOO-662: Review → Merge
- FOO-663: Review → Merge
- FOO-664: Review → Merge
- FOO-665: Review → Merge
- FOO-666: Created in Merge (Fix: missing unmount cleanup — fixed inline)
- FOO-667: Created in Merge (Fix: missing timeout on credentials PATCH — fixed inline)
- FOO-668: Created in Merge (Fix: TimeoutError shows raw browser string — fixed inline)

### Inline Fix Verification
- Unit tests: all 2058 pass
- Bug-hunter: no new issues in the fixes (4 findings about pre-existing code, not introduced by inline changes)

<!-- REVIEW COMPLETE -->

### Continuation Status
All tasks completed — all iterations reviewed, no Fix Plan needed.

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
