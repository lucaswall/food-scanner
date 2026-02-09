# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-245-frontend-review-fixes
**Issues:** FOO-245, FOO-246, FOO-247, FOO-248, FOO-249, FOO-250, FOO-251, FOO-252, FOO-253, FOO-254, FOO-255, FOO-256, FOO-257, FOO-258, FOO-259, FOO-260, FOO-261, FOO-262, FOO-263, FOO-264, FOO-267
**Created:** 2026-02-08
**Last Updated:** 2026-02-08

## Summary

Comprehensive frontend review fixes: accessibility improvements (aria-labels, heading hierarchy, tab patterns, skip links, reduced motion), visual/UX polish (theme colors, spinners, empty states, dark mode borders, step indicator), and technical cleanup (remove unused directives, shared fetcher, PWA manifest). Plus the original two fixes: bottom nav rename and history rounding.

## Issues

### FOO-245: Rename bottom nav 'Take Photo' to 'Analyze' with ScanEye icon
**Priority:** Medium | **Labels:** Improvement
### FOO-246: History daily summary shows unrounded metric values
**Priority:** Medium | **Labels:** Bug
### FOO-247: Add aria-label to form inputs missing accessible names
**Priority:** Medium | **Labels:** Improvement
### FOO-248: Associate Meal Type labels with select controls
**Priority:** Medium | **Labels:** Improvement
### FOO-249: Add SkipLink to landing page and settings page
**Priority:** Low | **Labels:** Improvement
### FOO-250: Add aria-label to bottom nav element
**Priority:** Low | **Labels:** Improvement
### FOO-251: Replace hardcoded colors with theme variables
**Priority:** Medium | **Labels:** Convention
### FOO-252: Replace bottom nav text-[10px] with text-xs
**Priority:** Low | **Labels:** Convention
### FOO-253: Replace window.confirm with AlertDialog in food history delete
**Priority:** Medium | **Labels:** Improvement
### FOO-254: Soften nutrition-facts-card borders in dark mode
**Priority:** Low | **Labels:** Improvement
### FOO-255: Add visual step indicator to food analyzer flow
**Priority:** Medium | **Labels:** Improvement
### FOO-256: Remove unnecessary 'use client' from 5 components
**Priority:** Medium | **Labels:** Performance
### FOO-257: Add aria-hidden to decorative icons and role=alert to error messages
**Priority:** Low | **Labels:** Improvement
### FOO-258: Add prefers-reduced-motion handling for animate-spin
**Priority:** Low | **Labels:** Improvement
### FOO-259: Add ARIA tab pattern to quick-select tabs
**Priority:** Low | **Labels:** Improvement
### FOO-260: Fix heading hierarchy: h1 → h3 skips h2
**Priority:** Low | **Labels:** Improvement
### FOO-261: Improve empty states with guidance and CTAs
**Priority:** Low | **Labels:** Improvement
### FOO-262: Standardize spinner style across components
**Priority:** Low | **Labels:** Convention
### FOO-263: Add PWA manifest id field and review theme_color
**Priority:** Low | **Labels:** Improvement
### FOO-264: Use shared apiFetcher in settings-content SWR call
**Priority:** Low | **Labels:** Convention
### FOO-267: Ensure confidence badge meets 44px touch target minimum
**Priority:** Low | **Labels:** Improvement

## Prerequisites

- [x] On `main` branch with clean working tree
- [x] `ScanEye` icon available in lucide-react (verified)
- [x] `AlertDialog` component available via shadcn/ui
- [x] `Label` component available via shadcn/ui

## Implementation Tasks

---

### Task 1: Bottom nav — rename, aria-label, font size

