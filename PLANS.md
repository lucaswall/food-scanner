# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-479-frontend-polish-and-a11y
**Issues:** FOO-479, FOO-480, FOO-481, FOO-482, FOO-484, FOO-485, FOO-486, FOO-489, FOO-491, FOO-492, FOO-495
**Created:** 2026-02-15
**Last Updated:** 2026-02-15

## Summary

Frontend polish and accessibility improvements across the app. Covers ARIA attribute gaps in tab patterns, semantic HTML fixes, touch target compliance, PWA dark mode support, visual consistency for spinners and error states, and UX improvements for empty states and the refine chat layout.

## Issues

### FOO-479: Add aria-controls to tab pattern implementations

**Priority:** High
**Labels:** Bug
**Description:** Tab implementations in QuickSelect, DashboardShell, and WeeklyNutritionChart are missing `aria-controls` attributes linking tab buttons to their associated panels.

**Acceptance Criteria:**
- [ ] Tab buttons have `aria-controls` pointing to their panel's `id`
- [ ] Tab panels have corresponding `id` attributes
- [ ] Screen readers can navigate between tabs and their associated panels

### FOO-480: Replace LumenBanner clickable Alert with proper button

**Priority:** High
**Labels:** Bug
**Description:** LumenBanner uses an `<Alert>` div with `onClick` handler instead of a proper `<button>` element, violating WCAG 2.1.1 (Keyboard). Not focusable or keyboard-accessible.

**Acceptance Criteria:**
- [ ] LumenBanner uses a `<button>` element (or wraps clickable area in one)
- [ ] Keyboard-accessible (focusable, activatable with Enter/Space)
- [ ] Visual styling preserved (info banner appearance)
- [ ] Hidden file input in `daily-dashboard.tsx` also has aria-label

### FOO-481: Support dark mode in PWA theme_color

**Priority:** High
**Labels:** Improvement
**Description:** PWA manifest hardcodes `theme_color: "#ffffff"` and layout.tsx has `themeColor: "#000000"`. Neither responds to the user's color scheme preference. Dark mode users see a mismatched status bar.

