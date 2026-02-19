# Implementation Plan

**Status:** IN_PROGRESS
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