**Issues:** FOO-245, FOO-250, FOO-252
**Files:**
- `src/components/bottom-nav.tsx` (modify)
- `src/components/__tests__/bottom-nav.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update tests:
   - Change all `"Take Photo"` references to `"Analyze"` in test descriptions and assertions
   - Change `getByRole("link", { name: /take photo/i })` to `{ name: /^analyze$/i }`
   - Add test: `it("nav has aria-label", () => { expect(screen.getByRole("navigation")).toHaveAttribute("aria-label", "Main navigation"); })`
   - Update font size test: change `toHaveClass("text-[10px]")` to check for `"text-xs"` (if tested), or add assertion
   - Run: `npm test -- bottom-nav` → Verify failures

2. **GREEN** — Update component:
   - Import: replace `Camera` with `ScanEye` from lucide-react
   - Change nav item: `label: "Analyze"`, `icon: ScanEye`
   - Add `aria-label="Main navigation"` to `<nav>` element (line 45)
   - Change `text-[10px]` to `text-xs` on span (line 60)
   - Run: `npm test -- bottom-nav` → All pass

---

### Task 2: Food history — round daily summary values

**Issues:** FOO-246
**Files:**
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test with fractional values:
   - Create entries with `calories: 123.4`, `proteinG: 10.15`, `carbsG: 20.27`, `fatG: 8.33` and `calories: 200.8`, `proteinG: 15.89`, `carbsG: 30.56`, `fatG: 12.78`
   - Assert daily summary shows: `324 cal` (not `324.2`), `P:26.0g`, `C:50.8g`, `F:21.1g`
   - Run: `npm test -- food-history` → Verify new test fails

2. **GREEN** — Apply rounding in the summary span (line 238):
   - `{group.totalCalories}` → `{Math.round(group.totalCalories)}`
   - `{group.totalProteinG}` → `{group.totalProteinG.toFixed(1)}`
   - Same for carbsG, fatG
   - Run: `npm test -- food-history` → All pass

---

### Task 3: Food history — AlertDialog for delete, role=alert, heading hierarchy

**Issues:** FOO-253, FOO-257 (partial), FOO-260 (partial)
**Files:**
- `src/components/food-history.tsx` (modify)
- `src/components/__tests__/food-history.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update delete test:
   - Replace `vi.spyOn(window, "confirm")` with interaction that clicks a dialog confirm button
   - Add test: delete button opens AlertDialog, cancel button dismisses, confirm button proceeds
   - Add test: error message container has `role="alert"`
   - Update heading assertions: date headers should be `<h2>` not `<h3>`
   - Run: `npm test -- food-history` → Verify failures

2. **GREEN** — Update component:
   - Import `AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger` from shadcn/ui
   - Add state for `deleteTargetId: number | null` to track which entry's delete dialog is open
   - Replace `window.confirm()` (line 149) with AlertDialog pattern: clicking delete sets `deleteTargetId`, dialog has Cancel/Delete buttons
   - Add `role="alert"` to error div (line 227)
   - Change `<h3>` to `<h2>` for date headers (line 236)
   - Reference: `src/components/photo-capture.tsx` AlertDialog pattern (lines 321-334)
   - Run: `npm test -- food-history` → All pass

**Notes:**
- Follow the same AlertDialog pattern used in `photo-capture.tsx`
- The `handleDelete` function stays the same, just triggered from AlertDialogAction instead of window.confirm

---

### Task 4: Accessibility — aria-labels on form inputs

**Issues:** FOO-247
**Files:**
- `src/components/description-input.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/quick-select.tsx` (modify)
- Tests for each (modify/add)

**TDD Steps:**

1. **RED** — Add/update tests:
   - description-input test: `expect(screen.getByRole("textbox", { name: /description/i })).toBeInTheDocument()`
   - food-analyzer test: correction input has `aria-label="Correction"`
   - quick-select test: search input has `aria-label="Search foods"`
   - Run tests → Verify failures

2. **GREEN** — Add aria-labels:
   - `description-input.tsx:20`: add `aria-label="Food description"` to `<textarea>`
   - `food-analyzer.tsx:503`: add `aria-label="Correction"` to correction `<Input>`
   - `quick-select.tsx:357`: add `aria-label="Search foods"` to search `<Input>`
   - Run tests → All pass

---

### Task 5: Accessibility — meal type label association

**Issues:** FOO-248
**Files:**
- `src/components/meal-type-selector.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/quick-select.tsx` (modify)
- Tests for each (modify/add)

**TDD Steps:**

1. **RED** — Add tests:
   - Test that `SelectTrigger` has an `id` attribute
   - Test that label has `htmlFor` matching the trigger id
   - Run tests → Verify failures

2. **GREEN** — Associate labels:
   - `meal-type-selector.tsx`: add `id` prop to component interface, pass it to `<SelectTrigger id={id}>`
   - `food-analyzer.tsx:549-550`: change `<label>` to `<Label htmlFor="meal-type-analyzer">`, pass `id="meal-type-analyzer"` to `<MealTypeSelector>`
   - `quick-select.tsx:286`: change `<label>` to `<Label htmlFor="meal-type-quick-select">`, pass `id="meal-type-quick-select"` to `<MealTypeSelector>`
   - Import `Label` from `@/components/ui/label` in both files
   - Run tests → All pass

---

### Task 6: Accessibility — ARIA tab pattern for quick-select

