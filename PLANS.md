# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-612-bugs-and-performance
**Issues:** FOO-612, FOO-613, FOO-614, FOO-615, FOO-617, FOO-620, FOO-623, FOO-624, FOO-626, FOO-630, FOO-636, FOO-637, FOO-646
**Created:** 2026-02-18
**Last Updated:** 2026-02-18

## Summary

Fix 8 bugs (mostly accessibility) and 5 performance issues across the app. All changes are surgical — most touch a single component file and its test. No schema changes, no API changes, no architectural rework.

## Issues

### FOO-612: Meal breakdown sections missing aria-expanded

**Priority:** Medium | **Labels:** Bug
**Description:** Expandable meal headers (Breakfast, Lunch, etc.) have no `aria-expanded` attribute. Screen readers cannot determine section state.

**Acceptance Criteria:**
- [ ] Each meal header button has `aria-expanded={isExpanded}`
- [ ] Test verifies aria-expanded toggles with expansion state

### FOO-613: Remove incorrect tablist ARIA roles from segmented controls

**Priority:** Medium | **Labels:** Bug
**Description:** Three components use `role="tablist"` + `role="tab"` but only have click handlers — no arrow key navigation. Per ARIA Authoring Practices, tablists require arrow key support. Without it, the roles are misleading.

**Components:** `dashboard-shell.tsx`, `quick-select.tsx`, `weekly-nutrition-chart.tsx`

**Acceptance Criteria:**
- [ ] `role="tablist"` removed from all three container divs
- [ ] `role="tab"` and `aria-selected` removed from all buttons within those containers
- [ ] `aria-controls` kept on buttons (still useful for associating panels)
- [ ] Tests updated to not query by role="tab"

### FOO-614: Data visualizations lack accessible representations

**Priority:** Medium | **Labels:** Bug
**Description:** Three visualization components convey info only visually:
1. Macro progress bars — plain divs, no `role="progressbar"` or ARIA values
2. Calorie ring SVG — not hidden from screen readers (reads as geometry noise)
3. Weekly nutrition chart — no accessible summary