**Acceptance Criteria:**
- [ ] Dual `<meta name="theme-color">` tags with `media="(prefers-color-scheme: ...)"` queries
- [ ] Light mode gets white/light theme color, dark mode gets dark theme color
- [ ] Manifest `theme_color` stays as-is (manifest doesn't support media queries)

### FOO-482: Increase Input component height to 44px touch target

**Priority:** High
**Labels:** Bug
**Description:** Base Input component uses `h-9` (36px), below the project's 44px minimum touch target policy. Some consumers override with `min-h-[44px]` but the base should be correct.

**Acceptance Criteria:**
- [ ] Input base height changed from `h-9` to `h-11` (44px)
- [ ] Remove redundant `min-h-[44px]` overrides from consumers where appropriate
- [ ] Visual regression check — inputs don't look broken in any context

### FOO-484: Add landscape safe area insets to bottom navigation

**Priority:** Medium
**Labels:** Improvement
**Description:** Bottom navigation handles bottom safe area inset but not left/right insets for landscape orientation on devices with notches.

**Acceptance Criteria:**
- [ ] Nav container includes `pl-[env(safe-area-inset-left)]` and `pr-[env(safe-area-inset-right)]`
- [ ] Navigation items not obscured in landscape on notched devices

### FOO-485: Standardize loading spinner sizes across components

**Priority:** Medium
**Labels:** Convention
**Description:** Loading spinners use inconsistent sizes and border widths. Current state: full-page spinners use w-8 h-8 border-4 (mostly consistent), but inline/card spinners mix w-6 h-6 border-4 and w-6 h-6 border-2.

**Acceptance Criteria:**
- [ ] All spinners follow a consistent size hierarchy:
  - Full-page/section loading: w-8 h-8 border-4
  - Inline/card loading: w-6 h-6 border-2
  - Button loading: uses Lucide `<Loader2>` (already consistent)
- [ ] All custom spinner instances updated

### FOO-486: Make error recovery buttons visually prominent

**Priority:** Medium
**Labels:** Improvement
**Description:** Error state retry buttons use `variant="outline"` making them visually subordinate when they should be the primary action.

**Acceptance Criteria:**
- [ ] `analysis-result.tsx` retry button uses `variant="default"`
- [ ] `daily-dashboard.tsx` retry button uses `variant="default"`
- [ ] Recovery buttons are visually prominent as primary actions

### FOO-489: Fix weekly chart current-day column rendering

**Priority:** Medium
**Labels:** Bug
**Description:** The weekly chart doesn't visually distinguish the current day from other days. When today has data but no goal, it uses `bg-primary` while goal-tracked days use `bg-success`/`bg-warning`, creating a visually jarring inconsistency. Also, today's bar may be shorter (incomplete day) without any visual cue that it's in-progress.

**Acceptance Criteria:**
- [ ] Current day column has a subtle visual indicator (e.g., dot below day label, slightly different opacity, or border)
- [ ] The "today" indicator is clear but not overwhelming
- [ ] Chart remains clean and readable

### FOO-491: Improve dashboard empty state guidance

**Priority:** Low
**Labels:** Improvement
**Description:** Empty state says "Log your first meal to see your daily nutrition" but doesn't tell the user how or where to log food.

**Acceptance Criteria:**
- [ ] Empty state includes actionable guidance (e.g., links/buttons to Analyze or Quick Select)
- [ ] CTA is visually clear and tappable (44px touch target)
- [ ] Empty state text is more descriptive

### FOO-492: Remove unnecessary 'use client' from SkipLink

**Priority:** Low
**Labels:** Performance
**Description:** SkipLink component has `'use client'` but only renders a static `<a>` tag with no hooks, event handlers, or browser APIs.

**Acceptance Criteria:**
- [ ] `'use client'` directive removed from SkipLink
- [ ] SkipLink renders as a Server Component
- [ ] Skip link functionality still works correctly

### FOO-495: Improve refine chat top bar layout

**Priority:** Low
**Labels:** Improvement
**Description:** The refine chat top bar has three competing elements: Back button, MealType dropdown, and "Log to Fitbit" button, creating visual tension in a compact header.

**Acceptance Criteria:**
- [ ] MealType dropdown moved below the navigation row (Back + Log to Fitbit)
- [ ] Top bar feels less crowded
- [ ] All touch targets maintain 44px minimum

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] Dependencies up to date (`npm install`)

## Implementation Tasks

### Task 1: Remove 'use client' from SkipLink

**Issue:** FOO-492
**Files:**
- `src/components/skip-link.tsx` (modify)

**TDD Steps:**

1. **RED** — Write a test that imports SkipLink and verifies it renders correctly without client-side features. Create `src/components/__tests__/skip-link.test.tsx`. Test that the component renders an `<a>` tag with the correct href and text. Run: `npm test -- skip-link`

2. **GREEN** — Remove `'use client'` from `src/components/skip-link.tsx`. Run: `npm test -- skip-link`. Verify test passes.

3. **REFACTOR** — No refactoring needed.

**Notes:**
- Simplest task, no dependencies. Good starting point.

### Task 2: Increase Input component height to 44px

**Issue:** FOO-482
**Files:**
- `src/components/ui/input.tsx` (modify)
- `src/components/food-chat.tsx` (modify — remove redundant `min-h-[44px]`)
- `src/components/quick-select.tsx` (modify — remove redundant `min-h-[44px]` from search input)

**TDD Steps:**

1. **RED** — Write a test in `src/components/__tests__/input.test.tsx` that renders the Input component and asserts it has the `h-11` class. Run: `npm test -- input.test`

2. **GREEN** — In `src/components/ui/input.tsx`, change `h-9` to `h-11` in the className string. Run: `npm test -- input.test`. Verify test passes.

3. **REFACTOR** — Search for `min-h-[44px]` on Input consumers. Remove redundant `min-h-[44px]` from:
   - `food-chat.tsx` line 600: Input already has className override `min-h-[44px] rounded-full` — the `min-h-[44px]` is now redundant since base is `h-11` (44px), but keep it since the consumer also sets `rounded-full`; just remove the `min-h-[44px]` part
   - `quick-select.tsx` line 408: Same — remove `min-h-[44px]` from the search input className