**Issues:** FOO-259
**Files:**
- `src/components/quick-select.tsx` (modify)
- `src/components/__tests__/quick-select.test.tsx` (modify/create)

**TDD Steps:**

1. **RED** — Add tests:
   - Tab container has `role="tablist"`
   - Each tab button has `role="tab"`
   - Active tab has `aria-selected="true"`, inactive has `aria-selected="false"`
   - Tab content has `role="tabpanel"`
   - Run tests → Verify failures

2. **GREEN** — Update component:
   - Add `role="tablist"` to the tab container div (line 329)
   - Add `role="tab"` and `aria-selected={activeTab === "suggested"}` / `"recent"` to each button
   - Add `id="tab-suggested"` / `id="tab-recent"` to tabs
   - Add `role="tabpanel"` and `aria-labelledby="tab-suggested"` / `"tab-recent"` to the content area
   - Run tests → All pass

---

### Task 7: Accessibility — SkipLink on landing and settings

**Issues:** FOO-249
**Files:**
- `src/app/page.tsx` (modify)
- `src/components/settings-content.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests:
   - Landing page test: SkipLink is rendered, points to `#main-content`
   - Settings test: SkipLink is rendered, main has `id="main-content"`
   - Run tests → Verify failures

2. **GREEN** — Add SkipLink:
   - `page.tsx`: import `SkipLink`, add `<SkipLink />` before the outer `<div>`, add `id="main-content"` to `<main>`
   - `settings-content.tsx`: import `SkipLink`, add `<SkipLink />` before the outer `<div>`, add `id="main-content"` to `<main>` (line 48)
   - Run tests → All pass

**Notes:**
- `page.tsx` is a server component — `SkipLink` will need "use client" removed (handled in Task 17) OR we wrap it. Since the landing page redirects authenticated users, SkipLink here is only for the login page. For simplicity, wrap in a fragment.
- Actually, server components CAN import client components. So importing `SkipLink` (which has "use client") into `page.tsx` (server) is fine.

---

### Task 8: Accessibility — decorative icons aria-hidden + error role=alert

**Issues:** FOO-257
**Files:**
- `src/components/food-log-confirmation.tsx` (modify)
- `src/components/analysis-result.tsx` (modify)
- `src/components/quick-select.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests:
   - food-log-confirmation: CheckCircle icon has `aria-hidden="true"`
   - analysis-result: loading spinner div has `aria-hidden="true"`
   - quick-select: error message containers have `role="alert"`
   - Run tests → Verify failures

2. **GREEN** — Apply fixes:
   - `food-log-confirmation.tsx:43`: add `aria-hidden="true"` to `<CheckCircle>`
   - `analysis-result.tsx:31`: add `aria-hidden="true"` to spinner `<div>`
   - `quick-select.tsx:295-297` (detail view error): add `role="alert"` to error div
   - `quick-select.tsx:365-368` (list view error): add `role="alert"` to error div
   - Run tests → All pass

**Notes:**
- `food-history.tsx` error div role="alert" is covered in Task 3
- `confidence-badge.tsx` already has `aria-hidden="true"` on its icons (verified)

---

### Task 9: Accessibility — heading hierarchy

**Issues:** FOO-260
**Files:**
- `src/components/analysis-result.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test:
   - Food name heading should be `<h2>` not `<h3>`
   - Run tests → Verify failure

2. **GREEN** — Change `<h3>` to `<h2>` at line 63:
   - `<h3 className="text-lg font-semibold">` → `<h2 className="text-lg font-semibold">`
   - Run tests → All pass

**Notes:**
- `food-history.tsx` heading hierarchy (h3→h2) is covered in Task 3

---

### Task 10: Accessibility — reduced motion for animate-spin/animate-pulse

**Issues:** FOO-258
**Files:**
- `src/app/globals.css` (modify)

**TDD Steps:**

1. **GREEN** — Add CSS rule to the existing `prefers-reduced-motion` media query (line 157-162):
   - Add `.animate-spin, .animate-pulse` to the selector list
   - Result:
     ```css
     @media (prefers-reduced-motion: reduce) {
       .animate-fade-in,
       .animate-slide-up,
       .animate-spin,
       .animate-pulse {
         animation: none;
       }
     }
     ```
   - Run: `npm run build` → Verify no CSS errors

**Notes:**
- No component changes needed — the global CSS rule covers all instances
- Tailwind's `animate-spin` and `animate-pulse` use CSS animation classes, so `animation: none` disables them