**Acceptance Criteria:**
- [ ] Macro bars: inner div has `role="progressbar"`, `aria-valuenow`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-label` (e.g., "Protein: 30 / 50g")
- [ ] Calorie ring: SVG element has `aria-hidden="true"`. A visually-hidden text element provides the same info (e.g., "1200 of 2000 calories")
- [ ] Weekly chart: chart container div has `aria-label` describing content (e.g., "Weekly calories chart")

### FOO-615: Confidence badge produces garbled accessible name

**Priority:** Medium | **Labels:** Bug
**Description:** The badge button contains `<div aria-label="Confidence: high">` plus `<span>high</span>`, producing "Confidence: high high" for screen readers.

**Acceptance Criteria:**
- [ ] Remove `aria-label` from the inner `<div>` (the indicator dot)
- [ ] The button's accessible name is coherent (just the visible text)

### FOO-617: Hardcoded amber color bypasses design system and fails contrast

**Priority:** Medium | **Labels:** Bug
**Description:** Photo compression warning uses `text-amber-600 dark:text-amber-400` instead of semantic tokens. `text-amber-600` on white gives ~3.0:1 contrast, below WCAG AA minimum of 4.5:1.

**Acceptance Criteria:**
- [ ] Replace `text-amber-600 dark:text-amber-400` with `text-warning-foreground` or equivalent semantic token
- [ ] Contrast meets WCAG AA (4.5:1) in both light and dark modes

### FOO-620: Chat photo menu buttons below 44px touch target

**Priority:** Medium | **Labels:** Bug
**Description:** Camera and Gallery buttons use `min-h-[36px]`, 8px below the 44px minimum (WCAG 2.5.8).

**Acceptance Criteria:**
- [ ] Both buttons use `min-h-[44px]`
- [ ] Test verifies the min-height class

### FOO-623: react-markdown and remark-gfm statically bundled

**Priority:** Medium | **Labels:** Performance
**Description:** `react-markdown` and `remark-gfm` are statically imported in `chat-markdown.tsx`, adding ~100KB+ gzipped to every bundle containing `food-chat.tsx`. Markdown rendering is only needed after AI response arrives.

**Acceptance Criteria:**
- [ ] `ChatMarkdown` loaded via `next/dynamic` with `{ ssr: false }` from the consumer (food-chat.tsx)
- [ ] Chat rendering still works correctly after dynamic load
- [ ] A loading fallback is shown while the component loads

### FOO-624: Dashboard prefetch covers only 2 of 5+ required endpoints

**Priority:** Medium | **Labels:** Performance
**Description:** `DashboardPrefetch` only prefetches `common-foods` and `food-history`, but the daily dashboard immediately needs `nutrition-summary`, `nutrition-goals`, `lumen-goals`, and `earliest-entry`. Weekly dashboard needs `earliest-entry`, `nutrition-range`, and `fasting`.

**Acceptance Criteria:**
- [ ] Prefetch includes all endpoints the daily dashboard fetches on initial render (using today's date)
- [ ] Prefetch includes key weekly dashboard endpoints
- [ ] Uses `getTodayDate()` to build date-specific keys matching what the dashboard components will request

### FOO-626: Dashboard shell tab switch missing useTransition

**Priority:** Low | **Labels:** Performance
**Description:** Switching between Daily/Weekly views triggers synchronous rendering. On lower-end devices this may block input beyond 200ms.

**Acceptance Criteria:**
- [ ] `setView` wrapped in `useTransition` (or `startTransition` from React)
- [ ] Optional: show pending state indicator while transitioning

### FOO-630: Dark mode refine-chat error banner has insufficient contrast

**Priority:** Medium | **Labels:** Bug
**Description:** Error banner in food-chat uses `bg-destructive/10` background + `text-destructive` text. In dark mode the 10% opacity destructive background blends too much with the dark page background, reducing legibility.

**Acceptance Criteria:**
- [ ] Error banner text is legible in both light and dark modes
- [ ] Use higher opacity or different approach for dark mode (e.g., `dark:bg-destructive/20`)

### FOO-636: PWA manifest improvements — theme_color and maskable icons

**Priority:** Low | **Labels:** Performance
**Description:** `theme_color: "#ffffff"` is hardcoded white — dark mode users see white browser chrome. No maskable icon entry for Android adaptive launchers.

**Acceptance Criteria:**
- [ ] Add `<meta name="theme-color">` tags with `media="(prefers-color-scheme: ...)"` in the root layout for dynamic theme color
- [ ] Add an icon entry with `"purpose": "any maskable"` in manifest.json
- [ ] Consider using the app's actual background color tokens

### FOO-637: Add prefers-reduced-motion override for tw-animate-css animations

**Priority:** Medium | **Labels:** Bug
**Description:** Custom animations respect `prefers-reduced-motion` via `globals.css:178-185`, but Radix UI components use `animate-in`/`animate-out` from tw-animate-css which has zero reduced-motion support.

**Acceptance Criteria:**
- [ ] All tw-animate-css animations suppressed under `prefers-reduced-motion: reduce`
- [ ] Radix UI components still function (open/close state) — use `0.01ms` duration, not `none`
- [ ] Existing custom animation overrides remain intact

### FOO-646: Claude redundantly re-searches food log when data already in conversation context

**Priority:** Low | **Labels:** Performance
**Description:** When user confirms logging a food item already retrieved in a previous turn, Claude calls `search_food_log` again. The data is already in conversation context.

**Acceptance Criteria:**
- [ ] System prompts include rule: do not re-search for food data already present in conversation
- [ ] Both `CHAT_SYSTEM_PROMPT` and `ANALYSIS_SYSTEM_PROMPT` updated

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] `npm test` passes
- [ ] `npm run build` passes

## Implementation Tasks

### Task 1: Add aria-expanded to meal breakdown headers

**Issue:** FOO-612
**Files:**
- `src/components/meal-breakdown.tsx` (modify)
- `src/components/__tests__/meal-breakdown.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test: render a meal, verify the header button has `aria-expanded="false"`, click it, verify it becomes `aria-expanded="true"`.
   - Run: `npx vitest run meal-breakdown`

2. **GREEN** — Add `aria-expanded={isExpanded}` to the `<button>` element at line 55.
   - Run: `npx vitest run meal-breakdown`

**Notes:** Reference the existing `data-testid={`meal-header-${meal.mealTypeId}`}` for querying the button in tests.

### Task 2: Remove incorrect tablist ARIA roles from segmented controls