**Notes:**
- `h-11` = 44px in Tailwind default spacing. Matches the project's touch target policy.
- Other inputs that explicitly set `min-h-[44px]` are now redundant but harmless.

### Task 3: Make error recovery buttons visually prominent

**Issue:** FOO-486
**Files:**
- `src/components/analysis-result.tsx` (modify)
- `src/components/daily-dashboard.tsx` (modify)

**TDD Steps:**

1. **RED** — In `src/components/__tests__/analysis-result.test.tsx`, write a test that renders the error state and asserts the retry button does NOT have the `outline` variant class pattern. Run: `npm test -- analysis-result`

2. **GREEN** — In `analysis-result.tsx` line 49, change `variant="outline"` to remove the variant prop entirely (default is already "default"). In `daily-dashboard.tsx` line 169, change `variant="outline"` to remove or set `variant="default"`. Run: `npm test -- analysis-result`

3. **REFACTOR** — Verify both buttons look correct by checking their className patterns include the default button styles.

**Notes:**
- The `<Button>` default variant is "default" — removing the prop achieves the desired result.
- The daily-dashboard retry button also has `size="sm"` — keep that, only change variant.

### Task 4: Add landscape safe area insets to bottom navigation

**Issue:** FOO-484
**Files:**
- `src/components/bottom-nav.tsx` (modify)

**TDD Steps:**

1. **RED** — In `src/components/__tests__/bottom-nav.test.tsx`, write a test that renders BottomNav and checks the `<nav>` element's className includes safe area inset classes for left and right. Run: `npm test -- bottom-nav`

2. **GREEN** — In `bottom-nav.tsx` line 45, add `pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]` to the `<nav>` className. Run: `npm test -- bottom-nav`

3. **REFACTOR** — No refactoring needed.

**Notes:**
- Follow existing pattern for bottom inset: `pb-[env(safe-area-inset-bottom)]`.

### Task 5: Standardize loading spinner sizes

**Issue:** FOO-485
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/photo-capture.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests in `src/components/__tests__/quick-select.test.tsx` that render the resubmitting spinner state and the infinite scroll spinner, checking for consistent sizing classes. Run: `npm test -- quick-select`

2. **GREEN** — Update spinner sizes:
   - `quick-select.tsx` line 266: Keep `w-8 h-8 border-4` (full-page resubmitting spinner — correct)
   - `quick-select.tsx` line 471: Change from `w-6 h-6 border-4` to `w-6 h-6 border-2` (inline loading-more spinner)
   - `photo-capture.tsx` line 315: Already `w-6 h-6 border-2` (inline processing spinner — correct)
   - `analysis-result.tsx` line 32: Already `w-8 h-8 border-4` (full-page loading — correct)
   - `food-analyzer.tsx` line 439: Already `w-8 h-8 border-4` (full-page resubmitting — correct)
   Run: `npm test -- quick-select`

3. **REFACTOR** — Verify all spinners match the hierarchy: full-page = w-8/border-4, inline = w-6/border-2.

**Notes:**
- Only one spinner actually needs changing: `quick-select.tsx` line 471's border width from 4 to 2.
- Pattern: `<Loader2>` from lucide-react is used for button-level spinners and is already consistent.

### Task 6: Add aria-controls to tab pattern implementations