---

### Task 11: Replace hardcoded colors with theme variables

**Issues:** FOO-251
**Files:**
- `src/components/photo-capture.tsx` (modify)
- `src/components/analysis-result.tsx` (modify)
- `src/components/settings-content.tsx` (modify)
- `src/components/food-log-confirmation.tsx` (modify)
- `src/components/dashboard-preview.tsx` (modify)

**Steps:**

1. **GREEN** — Replace colors:
   - `photo-capture.tsx:259`: `text-red-500` → `text-destructive`
   - `analysis-result.tsx:47`: `text-red-500` → `text-destructive`
   - `settings-content.tsx:60`: `text-red-500` → `text-destructive`
   - `food-log-confirmation.tsx:52`: `text-gray-500` → `text-muted-foreground`
   - `food-log-confirmation.tsx:60`: `text-gray-400` → `text-muted-foreground`
   - `settings-content.tsx:70`: `text-green-600` → `text-green-600 dark:text-green-400`
   - `settings-content.tsx:71`: `text-red-600` → `text-destructive`
   - `dashboard-preview.tsx:26`: `bg-blue-500` → `bg-chart-1` (decorative, uses theme chart colors)
   - `dashboard-preview.tsx:35`: `bg-amber-500` → `bg-chart-4`
   - `dashboard-preview.tsx:44`: `bg-rose-500` → `bg-chart-5`
   - Run: `npm test` → Verify existing tests still pass
   - Run: `npm run build` → Verify no warnings

**Notes:**
- `food-log-confirmation.tsx:45` (`text-green-500` on CheckCircle) is a success indicator — keep as-is since there's no `text-success` theme variable. Could use `text-green-500 dark:text-green-400` for dark mode support.

---

### Task 12: Soften dark mode borders on nutrition-facts-card

**Issues:** FOO-254
**Files:**
- `src/components/nutrition-facts-card.tsx` (modify)

**Steps:**

1. **GREEN** — Add dark mode variant to border classes:
   - Line 29: `border-foreground` → `border-foreground dark:border-foreground/50`
   - Line 37: `border-foreground` → `border-foreground dark:border-foreground/50`
   - Line 43: `border-foreground` → `border-foreground dark:border-foreground/50`
   - Line 30 (h4 border-b): same treatment
   - Line 66 (meal type border-t): same treatment
   - Run tests → All pass

---

### Task 13: Standardize spinner style

**Issues:** FOO-262
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/quick-select.tsx` (modify)

**Steps:**

1. **GREEN** — Standardize on the `border-4 border-primary border-t-transparent` style (used in analysis-result.tsx):
   - `food-analyzer.tsx:394`: change `"animate-spin rounded-full h-8 w-8 border-b-2 border-primary"` → `"w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"`
   - `quick-select.tsx:233`: same change (h-8 w-8 version)
   - `quick-select.tsx:421`: change `"animate-spin rounded-full h-6 w-6 border-b-2 border-primary"` → `"w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin"`
   - Run tests → All pass

---

### Task 14: Confidence badge 44px touch target

**Issues:** FOO-267
**Files:**
- `src/components/confidence-badge.tsx` (modify)

**Steps:**

1. **RED** — Add test:
   - Tooltip trigger button has `min-h-[44px]` class
   - Run test → Verify failure

2. **GREEN** — Update button (line 24):
   - `className="flex items-center gap-2 cursor-help"` → `className="flex items-center gap-2 cursor-help min-h-[44px]"`
   - Run tests → All pass

---

### Task 15: Improve empty states with guidance and CTAs

**Issues:** FOO-261
**Files:**
- `src/components/food-history.tsx` (modify)
- `src/components/quick-select.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests:
   - food-history empty state: contains guidance text and link to analyze page
   - quick-select empty state (no search): contains guidance text
   - Run tests → Verify failures

2. **GREEN** — Update empty states:
   - `food-history.tsx:196-200`: Add guidance text below "No food log entries":
     ```
     <p className="text-sm text-muted-foreground">Take a photo or use Quick Select to log your first meal</p>
     ```
   - `quick-select.tsx:382-386`: Add guidance below "No foods found":
     ```
     <p className="text-sm text-muted-foreground">Log some foods first using the Analyze page, then they'll appear here for quick re-logging</p>
     ```
   - Don't add guidance for search "No results found" — that's expected behavior
   - Run tests → All pass

---

### Task 16: Step indicator for food analyzer flow