**Issue:** FOO-613
**Files:**
- `src/components/dashboard-shell.tsx` (modify)
- `src/components/quick-select.tsx` (modify)
- `src/components/weekly-nutrition-chart.tsx` (modify)
- `src/components/__tests__/dashboard-shell.test.tsx` (modify)
- `src/components/__tests__/weekly-nutrition-chart.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update existing tests that query by `role("tab")` or `role("tablist")` to use alternative selectors (testid or text content). Tests will fail because the roles still exist in the components.
   - Actually: since we're removing roles, tests querying by role will break after the change. So update tests AND component simultaneously.
   - Run: `npx vitest run dashboard-shell weekly-nutrition`

2. **GREEN** — In all three components:
   - Remove `role="tablist"` from container divs
   - Remove `role="tab"` and `aria-selected` from buttons
   - Keep `aria-controls` on buttons (panel association is still useful)
   - Run: `npx vitest run dashboard-shell weekly-nutrition quick-select`

**Notes:** `quick-select.tsx` also has `id="tab-suggested"` / `id="tab-recent"` — these can stay (they're valid HTML), but the `role="tab"` must go. The `weekly-nutrition-chart.tsx` has the metric selector tabs — same treatment.

### Task 3: Add accessible representations to data visualizations

**Issue:** FOO-614
**Files:**
- `src/components/macro-bars.tsx` (modify)
- `src/components/__tests__/macro-bars.test.tsx` (modify)
- `src/components/calorie-ring.tsx` (modify)
- `src/components/__tests__/calorie-ring.test.tsx` (modify)
- `src/components/weekly-nutrition-chart.tsx` (modify)
- `src/components/__tests__/weekly-nutrition-chart.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Macro bars: add test asserting each bar has `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, and `aria-label` containing the macro name and values.
   - Run: `npx vitest run macro-bars`

2. **GREEN** — Add ARIA attributes to the inner progress div (line 98-102 of `macro-bars.tsx`): `role="progressbar"`, `aria-valuenow={macro.percent}`, `aria-valuemin={0}`, `aria-valuemax={100}`, `aria-label={`${macro.name}: ${macro.label}`}`.
   - Run: `npx vitest run macro-bars`

3. **RED** — Calorie ring: add test asserting the SVG has `aria-hidden="true"` and a visually-hidden span exists with the calorie text.
   - Run: `npx vitest run calorie-ring`

4. **GREEN** — Add `aria-hidden="true"` to the `<svg>` element. Add a `<span className="sr-only">` inside the container with text like `${calories} of ${goal} calories`.
   - Run: `npx vitest run calorie-ring`

5. **RED** — Weekly chart: add test asserting the chart container has an `aria-label`.
   - Run: `npx vitest run weekly-nutrition-chart`

6. **GREEN** — Add `aria-label={`Weekly ${selectedMetric} chart`}` to the chart container div (the one with `id="panel-metric"`).
   - Run: `npx vitest run weekly-nutrition-chart`

### Task 4: Fix confidence badge garbled accessible name

**Issue:** FOO-615
**Files:**
- `src/components/confidence-badge.tsx` (modify)
- `src/components/__tests__/confidence-badge.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test: render badge with confidence="high", verify the indicator div does NOT have an `aria-label` attribute.
   - Run: `npx vitest run confidence-badge`

2. **GREEN** — Remove `aria-label={`Confidence: ${confidence}`}` from the `<div>` at line 39-43.
   - Run: `npx vitest run confidence-badge`

**Notes:** The existing icon has `aria-hidden="true"`, so the accessible name will come from the `<span>` text ("high", "medium", "low") which is sufficient.

### Task 5: Replace hardcoded amber color with semantic token

**Issue:** FOO-617
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add or update test for the compression warning element: verify it does NOT contain `text-amber-600` class, and instead uses the semantic warning class.
   - Run: `npx vitest run food-chat`

