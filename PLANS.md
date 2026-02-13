# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-349-ui-polish-and-theme
**Issues:** FOO-349, FOO-348, FOO-350, FOO-351, FOO-352, FOO-353, FOO-356, FOO-357, FOO-358
**Created:** 2026-02-13
**Last Updated:** 2026-02-13

## Summary

Batch of UI polish, accessibility fixes, a visual bug fix, and theme variable consolidation. Replaces hardcoded Tailwind colors (green-500, amber-500, blue-500, etc.) with semantic CSS variables, fixes accessibility gaps (label associations, skip links, visible labels), improves empty states, fixes a chart overflow bug, and tidies up minor UI issues.

## Issues

### FOO-349: Replace hardcoded Tailwind colors with theme variables

**Priority:** High
**Labels:** Improvement
**Description:** Multiple components use hardcoded Tailwind color utilities instead of theme CSS variables, creating visual inconsistency especially in dark mode. Affected files: `src/lib/confidence.ts`, `src/components/confidence-badge.tsx`, `src/components/macro-bars.tsx`, `src/components/weekly-nutrition-chart.tsx`, `src/components/fasting-card.tsx`, `src/components/calorie-ring.tsx`, `src/components/food-log-confirmation.tsx`, `src/components/lumen-banner.tsx`, `src/components/fitbit-status-banner.tsx`, `src/components/settings-content.tsx`.

**Acceptance Criteria:**
- [ ] No hardcoded Tailwind color utilities (green-500, amber-500, blue-500, red-500, yellow-500, etc.) in component files
- [ ] New semantic color variables defined in globals.css for both light and dark themes
- [ ] All affected components use theme variables instead of hardcoded colors
- [ ] Visual appearance consistent in both light and dark mode

### FOO-348: Weekly chart goal marker overflows when goal exceeds max actual value

**Priority:** Low
**Labels:** Bug
**Description:** The weekly nutrition chart's goal dashed line positions above the visible chart area when `goal > maxValue`. `maxValue` (line 66-74) only considers actual data, not goals. `goalHeightPercent` can exceed 100%.

**Acceptance Criteria:**
- [ ] Goal marker stays within the chart area when goal exceeds max actual value
- [ ] maxValue calculation includes goal values for the selected metric
- [ ] Works for all four metrics (calories, protein, carbs, fat)

### FOO-350: Add label association to settings page input fields

**Priority:** Medium
**Labels:** Bug
**Description:** Fitbit Client ID and Client Secret inputs in settings are missing `htmlFor`/`id` pairing.

**Acceptance Criteria:**
- [ ] Client ID input has `id="fitbit-client-id"` and label has `htmlFor="fitbit-client-id"`
- [ ] Client Secret input has `id="fitbit-client-secret"` and label has `htmlFor="fitbit-client-secret"`
- [ ] Clicking label text focuses the corresponding input

### FOO-351: Add skip link and main landmark to food-detail page

**Priority:** Medium
**Labels:** Bug
**Description:** The food-detail page is missing SkipLink and `<main>` landmark, unlike all other app pages.

**Acceptance Criteria:**
- [ ] SkipLink component rendered on food-detail page
- [ ] Content wrapped in `<main id="main-content">` landmark
- [ ] Pattern matches other app pages (e.g. `src/app/app/page.tsx`)

### FOO-352: Add space between nutrition values and units in analysis result

**Priority:** Medium
**Labels:** Improvement
**Description:** `NutritionItem` renders `{value}{unit}` on separate lines in JSX, but adjacent JSX expressions produce no whitespace — displays as "450kcal" not "450 kcal".

**Acceptance Criteria:**
- [ ] Nutrition values display with a space before the unit (e.g. "450 kcal", "25 g")
- [ ] Applies to all nutrition metrics in the analysis result component

### FOO-353: Replace generic empty states with actionable guidance

**Priority:** Medium
**Labels:** Improvement
**Description:** Fasting card (lines 76, 120) shows "No data" and daily dashboard (line 264) shows "No food logged" without guidance.

**Acceptance Criteria:**
- [ ] Fasting card empty state includes actionable message guiding user to log a meal
- [ ] Daily dashboard empty state includes actionable message guiding user to log food
- [ ] Messages are friendly and specific