**Issues:** FOO-255
**Files:**
- `src/components/food-analyzer.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test:
   - When no photos/description: step indicator shows "Capture" as active
   - When analysis is loading: step indicator shows "Review" as active
   - When analysis result shown: step indicator shows "Review" as active
   - When log confirmation shown: step indicator shows "Log" as active
   - Run tests → Verify failures

2. **GREEN** — Add step indicator:
   - Determine current step from component state: capture (no analysis, no logResponse), review (analysis exists or loading), log (logResponse exists)
   - Add a simple text-based indicator at the top of the component: `Step 1 of 3: Capture · Review · Log` with current step highlighted
   - Use `text-muted-foreground` for inactive steps, `text-foreground font-medium` for active
   - Show the indicator in the main return JSX (line 418), but NOT in resubmitting or logResponse screens
   - Run tests → All pass

**Notes:**
- Keep it minimal — just text indicators, not a complex stepper component
- Don't show during resubmission flow (line 391) or success screen (line 403)

---

### Task 17: Remove unnecessary 'use client' from 5 components

**Issues:** FOO-256
**Files:**
- `src/components/skip-link.tsx` (modify)
- `src/components/food-match-card.tsx` (modify)
- `src/components/description-input.tsx` (modify)
- `src/components/analysis-result.tsx` (modify)
- `src/components/confidence-badge.tsx` (modify)

**Steps:**

1. **GREEN** — Remove `"use client";` directive from each file
   - These components have no hooks, state, or browser APIs
   - They are only imported by parent client components (except skip-link which can be a true server component)
   - Run: `npm test` → All pass
   - Run: `npm run build` → No errors

**Notes:**
- `description-input.tsx` has an `onChange` handler on textarea but no React hooks — event handlers work in components rendered within a client boundary
- `confidence-badge.tsx` imports Tooltip components (client), but server components can import client components
- `food-match-card.tsx` imports Button (client) and receives function props — works within client boundary
- If build fails for any component, re-add "use client" to that specific one

---

### Task 18: Use shared apiFetcher in settings-content

**Issues:** FOO-264
**Files:**
- `src/components/settings-content.tsx` (modify)

**TDD Steps:**

1. **RED** — Add/update test:
   - Verify settings page loads session data using standard fetch pattern
   - Run tests → Should pass (behavior unchanged)

2. **GREEN** — Replace custom fetcher:
   - Remove `fetchSession` function (lines 15-23)
   - Import `apiFetcher` from `@/lib/swr`
   - Change SWR call: `useSWR<SessionInfo>("/api/auth/session", apiFetcher, ...)`
   - `apiFetcher` already unwraps `result.data` and throws on `!result.success`, matching `fetchSession` behavior
   - Run tests → All pass

---

### Task 19: PWA manifest updates

**Issues:** FOO-263
**Files:**
- `public/manifest.json` (modify)

**Steps:**

1. **GREEN** — Update manifest:
   - Add `"id": "/app"` for stable PWA identity
   - Change `"theme_color": "#000000"` → `"theme_color": "#ffffff"` (matches light mode default background)
   - Run: `npm run build` → No errors

---

### Task 20: Full verification

**Issues:** All
**Files:** Various

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Visual verification:
   - [ ] Bottom nav shows "Analyze" with ScanEye icon
   - [ ] Bottom nav text is legible (text-xs)
   - [ ] History daily summaries show rounded values
   - [ ] Delete confirmation uses AlertDialog (not native confirm)
   - [ ] Dark mode: nutrition card borders are softer
   - [ ] Spinners are consistent across pages
   - [ ] Step indicator visible in analyzer flow
   - [ ] Empty states show helpful guidance

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Risks & Open Questions

- [ ] Task 17 (remove "use client"): If build fails for any component, re-add the directive to that specific one. Run `npm run build` after each removal.
- [ ] Task 3 (AlertDialog): Ensure AlertDialog works within the existing Dialog component already in food-history.tsx (both from Radix, should coexist fine)
- [ ] Task 16 (step indicator): Keep implementation minimal to avoid overcomplicating the already-large food-analyzer component

## Scope Boundaries

**In Scope:**
- All 21 valid issues listed above
- TDD for each change where testable

**Out of Scope:**
- FOO-265: useReducer refactor — canceled (over-engineering, React batches updates)
- FOO-266: Edge runtime evaluation — canceled (Railway is single-region, no benefit)
- Dashboard-preview.tsx progress bar colors are low priority but included for consistency
- Changing individual food entry display values (only daily summary totals are rounded)
- Changing NutritionFactsCard dialog values