2. **GREEN** — Replace `text-amber-600 dark:text-amber-400` with `text-warning` (or `text-muted-foreground` if warning text color doesn't exist as a standalone token — check `globals.css` for available warning tokens).
   - Run: `npx vitest run food-chat`

**Notes:** Check which warning semantic tokens are available in the design system. The `text-warning` class maps to `hsl(var(--warning))` which should be the amber/yellow color with proper contrast.

### Task 6: Fix chat photo menu button touch targets

**Issue:** FOO-620
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test: render food-chat, open photo menu, verify Camera and Gallery buttons have `min-h-[44px]` class (or use a more semantic assertion).
   - Run: `npx vitest run food-chat`

2. **GREEN** — Change both `min-h-[36px]` to `min-h-[44px]` at lines 748 and 760 of `food-chat.tsx`.
   - Run: `npx vitest run food-chat`

### Task 7: Fix dark mode error banner contrast

**Issue:** FOO-630
**Files:**
- `src/components/food-chat.tsx` (modify)

**TDD Steps:**

1. **GREEN** — Increase the dark mode background opacity for better contrast. Change `bg-destructive/10` to `bg-destructive/10 dark:bg-destructive/20` at line 656. This doubles the background tint in dark mode, improving the text/background contrast ratio.
   - Run: `npx vitest run food-chat`

**Notes:** This is a visual fix. The exact opacity may need visual verification. `dark:bg-destructive/20` is a reasonable starting point — the implementer should visually confirm in browser dark mode.

### Task 8: Add prefers-reduced-motion override for tw-animate-css

**Issue:** FOO-637
**Files:**
- `src/app/globals.css` (modify)

**TDD Steps:**

1. **GREEN** — Add the following CSS block after the existing `prefers-reduced-motion` block at line 185 of `globals.css`:
   - A `@media (prefers-reduced-motion: reduce)` rule targeting `[data-state]` elements (Radix UI convention)
   - Set `animation-duration: 0.01ms !important`, `animation-iteration-count: 1 !important`, `transition-duration: 0.01ms !important`
   - Using `0.01ms` instead of `none` to avoid breaking Radix `animationend` event handlers
   - Run: `npm run build` (CSS changes don't need unit tests — verify via build)

**Notes:** This is a CSS-only change. The `[data-state]` selector targets all Radix UI components that use state-driven animations.

### Task 9: Lazy load react-markdown via next/dynamic

**Issue:** FOO-623
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)
- `src/components/__tests__/chat-markdown.test.tsx` (verify still passes)

**TDD Steps:**

1. **GREEN** — In `food-chat.tsx`, replace the static import of `ChatMarkdown` with `next/dynamic`:
   - `const ChatMarkdown = dynamic(() => import('./chat-markdown').then(m => ({ default: m.ChatMarkdown })), { ssr: false, loading: () => <fallback> })`
   - Use a simple text skeleton as fallback
   - Run: `npx vitest run food-chat chat-markdown`

**Notes:** The `ChatMarkdown` component is a named export, so the dynamic import needs the `.then()` wrapper to convert to default export. `ssr: false` is correct since markdown content only appears after client-side AI interaction. The `chat-markdown.tsx` file itself stays unchanged — only the import site changes.

### Task 10: Expand dashboard prefetch to all endpoints

**Issue:** FOO-624
**Files:**
- `src/components/dashboard-prefetch.tsx` (modify)
- `src/components/__tests__/dashboard-prefetch.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update test to verify `preload` is called for all expected endpoints: `nutrition-summary`, `nutrition-goals`, `lumen-goals`, `earliest-entry` (in addition to existing `common-foods` and `food-history`). The date-specific endpoints should use today's date.
   - Run: `npx vitest run dashboard-prefetch`

2. **GREEN** — Import `getTodayDate` from `@/lib/date-utils`. Add preload calls for:
   - `/api/nutrition-summary?date=${today}`
   - `/api/nutrition-goals?clientDate=${today}`
   - `/api/lumen-goals?date=${today}`
   - `/api/earliest-entry`
   - Run: `npx vitest run dashboard-prefetch`

**Notes:** The SWR keys must exactly match what the dashboard components request. `DailyDashboard` initializes `selectedDate` with `getTodayDate()`, so using the same function ensures key match. Weekly endpoints (`nutrition-range`, `fasting`) have more complex keys — prefetch the simpler daily ones first as they're the default view.

### Task 11: Add useTransition to dashboard shell tab switch

**Issue:** FOO-626
**Files:**
- `src/components/dashboard-shell.tsx` (modify)
- `src/components/__tests__/dashboard-shell.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test: verify that switching tabs still renders the correct dashboard (Daily vs Weekly). This should already be covered, so the test may just need a check that `isPending` state is handled.
   - Run: `npx vitest run dashboard-shell`

2. **GREEN** — Import `useTransition` from React. Wrap the `setView()` calls in `startTransition()`. Optionally add a subtle opacity reduction on the panel div when `isPending` is true.
   - Run: `npx vitest run dashboard-shell`

### Task 12: PWA manifest improvements

**Issue:** FOO-636
**Files:**
- `public/manifest.json` (modify)
- `src/app/layout.tsx` (modify)

**TDD Steps:**

1. **GREEN** — In `manifest.json`:
   - Add `"purpose": "any maskable"` to both icon entries
   - Run: `npm run build` (manifest is static, no unit test needed)

2. **GREEN** — In `src/app/layout.tsx`, add two `<meta name="theme-color">` tags in the `<head>`:
   - One with `media="(prefers-color-scheme: light)"` and `content` matching the light background color
   - One with `media="(prefers-color-scheme: dark)"` and `content` matching the dark background color
   - Check `globals.css` for the actual `--background` HSL values in light and dark modes
   - Run: `npm run build`

**Notes:** The manifest.json `theme_color` remains as a fallback for browsers that don't support the meta tag. The meta tags take precedence and support dark mode.

### Task 13: Add system prompt rule to avoid redundant food log re-searches

**Issue:** FOO-646
**Files:**
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **GREEN** — Add a rule to both `CHAT_SYSTEM_PROMPT` and `ANALYSIS_SYSTEM_PROMPT`:
   - Something like: "Do not re-search for food data that is already present in the conversation from a previous tool call. If search_food_log already returned a food's nutritional data in an earlier turn, use that data directly instead of searching again."
   - Place it near the other tool usage rules
   - Run: `npm run build` (prompt changes don't need unit tests)

**Notes:** This is a prompt engineering fix only. No code logic changes. The existing tests for claude.ts should still pass since they test the function behavior, not prompt content.

### Task 14: Integration & Verification

**Issue:** All
**Files:** Various from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`

## Worker Partitioning

The 13 issues partition cleanly into 3 independent domains with zero shared files:

| Worker | Domain | Issues | Files |
|--------|--------|--------|-------|
| 1 | Accessibility | FOO-612, 613, 614, 615 | meal-breakdown, dashboard-shell, quick-select, weekly-nutrition-chart, macro-bars, calorie-ring, confidence-badge + tests |
| 2 | Visual/CSS | FOO-617, 620, 630, 637 | food-chat, globals.css + tests |
| 3 | Performance | FOO-623, 624, 626, 636, 646 | food-chat (dynamic import only), dashboard-prefetch, dashboard-shell, manifest.json, layout.tsx, claude.ts + tests |

**Conflict note:** Worker 2 and Worker 3 both touch `food-chat.tsx`, but in completely different sections (Worker 2: lines 725, 748, 760, 656 for CSS classes; Worker 3: imports section for dynamic import). Also Worker 1 and Worker 3 both touch `dashboard-shell.tsx` (Worker 1: removing ARIA roles; Worker 3: adding useTransition) and `weekly-nutrition-chart.tsx` (Worker 1: removing ARIA roles + adding chart aria-label; Worker 3: none actually). Lead merges sequentially to resolve.

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| ChatMarkdown dynamic import fails | Fallback UI shown | Unit test for fallback |
| SWR prefetch fails | Silent — dashboard fetches normally | Existing SWR error handling |
| Missing semantic CSS token | Build fails with unknown class | Build check |

## Risks & Open Questions

- [ ] FOO-617: Need to verify which warning semantic token exists (`text-warning` vs `text-warning-foreground` vs something else). Check `globals.css` theme variables.
- [ ] FOO-630: Exact opacity value for dark mode error banner needs visual verification. Starting with `dark:bg-destructive/20`.
- [ ] FOO-636: Maskable icons ideally need a safe zone (inner 80% circle). Using `"purpose": "any maskable"` on existing icons is a pragmatic first step — icons may display slightly cropped on some Android launchers.
- [ ] FOO-623: Dynamic import may cause a brief flash when ChatMarkdown first loads. The loading fallback should be minimal (small skeleton or empty div).

## Scope Boundaries

**In Scope:**
- All 13 listed issues (8 bugs + 5 performance)
- Unit test updates for changed components
- Build verification

**Out of Scope:**
- Full keyboard navigation for tab-like controls (FOO-613 removes misleading roles; adding proper keyboard support would be a separate feature)
- Creating dedicated maskable icon assets (using "any maskable" purpose as pragmatic fix)
- Comprehensive performance profiling or bundle size measurement
- Other backlog issues (Improvement label items: FOO-619, 621, 622, 628, 629, 631, 632, 635, 638, 640)

---

## Iteration 1

**Implemented:** 2026-02-18
**Method:** Agent team (3 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Add aria-expanded to meal breakdown headers (FOO-612) — worker-1
- Task 2: Remove incorrect tablist ARIA roles from segmented controls (FOO-613) — worker-1
- Task 3: Add accessible representations to data visualizations (FOO-614) — worker-1
- Task 4: Fix confidence badge garbled accessible name (FOO-615) — worker-1
- Task 5: Replace hardcoded amber color with semantic token (FOO-617) — worker-2
- Task 6: Fix chat photo menu button touch targets (FOO-620) — worker-2
- Task 7: Fix dark mode error banner contrast (FOO-630) — worker-2
- Task 8: Add prefers-reduced-motion override for tw-animate-css (FOO-637) — worker-2
- Task 9: Lazy load react-markdown via next/dynamic (FOO-623) — worker-3
- Task 10: Expand dashboard prefetch to all endpoints (FOO-624) — worker-3
- Task 11: Add useTransition to dashboard shell tab switch (FOO-626) — worker-3
- Task 12: PWA manifest improvements (FOO-636) — worker-3
- Task 13: Add system prompt rule to avoid redundant food log re-searches (FOO-646) — worker-3

### Files Modified
- `src/components/meal-breakdown.tsx` — Added aria-expanded to header buttons
- `src/components/dashboard-shell.tsx` — Removed tablist roles, added useTransition, static panel id, aria-pressed
- `src/components/quick-select.tsx` — Removed tablist/tab/tabpanel roles
- `src/components/weekly-nutrition-chart.tsx` — Removed tablist roles, added chart aria-label
- `src/components/macro-bars.tsx` — Added progressbar role and ARIA attributes
- `src/components/calorie-ring.tsx` — Added aria-hidden to SVG, sr-only text with formatted numbers
- `src/components/confidence-badge.tsx` — Removed duplicate aria-label from indicator div
- `src/components/food-chat.tsx` — Semantic warning color, 44px touch targets, dark mode contrast, dynamic ChatMarkdown import
- `src/components/dashboard-prefetch.tsx` — Added 4 new endpoint prefetches
- `src/app/globals.css` — Added prefers-reduced-motion override for tw-animate-css
- `public/manifest.json` — Added maskable icon purpose
- `src/lib/claude.ts` — Added redundant re-search prevention rule to system prompts
- `src/components/__tests__/*.test.tsx` — Updated tests for all changes (8 test files)
- `src/components/__tests__/analysis-result.test.tsx` — Updated for removed confidence aria-label

### Linear Updates
- FOO-612: Todo → In Progress → Review
- FOO-613: Todo → In Progress → Review
- FOO-614: Todo → In Progress → Review
- FOO-615: Todo → In Progress → Review
- FOO-617: Todo → In Progress → Review
- FOO-620: Todo → In Progress → Review
- FOO-623: Todo → In Progress → Review
- FOO-624: Todo → In Progress → Review
- FOO-626: Todo → In Progress → Review
- FOO-630: Todo → In Progress → Review
- FOO-636: Todo → In Progress → Review
- FOO-637: Todo → In Progress → Review
- FOO-646: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 5 bugs (2 HIGH, 3 MEDIUM), all fixed:
  - text-warning → text-warning-foreground (contrast fix)
  - Dashboard panel id made static (aria-controls validity)
  - Orphaned role="tabpanel" removed from quick-select
  - Calorie ring sr-only text uses formatted numbers
  - Dashboard prefetch key verified matching DailyDashboard SWR key
- Post-merge integration: 2 cross-worker conflicts fixed (dashboard-shell role→button query, analysis-result aria-label assertion)
- verifier: All 2033 tests pass, zero lint warnings (main project), build clean

### Work Partition
- Worker 1 (Accessibility): Tasks 1-4 — meal-breakdown, dashboard-shell, quick-select, weekly-nutrition-chart, macro-bars, calorie-ring, confidence-badge
- Worker 2 (Visual/CSS): Tasks 5-8 — food-chat, globals.css
- Worker 3 (Performance): Tasks 9-13 — food-chat, dashboard-prefetch, dashboard-shell, manifest.json, claude.ts

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: merged cleanly, typecheck passed
- Worker 3: auto-merged overlapping files (dashboard-shell, food-chat), typecheck passed

### Continuation Status
All tasks completed.

### Review Findings

Summary: 8 findings from 3 reviewers (security, reliability, quality) — 4 FIX, 4 DISCARD
- FIX: 4 issue(s) — Linear issues created in Todo
- DISCARDED: 4 finding(s) — false positives / not applicable

**Issues requiring fix:**
- [MEDIUM] BUG: Quick-select fetch has no timeout — button stuck in "Logging..." if server hangs (`src/components/quick-select.tsx:143`) — FOO-655
- [MEDIUM] CONVENTION: Quick-select aria-controls references non-existent panel IDs (`src/components/quick-select.tsx:286,298`) — FOO-656
- [LOW] CONVENTION: Quick-select uses raw `response.json()` instead of `safeResponseJson()` (`src/components/quick-select.tsx:153`) — FOO-657
- [LOW] BUG: Meal breakdown sorts unrecognized meal types to top instead of bottom (`src/components/meal-breakdown.tsx:35-37`) — FOO-658

**Discarded findings (not bugs):**
- [DISCARDED] SECURITY: Prompt injection via initialAnalysis in system prompt (`src/lib/claude.ts:1320-1328`) — User already has direct conversational control over Claude; single-user with OAuth allowlist; initialAnalysis originates from user's own prior Claude response
- [DISCARDED] BUG: validateFoodAnalysis accepts NaN (`src/lib/claude.ts:330-337`) — NaN cannot come from JSON.parse (no NaN literal in JSON spec); strict:true tool schema further prevents it; impossible in context
- [DISCARDED] EDGE CASE: blobsToBase64 undefined if DataURL has no comma (`src/components/food-chat.tsx:218`) — readAsDataURL always produces `data:type;base64,DATA` format per browser spec; comma is guaranteed (duplicate finding from reliability + quality reviewers)
- [DISCARDED] TYPE: Same as above — merged duplicate

### Linear Updates
- FOO-612: Review → Merge
- FOO-613: Review → Merge
- FOO-614: Review → Merge
- FOO-615: Review → Merge
- FOO-617: Review → Merge
- FOO-620: Review → Merge
- FOO-623: Review → Merge
- FOO-624: Review → Merge
- FOO-626: Review → Merge
- FOO-630: Review → Merge
- FOO-636: Review → Merge
- FOO-637: Review → Merge
- FOO-646: Review → Merge
- FOO-655: Created in Todo (Fix: quick-select fetch timeout)
- FOO-656: Created in Todo (Fix: quick-select aria-controls IDs)
- FOO-657: Created in Todo (Fix: quick-select safeResponseJson)
- FOO-658: Created in Todo (Fix: meal-breakdown sort order)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [FOO-655](https://linear.app/lw-claude/issue/FOO-655), [FOO-656](https://linear.app/lw-claude/issue/FOO-656), [FOO-657](https://linear.app/lw-claude/issue/FOO-657), [FOO-658](https://linear.app/lw-claude/issue/FOO-658)

### Fix 1: Add AbortSignal timeout to quick-select fetch
**Linear Issue:** [FOO-655](https://linear.app/lw-claude/issue/FOO-655)

1. Write test in `src/components/__tests__/quick-select.test.tsx` verifying the fetch call includes a signal option
2. Add `signal: AbortSignal.timeout(15000)` to the fetch options at `src/components/quick-select.tsx:143`

### Fix 2: Fix aria-controls panel ID references in quick-select
**Linear Issue:** [FOO-656](https://linear.app/lw-claude/issue/FOO-656)

1. Write test in `src/components/__tests__/quick-select.test.tsx` verifying the content panel has an `id` and buttons reference it via `aria-controls`
2. Add `id="panel-quick-select"` to the content div at `src/components/quick-select.tsx:311`
3. Update both `aria-controls` values (lines 286, 298) from `"panel-suggested"`/`"panel-recent"` to `"panel-quick-select"`

### Fix 3: Replace response.json() with safeResponseJson() in quick-select
**Linear Issue:** [FOO-657](https://linear.app/lw-claude/issue/FOO-657)

1. Import `safeResponseJson` from `@/lib/swr` in `src/components/quick-select.tsx`
2. Replace `response.json()` at line 153 with `safeResponseJson(response)`

### Fix 4: Fix meal breakdown sort for unrecognized meal types
**Linear Issue:** [FOO-658](https://linear.app/lw-claude/issue/FOO-658)

1. Write test in `src/components/__tests__/meal-breakdown.test.tsx` with a meal that has an unrecognized `mealTypeId` (e.g., 99), verifying it sorts to the end
2. Update sort comparator at `src/components/meal-breakdown.tsx:35-37` to map `-1` to `Infinity`