**Issue:** FOO-479
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/dashboard-shell.tsx` (modify)
- `src/components/weekly-nutrition-chart.tsx` (modify)

**TDD Steps:**

1. **RED** — In `src/components/__tests__/dashboard-shell.test.tsx`, write a test that renders DashboardShell, clicks each tab, and verifies:
   - Each tab button has `aria-controls` pointing to a panel id
   - The tab panel has a matching `id`
   Run: `npm test -- dashboard-shell`

2. **GREEN** — Update each component:
   - **DashboardShell:** Add `aria-controls="panel-daily"` / `aria-controls="panel-weekly"` to tab buttons. Add `id="panel-daily"` / `id="panel-weekly"` to the conditional render wrapper (wrap in a div if needed).
   - **QuickSelect:** Tab buttons already have `id="tab-suggested"` / `id="tab-recent"`. Add `aria-controls="panel-suggested"` / `aria-controls="panel-recent"`. Add `id="panel-suggested"` / `id="panel-recent"` to the tabpanel div (line 399 already has `role="tabpanel"`).
   - **WeeklyNutritionChart:** Metric tabs. Add `aria-controls="panel-metric"` to each tab button. Add `id="panel-metric"` to the chart container div. Since there's only one panel that changes content, a single panel id suffices.
   Run: `npm test -- dashboard-shell`

3. **REFACTOR** — Write tests for QuickSelect and WeeklyNutritionChart tab patterns as well. Run: `npm test -- quick-select weekly-nutrition`

**Notes:**
- Reference ARIA Authoring Practices for tab pattern: tabs need `aria-controls`, panels need `id` and `role="tabpanel"`.
- QuickSelect already has `role="tabpanel"` and `aria-labelledby` on the panel — just needs `id`.
- DashboardShell doesn't wrap content in a panel div — the conditional render needs a wrapper with `role="tabpanel"`.

### Task 7: Replace LumenBanner clickable Alert with proper button

**Issue:** FOO-480
**Files:**
- `src/components/lumen-banner.tsx` (modify)
- `src/components/__tests__/lumen-banner.test.tsx` (modify if exists, create if not)

**TDD Steps:**

1. **RED** — Write a test that renders LumenBanner in the upload-prompt state (no goals) and asserts:
   - A `<button>` element exists (not a div with onClick)
   - The button is focusable and has an accessible name
   - Clicking the button triggers the file input
   Run: `npm test -- lumen-banner`

2. **GREEN** — Restructure LumenBanner:
   - Replace the `<Alert onClick={handleBannerClick}>` with a `<button>` element styled to look like the current Alert banner. Keep the info banner visual appearance using the same Tailwind classes.
   - The button should contain the Upload/Loader2 icon and the description text.
   - Add `aria-label="Upload Lumen screenshot to set today's macro goals"` to the button.
   - Keep the hidden file input as-is.
   Run: `npm test -- lumen-banner`

3. **REFACTOR** — Ensure the button's visual styling matches the original Alert appearance. Verify keyboard navigation works.

**Notes:**
- The current code uses `<Alert>` with `cursor-pointer` and `onClick`. Replace with `<button>` that has the same visual classes.
- The hidden file input in `daily-dashboard.tsx` (line 283-289) is triggered by a proper `<Button>` component — no fix needed there.

### Task 8: Support dark mode in PWA theme_color

**Issue:** FOO-481
**Files:**
- `src/app/layout.tsx` (modify)

**TDD Steps:**

1. **RED** — In `src/app/__tests__/layout.test.tsx` (or appropriate test location), write a test that renders the layout metadata and checks for theme-color meta tags with media queries. This may require testing the exported `viewport` config object. Run: `npm test -- layout`

2. **GREEN** — In `layout.tsx`, change the `viewport` export to use an array of theme colors:
   ```
   export const viewport: Viewport = {
     themeColor: [
       { media: "(prefers-color-scheme: light)", color: "#ffffff" },
       { media: "(prefers-color-scheme: dark)", color: "#09090b" },
     ],
   };
   ```
   The dark color `#09090b` matches shadcn's dark background `hsl(0, 0%, 3.9%)`.
   Run: `npm test -- layout`