### FOO-356: Remove redundant aria-label from theme toggle buttons

**Priority:** Low
**Labels:** Improvement
**Description:** Theme toggle buttons have visible text ("Light", "Dark", "System") and redundant `aria-label` attributes with identical values.

**Acceptance Criteria:**
- [ ] Theme toggle buttons have no aria-label attribute
- [ ] Buttons still have visible text labels
- [ ] Accessible name derived from visible text content

### FOO-357: Add visible label to food description textarea

**Priority:** Low
**Labels:** Bug
**Description:** Food description textarea uses only `aria-label` without a visible label. Placeholder disappears on typing.

**Acceptance Criteria:**
- [ ] Visible label displayed above the textarea
- [ ] Label associated via htmlFor/id
- [ ] Label indicates the field is optional

### FOO-358: Update PWA manifest theme_color to match app theme

**Priority:** Low
**Labels:** Improvement
**Description:** PWA manifest uses `#000000` as theme_color. The app's light mode background is `oklch(1 0 0)` which is `#ffffff`.

**Acceptance Criteria:**
- [ ] manifest.json theme_color matches the app's light mode background color
- [ ] No jarring color flash when launching as PWA

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] All tests passing before starting

## Implementation Tasks

### Task 1: Define semantic CSS color variables in globals.css

**Issue:** FOO-349
**Files:**
- `src/app/globals.css` (modify)

**TDD Steps:**