3. **REFACTOR** — Verify the manifest.json `theme_color` stays as `#ffffff` (manifest doesn't support media queries — it uses the light value as default). No change needed there.

**Notes:**
- Next.js `Viewport.themeColor` supports array format with `media` property.
- The dark background color should match the app's actual dark mode background from the CSS theme variables.
- Reference: `src/app/globals.css` for the exact dark theme background color.

### Task 9: Fix weekly chart current-day column rendering

**Issue:** FOO-489
**Files:**
- `src/components/weekly-nutrition-chart.tsx` (modify)
- `src/lib/date-utils.ts` (read — for `getTodayDate` import)

**TDD Steps:**

1. **RED** — In `src/components/__tests__/weekly-nutrition-chart.test.tsx`, write a test that renders the chart with today's date included in the week data and verifies the current-day bar has a distinct visual indicator (e.g., a "today" dot or border). Run: `npm test -- weekly-nutrition-chart`

2. **GREEN** — Modify the chart rendering:
   - Import `getTodayDate` from `@/lib/date-utils`
   - Compare each day's date with today
   - For the current day's column, add a small visual indicator: a filled dot below the day label (e.g., a 6px rounded-full div in `bg-primary`) to mark "today"
   - This is a subtle indicator that doesn't change the bar styling
   Run: `npm test -- weekly-nutrition-chart`

3. **REFACTOR** — Ensure the indicator works in both light and dark mode.

**Notes:**
- Keep the existing bar color logic unchanged (success/warning/primary based on goal).
- A small dot under the day label is a common pattern (Apple Calendar uses this). It's non-intrusive.
- `getTodayDate()` returns the local date string in `YYYY-MM-DD` format.

### Task 10: Improve dashboard empty state guidance

**Issue:** FOO-491
**Files:**
- `src/components/daily-dashboard.tsx` (modify)

**TDD Steps:**

1. **RED** — In `src/components/__tests__/daily-dashboard.test.tsx`, write a test that renders the dashboard with no meals and verifies:
   - A link/button to the Analyze page exists
   - A link/button to Quick Select exists
   - The text is more descriptive than the current message
   Run: `npm test -- daily-dashboard`

2. **GREEN** — Replace the empty state at line 254-257 with:
   - Updated text: "No meals logged yet"
   - Two CTA buttons (as `<Link>` components from next/link):
     - "Scan Food" linking to `/app/analyze` with a camera icon
     - "Quick Select" linking to `/app/quick-select` with a list icon
   - Both buttons should use `min-h-[44px]` touch targets
   Run: `npm test -- daily-dashboard`

3. **REFACTOR** — Ensure the empty state layout looks balanced and follows existing design patterns (centered text + button group).

**Notes:**
- Use `next/link` `<Link>` for client-side navigation.
- Follow existing button patterns in the app (variant="outline" or "secondary" for CTAs).
- Import `ScanEye` and `ListChecks` icons from lucide-react (already used in bottom-nav.tsx).

### Task 11: Improve refine chat top bar layout

**Issue:** FOO-495
**Files:**
- `src/components/food-chat.tsx` (modify)

**TDD Steps:**

1. **RED** — In `src/components/__tests__/food-chat.test.tsx`, write a test that renders FoodChat and verifies the MealTypeSelector is in a separate row below the Back + Log to Fitbit row. Run: `npm test -- food-chat`

2. **GREEN** — Restructure the top header (lines 369-402):
   - First row: Back button (left) + "Log to Fitbit" button (right) with flex justify-between
   - Second row: MealTypeSelector spanning full width, with a subtle separator or reduced padding
   - Keep the border-b and safe-area-inset-top handling
   Run: `npm test -- food-chat`

3. **REFACTOR** — Verify the layout works on narrow screens. The MealTypeSelector should have room to display the full meal type name without truncation.

**Notes:**
- The current layout puts three elements in one flex row. Moving MealTypeSelector to a second row gives the primary actions (Back, Log) more breathing room.
- Reference: `food-chat.tsx` lines 369-402 for current structure.
- `showTimeHint={false}` is already set on this MealTypeSelector usage — keep it.

### Task 12: Integration & Verification

**Issue:** FOO-479, FOO-480, FOO-481, FOO-482, FOO-484, FOO-485, FOO-486, FOO-489, FOO-491, FOO-492, FOO-495
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Visual verification checklist:
   - [ ] Input height looks correct across all forms
   - [ ] Tab navigation works with keyboard in QuickSelect, DashboardShell, WeeklyNutritionChart
   - [ ] LumenBanner is keyboard-accessible
   - [ ] Bottom nav has safe area padding in landscape
   - [ ] Spinners are consistently sized
   - [ ] Error retry buttons are visually prominent
   - [ ] Weekly chart has today indicator
   - [ ] Dashboard empty state has CTAs
   - [ ] Chat header layout is less crowded
   - [ ] Skip link works as Server Component

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| SkipLink without 'use client' breaks | Server Component renders `<a>` correctly | Unit test |
| Input height change breaks layouts | All inputs remain functional at 44px | Unit test + visual |
| Tab aria-controls mismatch | Tab-panel association works for screen readers | Unit test |
| LumenBanner button styling breaks | Button matches original Alert appearance | Unit test |

## Risks & Open Questions

- [ ] Risk: Changing Input height globally could affect tight layouts — mitigated by checking all Input consumers
- [ ] Risk: Chat header with two rows might feel too tall on small screens — keep padding minimal
- [ ] Question: Exact dark mode background color for theme-color meta tag — check `globals.css` for HSL value

## Scope Boundaries

**In Scope:**
- All 11 valid issues listed above
- Test coverage for all changes
- Visual consistency verification

**Out of Scope:**
- FOO-483 (hidden inputs don't need aria-labels — not in accessibility tree)
- FOO-487 (dark mode border contrast is ~13:1, well above WCAG 3:1)
- FOO-488 (`unoptimized` required for blob URLs — no server URL case exists)
- FOO-490 (MealTypeSelector consumers already have visible labels)
- FOO-493 (key pages don't have above-fold images — LCP is text/SVG)
- FOO-494 (analyze page layout flows naturally when instructions hide)
- Creating new shared spinner component (not needed — just standardize classes)
- Adding E2E tests for these changes (will be covered in plan-review-implementation)

---

## Iteration 1

**Implemented:** 2026-02-15
**Method:** Agent team (4 workers)

### Tasks Completed This Iteration
- Task 1: Remove 'use client' from SkipLink (FOO-492) - Removed unnecessary client directive (worker-3)
- Task 2: Increase Input component height to 44px (FOO-482) - Changed h-9 to h-11, removed redundant min-h overrides (worker-1)
- Task 3: Make error recovery buttons visually prominent (FOO-486) - Changed retry buttons from outline to default variant (worker-2)
- Task 4: Add landscape safe area insets to bottom navigation (FOO-484) - Added left/right safe area insets for landscape (worker-3)
- Task 5: Standardize loading spinner sizes (FOO-485) - Changed inline spinner border-4 to border-2 (worker-1)
- Task 6: Add aria-controls to tab pattern implementations (FOO-479) - Added aria-controls to DashboardShell, QuickSelect, WeeklyNutritionChart (worker-1)
- Task 7: Replace LumenBanner clickable Alert with proper button (FOO-480) - Converted Alert to semantic button with aria-label (worker-4)
- Task 8: Support dark mode in PWA theme_color (FOO-481) - Updated viewport.themeColor to media query array (worker-4)
- Task 9: Fix weekly chart current-day column rendering (FOO-489) - Added today indicator dot below current day label (worker-1)
- Task 10: Improve dashboard empty state guidance (FOO-491) - Added Scan Food and Quick Select CTA buttons (worker-2)
- Task 11: Improve refine chat top bar layout (FOO-495) - Restructured header to two-row layout (worker-1)

### Files Modified
- `src/components/skip-link.tsx` - Removed 'use client' directive
- `src/components/ui/input.tsx` - Changed height from h-9 to h-11
- `src/components/food-chat.tsx` - Two-row header layout, removed redundant min-h from Input
- `src/components/quick-select.tsx` - Spinner border fix, removed redundant min-h, added aria-controls
- `src/components/dashboard-shell.tsx` - Added aria-controls to tabs, wrapped panel in div with id
- `src/components/weekly-nutrition-chart.tsx` - Added aria-controls, chart panel id, today indicator
- `src/components/analysis-result.tsx` - Removed variant="outline" from error retry button
- `src/components/daily-dashboard.tsx` - Removed variant="outline" from retry button, added empty state CTAs
- `src/components/bottom-nav.tsx` - Added landscape safe area inset padding
- `src/components/lumen-banner.tsx` - Replaced Alert with semantic button element
- `src/app/layout.tsx` - Updated viewport.themeColor to array with media queries
- `src/components/__tests__/input.test.tsx` - Created test for Input height
- `src/components/__tests__/food-chat.test.tsx` - Added test for two-row layout
- `src/components/__tests__/quick-select.test.tsx` - Added tests for spinner sizing and aria-controls
- `src/components/__tests__/dashboard-shell.test.tsx` - Added test for aria-controls
- `src/components/__tests__/weekly-nutrition-chart.test.tsx` - Added tests for aria-controls and today indicator
- `src/components/__tests__/analysis-result.test.tsx` - Added test for default variant on retry button
- `src/components/__tests__/daily-dashboard.test.tsx` - Added tests for empty state CTAs
- `src/components/__tests__/bottom-nav.test.tsx` - Added test for landscape safe area insets
- `src/components/__tests__/lumen-banner.test.tsx` - Added accessibility test for button element
- `src/app/__tests__/layout.test.tsx` - Updated test for dark mode theme color

### Linear Updates
- FOO-479: Todo → In Progress → Review
- FOO-480: Todo → In Progress → Review
- FOO-481: Todo → In Progress → Review
- FOO-482: Todo → In Progress → Review
- FOO-484: Todo → In Progress → Review
- FOO-485: Todo → In Progress → Review
- FOO-486: Todo → In Progress → Review
- FOO-489: Todo → In Progress → Review
- FOO-491: Todo → In Progress → Review
- FOO-492: Todo → In Progress → Review
- FOO-495: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed — no bugs found
- verifier: All 1700 tests pass, zero warnings

### Work Partition
- Worker 1: Tasks 2, 5, 6, 9, 11 (input, quick-select, dashboard-shell, weekly-nutrition-chart, food-chat files)
- Worker 2: Tasks 3, 10 (analysis-result, daily-dashboard files)
- Worker 3: Tasks 1, 4 (skip-link, bottom-nav files)
- Worker 4: Tasks 7, 8 (lumen-banner, layout files)

### Continuation Status
All tasks completed.

### Review Findings

Summary: 1 issue found (Team: security, reliability, quality reviewers)
- FIX: 1 issue — Linear issue created
- DISCARDED: 2 findings — false positives / not applicable

**Issues requiring fix:**
- [MEDIUM] BUG: File input reset in `try` instead of `finally` (`src/components/lumen-banner.tsx:75-78`) - Prevents re-selection of same file on upload error. Inconsistent with correct pattern in `daily-dashboard.tsx:147-150`.

**Discarded findings (not bugs):**
- [DISCARDED] SECURITY: Unvalidated href prop in SkipLink (`src/components/skip-link.tsx:2`) — Impossible in context. Component only used in layout.tsx with default `#main-content`. No user input ever flows to this prop.
- [DISCARDED] CONVENTION: dangerouslySetInnerHTML in layout.tsx (`src/app/layout.tsx:70`) — Already an accepted pattern, documented with SECURITY comment. Used to prevent theme flash before hydration.

### Linear Updates
- FOO-479: Review → Merge
- FOO-480: Review → Merge
- FOO-481: Review → Merge
- FOO-482: Review → Merge
- FOO-484: Review → Merge
- FOO-485: Review → Merge
- FOO-486: Review → Merge
- FOO-489: Review → Merge
- FOO-491: Review → Merge
- FOO-492: Review → Merge
- FOO-495: Review → Merge
- FOO-496: Created in Todo (Fix: file input reset on upload error)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [FOO-496](https://linear.app/lw-claude/issue/FOO-496/fix-lumen-banner-file-input-reset-on-upload-error)

### Fix 1: File input reset on upload error
**Linear Issue:** [FOO-496](https://linear.app/lw-claude/issue/FOO-496/fix-lumen-banner-file-input-reset-on-upload-error)

1. Write test in `src/components/__tests__/lumen-banner.test.tsx` that simulates a failed upload and verifies `fileInputRef.current.value` is reset to `""` even on error
2. Move file input reset from `try` block (line 75-78) to `finally` block in `src/components/lumen-banner.tsx`, matching the pattern in `daily-dashboard.tsx:147-150`

---

## Iteration 2

**Implemented:** 2026-02-15
**Method:** Single-agent (1 fix task)

### Tasks Completed This Iteration
- Fix 1: File input reset on upload error (FOO-496) - Moved file input reset from `try` to `finally` block, added test for error-path reset

### Files Modified
- `src/components/lumen-banner.tsx` - Moved file input reset to `finally` block
- `src/components/__tests__/lumen-banner.test.tsx` - Added test "resets file input value even when upload fails"

### Linear Updates
- FOO-496: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed — no bugs found
- verifier: All 1701 tests pass, zero warnings

### Continuation Status
All tasks completed.