1. **RED** — Write test in a new file `src/app/__tests__/globals-theme.test.ts` that loads `globals.css` as text and asserts the presence of `--success`, `--warning`, and `--info` CSS custom properties in both `:root` and `.dark` selectors, and their corresponding `--color-*` mappings in `@theme inline`.
   - Run: `npm test -- globals-theme`
   - Verify: Test fails (variables don't exist yet)

2. **GREEN** — Add semantic color variables to `globals.css`:
   - In `@theme inline`: add `--color-success`, `--color-success-foreground`, `--color-warning`, `--color-warning-foreground`, `--color-info`, `--color-info-foreground` mappings (same pattern as existing `--color-destructive`)
   - In `:root`: define oklch values for success (green), warning (amber), info (blue) — match the visual appearance of the current hardcoded Tailwind colors (green-500, amber-500, blue-500)
   - In `.dark`: define dark-mode oklch values — match current dark mode appearance where components already specify `dark:` variants (e.g., `dark:text-green-400` suggests a lighter green in dark mode)
   - Run: `npm test -- globals-theme`
   - Verify: Test passes

**Notes:**
- Follow the existing pattern: `--color-destructive: var(--destructive)` in `@theme inline`, then `--destructive: oklch(...)` in `:root`/`.dark`
- This produces Tailwind utilities: `bg-success`, `text-success`, `border-success`, `bg-warning`, `text-warning`, `border-warning`, `bg-info`, `text-info`, `border-info`, plus foreground variants
- The banner components (lumen-banner, fitbit-status-banner) use tinted backgrounds — these can use opacity modifiers like `bg-warning/10` or `bg-info/10` instead of dedicated variables

---

### Task 2: Fix settings page accessibility and replace hardcoded colors

**Issue:** FOO-350, FOO-356, FOO-349
**Files:**
- `src/components/settings-content.tsx` (modify)
- `src/components/__tests__/settings-content.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests to `settings-content.test.tsx`:
   - Test that Client ID label has `htmlFor="fitbit-client-id"` and input has matching `id` (FOO-350). This requires the SWR mock to return credentials data (`hasCredentials: true, clientId: "test-id"`) so the credential fields render.
   - Test that Client Secret label has `htmlFor="fitbit-client-secret"` and input has matching `id` (FOO-350). Same SWR mock prerequisite.
   - Test that theme toggle buttons do NOT have aria-label attributes (FOO-356). Existing SWR mock (null data) is sufficient since theme section always renders.
   - Run: `npm test -- settings-content`
   - Verify: Tests fail

2. **GREEN** — Modify `settings-content.tsx`:
   - Add `htmlFor="fitbit-client-id"` to Client ID label (line 186), add `id="fitbit-client-id"` to Client ID Input (line 189)
   - Add `htmlFor="fitbit-client-secret"` to Client Secret label (line 231), add `id="fitbit-client-secret"` to Client Secret Input (line 234)
   - Remove `aria-label="Light"` (line 292), `aria-label="Dark"` (line 302), `aria-label="System"` (line 312)
   - Replace hardcoded Fitbit status colors: `text-amber-600 dark:text-amber-400` → `text-warning` and `text-green-600 dark:text-green-400` → `text-success` (lines 134, 141)
   - Run: `npm test -- settings-content`
   - Verify: Tests pass

**Notes:**
- Reference `src/components/fitbit-setup-form.tsx` for existing htmlFor/id pattern if one exists
- The SWR mock needs a second setup for the credentials endpoint — check existing test patterns for multi-endpoint SWR mocking

---

### Task 3: Add space between nutrition values and units

**Issue:** FOO-352
**Files:**
- `src/components/analysis-result.tsx` (modify)
- `src/components/__tests__/analysis-result.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update existing test assertions in `analysis-result.test.tsx`:
   - Change `"12g"` → `"12 g"`, `"28g"` → `"28 g"`, `"18g"` → `"18 g"`, `"2g"` → `"2 g"`, `"450mg"` → `"450 mg"` (lines 58-62)
   - Also update the `"320kcal"` assertion if one exists (search for `kcal` in test)
   - Run: `npm test -- analysis-result`
   - Verify: Tests fail (still rendering without space)

2. **GREEN** — Modify the `NutritionItem` component in `analysis-result.tsx`:
   - In the span at line 108-111, ensure a space character exists between `{value}` and `{unit}` — use a template literal or explicit `{" "}` JSX expression
   - Run: `npm test -- analysis-result`
   - Verify: Tests pass

**Notes:**
- The existing rendering at lines 108-111 has `{value}` and `{unit}` on separate lines but JSX collapses the whitespace between adjacent expressions, resulting in "450kcal"
- A simple fix: `{value} {unit}` on a single line, or `{value}{" "}{unit}`

---

### Task 4: Add visible label to food description textarea

**Issue:** FOO-357
**Files:**
- `src/components/description-input.tsx` (modify)
- `src/components/__tests__/description-input.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests to `description-input.test.tsx`:
   - Test that a visible label with text containing "Food description" is rendered
   - Test that the label has `htmlFor="food-description"` and textarea has `id="food-description"`
   - Test that the label text includes "(optional)" to indicate the field is not required
   - Run: `npm test -- description-input`
   - Verify: Tests fail

2. **GREEN** — Modify `description-input.tsx`:
   - Import `Label` from `@/components/ui/label`
   - Add a `<Label htmlFor="food-description">` above the textarea with text like "Food description (optional)"
   - Add `id="food-description"` to the textarea element
   - Remove the now-redundant `aria-label="Food description"` since the visible label provides the accessible name
   - Run: `npm test -- description-input`
   - Verify: Tests pass

**Notes:**
- Existing test at line 12 checks for `aria-label="Food description"` via `getByRole("textbox")` — this still works since the label association provides the accessible name, but verify
- Follow the shadcn/ui `Label` component pattern (already used elsewhere in the project)

---

### Task 5: Add skip link and main landmark to food-detail page

**Issue:** FOO-351
**Files:**
- `src/app/app/food-detail/[id]/page.tsx` (modify)
- `src/app/app/food-detail/[id]/__tests__/page.test.tsx` (create)

**TDD Steps:**

1. **RED** — Create test file `src/app/app/food-detail/[id]/__tests__/page.test.tsx`:
   - Mock `@/lib/session` to return a valid session
   - Mock `@/components/food-detail` with a stub component
   - Test that SkipLink is rendered with `href="#main-content"`
   - Test that a `<main>` element exists with `id="main-content"`
   - Run: `npm test -- food-detail.*page`
   - Verify: Tests fail
   - Reference: `src/app/settings/__tests__/page.test.tsx` for server component testing pattern (or `src/components/__tests__/settings-content.test.tsx` for the SkipLink assertions)

2. **GREEN** — Modify `src/app/app/food-detail/[id]/page.tsx`:
   - Import `SkipLink` from `@/components/skip-link`
   - Add `<SkipLink />` before the main content
   - Wrap `<FoodDetail>` in `<main id="main-content">` with appropriate layout classes
   - Follow the exact pattern from `src/app/app/page.tsx` (lines 18-47): outer div with padding, SkipLink, main with id and max-width
   - Run: `npm test -- food-detail.*page`
   - Verify: Tests pass

**Notes:**
- The page is a server component — the SkipLink is a client component, but that's fine (server components can render client components)
- Match the layout pattern from `src/app/app/page.tsx`: `<div className="min-h-screen px-4 py-6">` → `<SkipLink />` → `<main id="main-content" className="mx-auto w-full max-w-md">`

---

### Task 6: Replace empty states with actionable guidance and replace hardcoded colors

**Issue:** FOO-353, FOO-349
**Files:**
- `src/components/fasting-card.tsx` (modify)
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/fasting-card.test.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update test assertions:
   - In `fasting-card.test.tsx`: Change `screen.getByText("No data")` → assert for new actionable message (e.g., text containing "log" or "meal"). There are two "No data" states: line 76 (no window data) and line 120 (ongoing fast without live mode).
   - In `daily-dashboard.test.tsx`: Find the assertion for "No food logged" and update to the new actionable message
   - Run: `npm test -- fasting-card`
   - Verify: Tests fail

2. **GREEN** — Modify components:
   - In `fasting-card.tsx` line 76: Replace "No data" with an actionable message like "Log a meal to start tracking your fasting window"
   - In `fasting-card.tsx` line 120: Replace "No data" with a similar actionable message (this is the "ongoing fast, not today" state — message should be contextually appropriate)
   - In `daily-dashboard.tsx` line 264: Replace "No food logged" with an actionable message like "Log your first meal to see your daily nutrition"
   - In `fasting-card.tsx` line 91: Replace `bg-green-500` with `bg-success` on the live fasting dot
   - In `daily-dashboard.tsx`: No hardcoded colors to replace (it uses theme vars already)
   - Run: `npm test -- fasting-card && npm test -- daily-dashboard`
   - Verify: Tests pass

**Notes:**
- The fasting card has two distinct empty states — make sure messages are different and contextually appropriate
- The daily-dashboard empty state at line 263-265 is in a `py-8 text-center` container — keep the same layout structure

---

### Task 7: Fix chart goal marker overflow and replace hardcoded colors

**Issue:** FOO-348, FOO-349
**Files:**
- `src/components/weekly-nutrition-chart.tsx` (modify)
- `src/components/__tests__/weekly-nutrition-chart.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test for goal overflow scenario in `weekly-nutrition-chart.test.tsx`:
   - Create test data where goal significantly exceeds actual values (e.g., calorieGoal=2000, actual calories=500)
   - Assert that the goal marker's `bottom` style is capped at or below 100%
   - Also update any existing test assertions that check for specific color classes (e.g., `bg-green-500` → `bg-success`, `bg-amber-500` → `bg-warning`)
   - Run: `npm test -- weekly-nutrition-chart`
   - Verify: Tests fail

2. **GREEN** — Modify `weekly-nutrition-chart.tsx`:
   - In the `maxValue` calculation (lines 66-74): include goal values for the currently selected metric alongside actual data values, so the chart scales to show both bars and goal markers
   - Implementation hint from the issue: `Math.max(...values, ...goals, 1)` — extract goal values from `weekDays` that have goals for the selected metric
   - Replace `bg-green-500` (line 142) → `bg-success`
   - Replace `bg-amber-500` (line 142) → `bg-warning`
   - Replace `text-amber-500` (line 181) → `text-warning`
   - Replace `text-green-600` (line 182) → `text-success`
   - Run: `npm test -- weekly-nutrition-chart`
   - Verify: Tests pass

**Notes:**
- When `maxValue` includes goals, bars will be shorter proportionally (since the scale is larger), but the goal markers will always be visible — this is the correct behavior
- The net surplus/deficit text at lines 178-193 uses hardcoded colors for positive/negative — replace those too

---

### Task 8: Update PWA manifest theme_color

**Issue:** FOO-358
**Files:**
- `public/manifest.json` (modify)
- `src/app/__tests__/manifest.test.ts` (modify if exists, or create)

**TDD Steps:**

1. **RED** — Add/update test in `src/app/__tests__/manifest.test.ts`:
   - Read `public/manifest.json` and assert `theme_color` is `#ffffff` (matching the light mode background)
   - Run: `npm test -- manifest`
   - Verify: Test fails (currently `#000000`)

2. **GREEN** — Modify `public/manifest.json`:
   - Change `"theme_color": "#000000"` to `"theme_color": "#ffffff"`
   - This matches the `:root` background `oklch(1 0 0)` which is pure white
   - Run: `npm test -- manifest`
   - Verify: Test passes

**Notes:**
- `#ffffff` is the standard hex equivalent of `oklch(1 0 0)` (pure white)
- The `background_color` is already `#ffffff` — making `theme_color` match ensures consistent PWA launch experience

---

### Task 9: Replace hardcoded colors in remaining components

**Issue:** FOO-349
**Files:**
- `src/lib/confidence.ts` (modify)
- `src/components/confidence-badge.tsx` (modify)
- `src/components/macro-bars.tsx` (modify)
- `src/components/calorie-ring.tsx` (modify)
- `src/components/food-log-confirmation.tsx` (modify)
- `src/components/lumen-banner.tsx` (modify)
- `src/components/fitbit-status-banner.tsx` (modify)
- `src/components/__tests__/confidence-badge.test.tsx` (modify)
- `src/components/__tests__/macro-bars.test.tsx` (modify)
- `src/components/__tests__/calorie-ring.test.tsx` (modify)
- `src/components/__tests__/food-log-confirmation.test.tsx` (modify)
- `src/components/__tests__/lumen-banner.test.tsx` (modify)
- `src/components/__tests__/fitbit-status-banner.test.tsx` (modify)

**Depends on:** Task 1 (semantic CSS variables must exist in globals.css)

**TDD Steps:**

1. **RED** — Update test assertions across all affected test files. For each component, find assertions or snapshots that reference hardcoded color classes and update them to the new semantic classes. Key replacements:
   - `bg-green-500` → `bg-success`
   - `bg-yellow-500` → `bg-warning` (confidence medium)
   - `bg-red-500` → `bg-destructive` (already exists in theme)
   - `text-green-500` → `text-success`
   - `text-yellow-500` → `text-warning`
   - `text-red-500` → `text-destructive`
   - `bg-blue-500` → `bg-info`
   - `bg-amber-500` → `bg-warning`
   - `text-amber-500` → `text-warning`
   - `text-amber-600 dark:text-amber-500` → `text-warning`
   - Banner patterns: `border-amber-500 bg-amber-50 dark:bg-amber-950/20` → `border-warning bg-warning/10`
   - Banner patterns: `border-blue-500 bg-blue-50 dark:bg-blue-950/20` → `border-info bg-info/10`
   - Banner text: `text-amber-900 dark:text-amber-100` → `text-warning-foreground` (or similar, depending on Task 1's variable structure)
   - Banner text: `text-blue-900 dark:text-blue-100` → `text-info-foreground`
   - Run: `npm test -- confidence-badge macro-bars calorie-ring food-log-confirmation lumen-banner fitbit-status-banner`
   - Verify: Tests fail

2. **GREEN** — Replace hardcoded colors in each component:
   - `confidence.ts`: Replace color constants map values
   - `confidence-badge.tsx`: Replace text color classes for icons
   - `macro-bars.tsx`: Replace bar color classes (protein=info, carbs=success, fat=warning)
   - `calorie-ring.tsx`: Replace budget marker color (`text-amber-500` → `text-warning`)
   - `food-log-confirmation.tsx`: Replace success icon color (`text-green-500` → `text-success`)
   - `lumen-banner.tsx`: Replace all blue-* classes with info semantic classes
   - `fitbit-status-banner.tsx`: Replace all amber-* classes with warning semantic classes
   - Run tests for each file
   - Verify: All pass

3. **REFACTOR** — Verify no hardcoded Tailwind color utilities remain:
   - Search the entire `src/` directory for patterns: `green-500`, `amber-500`, `blue-500`, `red-500`, `yellow-500`, `green-600`, `green-400`, `amber-600`, `amber-400`, `blue-600`, `amber-50`, `amber-950`, `blue-50`, `blue-950`
   - Any remaining instances should be addressed (might be in files not listed in the issue)

**Notes:**
- This is the largest task — touches 7 source files and 6 test files
- The banner components (lumen-banner, fitbit-status-banner) have the most complex color patterns with border, background, icon, title, and subtitle colors all specified
- For banners, the `bg-amber-50 dark:bg-amber-950/20` pattern can become `bg-warning/10` if the CSS variable approach supports opacity modifiers — otherwise define `--warning-bg` / `--info-bg` variables in Task 1
- `bg-red-500` maps to `bg-destructive` which already exists in the theme — no new variable needed

---

### Task 10: Integration & Verification

**Issue:** FOO-349, FOO-348, FOO-350, FOO-351, FOO-352, FOO-353, FOO-356, FOO-357, FOO-358
**Files:** All files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification:
   - [ ] Settings page: clicking "Client ID" label focuses the input
   - [ ] Settings page: theme buttons have no aria-label in DOM
   - [ ] Settings page: Fitbit status colors use theme variables
   - [ ] Food detail page: SkipLink is present, main landmark wraps content
   - [ ] Analysis result: "450 kcal", "25 g" (with spaces)
   - [ ] Description input: visible "Food description (optional)" label above textarea
   - [ ] Fasting card: actionable empty state messages
   - [ ] Daily dashboard: actionable empty state when no food logged
   - [ ] Weekly chart: goal marker doesn't overflow when goal >> actual values
   - [ ] PWA manifest: theme_color is #ffffff
   - [ ] All components: no hardcoded green-500, amber-500, blue-500, etc.
   - [ ] Dark mode: verify all replaced colors look correct

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Missing CSS variables | Components fall back to browser defaults | CSS variable test (Task 1) |
| Label association broken | Form still works, just no click-to-focus | Unit tests (Tasks 2, 4) |
| Goal value is null | Chart ignores null goals in maxValue | Unit test (Task 7) |

## Risks & Open Questions

- [ ] Tailwind v4 opacity modifier syntax (`bg-warning/10`) must be verified — may need fallback if oklch colors don't compose well with opacity modifiers. If not supported, define dedicated `--warning-bg` and `--info-bg` variables for banner tinted backgrounds.
- [ ] The exact oklch values for semantic colors should visually match the current hardcoded Tailwind palette. Cross-reference Tailwind's default palette oklch values when defining variables.
- [ ] Banner components have many color touchpoints (6+ per component) — verify the new semantic classes produce acceptable contrast ratios in both themes.

## Scope Boundaries

**In Scope:**
- Semantic CSS color variables in globals.css
- Color class replacements in all affected components
- Label/id associations for settings inputs
- SkipLink + main landmark for food-detail page
- Visible label for food description textarea
- Space between value and unit in NutritionItem
- Actionable empty state messages
- Chart goal marker overflow fix
- PWA manifest theme_color update
- All associated test updates

**Out of Scope:**
- FOO-355 (Canceled — CLS risk doesn't exist, `unoptimized` required for blob URLs)
- Redesigning the color palette or changing visual appearance
- Adding dark mode support where it doesn't exist yet
- Refactoring banner component structure
- Adding new components or pages

---

## Iteration 1

**Implemented:** 2026-02-13
**Method:** Agent team (4 workers)

### Tasks Completed This Iteration
- Task 1: Define semantic CSS color variables in globals.css (FOO-349) - Added success, warning, info variables with @theme inline mappings and :root/.dark oklch values (worker-1)
- Task 2: Fix settings page accessibility and replace hardcoded colors (FOO-350, FOO-356, FOO-349) - Added htmlFor/id label associations, removed redundant aria-labels, replaced hardcoded colors (worker-2)
- Task 3: Add space between nutrition values and units (FOO-352) - Modified NutritionItem to render "450 kcal" instead of "450kcal" (worker-2)
- Task 4: Add visible label to food description textarea (FOO-357) - Added Label component with htmlFor/id association (worker-2)
- Task 5: Add skip link and main landmark to food-detail page (FOO-351) - Added SkipLink and main landmark matching other app pages (worker-3)
- Task 6: Replace empty states with actionable guidance and replace hardcoded colors (FOO-353, FOO-349) - Updated empty states with actionable messages, replaced bg-green-500 with bg-success (worker-3)
- Task 7: Fix chart goal marker overflow and replace hardcoded colors (FOO-348, FOO-349) - Fixed maxValue to include goals, replaced hardcoded colors with semantic classes (worker-4)
- Task 8: Update PWA manifest theme_color (FOO-358) - Changed #000000 to #ffffff (worker-4)
- Task 9: Replace hardcoded colors in remaining components (FOO-349) - Replaced all hardcoded Tailwind colors across 7 components with semantic theme classes (worker-1)
- Task 10: Integration & Verification - Lead verified all changes, fixed lint warning and bug-hunter findings

### Files Modified
- `src/app/globals.css` - Added semantic color variables (success, warning, info) with light/dark mode
- `src/app/__tests__/globals-theme.test.ts` - Created CSS theme variable tests
- `src/components/settings-content.tsx` - Label associations, removed aria-labels, semantic colors
- `src/components/__tests__/settings-content.test.tsx` - Added accessibility tests
- `src/components/analysis-result.tsx` - Added space between value and unit
- `src/components/__tests__/analysis-result.test.tsx` - Updated spacing and color assertions
- `src/components/description-input.tsx` - Added visible Label component
- `src/components/__tests__/description-input.test.tsx` - Added label tests
- `src/app/app/food-detail/[id]/page.tsx` - Added SkipLink and main landmark
- `src/app/app/food-detail/[id]/__tests__/page.test.tsx` - Created page tests
- `src/components/fasting-card.tsx` - Actionable empty states, bg-success
- `src/components/__tests__/fasting-card.test.tsx` - Updated empty state assertions
- `src/components/daily-dashboard.tsx` - Actionable empty state
- `src/components/__tests__/daily-dashboard.test.tsx` - Updated empty state assertions
- `src/components/weekly-nutrition-chart.tsx` - Goal overflow fix, semantic colors
- `src/components/__tests__/weekly-nutrition-chart.test.tsx` - Goal overflow test, color assertions
- `public/manifest.json` - theme_color #000000 → #ffffff
- `src/app/__tests__/manifest.test.ts` - Updated theme_color assertion
- `src/lib/confidence.ts` - Semantic color classes
- `src/lib/__tests__/confidence.test.ts` - Updated color assertions
- `src/components/confidence-badge.tsx` - Semantic color classes
- `src/components/__tests__/confidence-badge.test.tsx` - Updated color assertions
- `src/components/macro-bars.tsx` - Semantic color classes (info, success, warning)
- `src/components/__tests__/macro-bars.test.tsx` - Updated color assertions
- `src/components/calorie-ring.tsx` - text-warning
- `src/components/__tests__/calorie-ring.test.tsx` - Updated color assertions
- `src/components/food-log-confirmation.tsx` - text-success
- `src/components/__tests__/food-log-confirmation.test.tsx` - Updated color assertions
- `src/components/lumen-banner.tsx` - info semantic classes
- `src/components/__tests__/lumen-banner.test.tsx` - Updated color assertions
- `src/components/fitbit-status-banner.tsx` - warning semantic classes
- `src/components/__tests__/fitbit-status-banner.test.tsx` - Updated color assertions

### Linear Updates
- FOO-349: Todo → In Progress → Review
- FOO-348: Todo → In Progress → Review
- FOO-350: Todo → In Progress → Review
- FOO-351: Todo → In Progress → Review
- FOO-352: Todo → In Progress → Review
- FOO-353: Todo → In Progress → Review
- FOO-356: Todo → In Progress → Review
- FOO-357: Todo → In Progress → Review
- FOO-358: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 high (missing SkipLink mock) + 1 medium (fasting empty state wording), fixed before proceeding
- verifier: All 1570 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 1, 9 (CSS theme variables + color replacements in 7 components)
- Worker 2: Tasks 2, 3, 4 (settings accessibility, nutrition spacing, description label)
- Worker 3: Tasks 5, 6 (food-detail landmarks, empty states)
- Worker 4: Tasks 7, 8 (chart overflow fix, PWA manifest)

### Continuation Status
All tasks completed.
