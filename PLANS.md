# Implementation Plan

**Created:** 2026-03-07
**Source:** Backlog: FOO-847, FOO-848, FOO-849, FOO-850, FOO-851
**Linear Issues:** [FOO-847](https://linear.app/lw-claude/issue/FOO-847/start-over-does-not-clear-photo-thumbnails-in-photocapture), [FOO-848](https://linear.app/lw-claude/issue/FOO-848/remove-redundant-clear-all-button-from-photocapture), [FOO-849](https://linear.app/lw-claude/issue/FOO-849/heic-processing-placeholder-appears-above-existing-photos-instead-of), [FOO-850](https://linear.app/lw-claude/issue/FOO-850/move-history-link-from-top-banner-to-bottom-button-on-home-screen), [FOO-851](https://linear.app/lw-claude/issue/FOO-851/dialog-and-alertdialog-popups-fly-in-from-top-left-instead-of)
**Branch:** fix/ux-polish-batch-2

## Context Gathered

### Codebase Analysis

- **Dialog components:** `src/components/ui/dialog.tsx` (line 39, default variant) and `src/components/ui/alert-dialog.tsx` (line 39) both have `slide-in-from-left-1/2` + `slide-in-from-top-[48%]` animation classes that compound with `translate-x-[-50%] translate-y-[-50%]` positioning, causing fly-in from top-left. The `bottom-sheet` variant in dialog.tsx is unaffected (uses `slide-in-from-bottom`). `photo-preview-dialog.tsx` uses zoom-only and is also unaffected.
- **PhotoCapture state:** `src/components/photo-capture.tsx` manages internal `useState` for `photos`, `previews`, `restoredPreviews`, `processingCount`, etc. The parent `FoodAnalyzer` has no mechanism to reset these — `handleStartOver` (food-analyzer.tsx:137) clears session state but PhotoCapture's internal state persists. No `key` prop is passed to `<PhotoCapture>` at food-analyzer.tsx:710.
- **PhotoCapture Clear All:** Two "Clear All" buttons exist at photo-capture.tsx:430-439 (restored photos, shown when >=2) and :482-491 (new photos, shown when >=2). Each triggers a shared `AlertDialog` confirmation. Individual photo X buttons also exist.
- **HEIC placeholders:** Processing placeholders are rendered in their own grid (photo-capture.tsx:376-390), a separate block BEFORE the previews grids (lines 393-493). They should be inline grid items after existing photos.
- **History link:** Currently in `src/components/dashboard-shell.tsx:17-27` as a card-styled `<Link>` above the segmented control. Should move to `src/components/daily-dashboard.tsx` near Settings link (line 448).
- **Bottom button pattern:** `daily-dashboard.tsx:448-454` — Settings link uses `<Link>` with inline button classes, icon, `min-h-[44px]`, `w-full`.
- **Test files:** `dashboard-shell.test.tsx`, `daily-dashboard.test.tsx`, `photo-capture.test.tsx`, `food-analyzer.test.tsx`, `e2e/tests/analyze-photos.spec.ts`

### Triage Results

**Planned:** FOO-847, FOO-848, FOO-849, FOO-850, FOO-851
**Canceled:** (none)

## Tasks

### Task 1: Fix dialog and alert-dialog fly-in animation
**Linear Issue:** [FOO-851](https://linear.app/lw-claude/issue/FOO-851/dialog-and-alertdialog-popups-fly-in-from-top-left-instead-of)
**Files:**
- `src/components/ui/dialog.tsx` (modify)
- `src/components/ui/alert-dialog.tsx` (modify)

**Steps:**
1. These are vendored shadcn/ui primitives with no existing unit tests. The change is purely CSS classes. Skip TDD — apply the fix directly and verify via build/lint.
2. In `dialog.tsx` line 39 (default variant only), remove the four `slide-*` classes: `data-[state=closed]:slide-out-to-left-1/2`, `data-[state=closed]:slide-out-to-top-[48%]`, `data-[state=open]:slide-in-from-left-1/2`, `data-[state=open]:slide-in-from-top-[48%]`. Keep `zoom-in-95`, `zoom-out-95`, `fade-in-0`, `fade-out-0` and all other classes. Do NOT touch the `bottom-sheet` variant.
3. In `alert-dialog.tsx` line 39, remove the same four `slide-*` classes. Keep zoom and fade classes.
4. Run `npx vitest run` to verify no tests break.
5. Run `npm run typecheck` and `npm run lint` to verify zero warnings.

**Notes:**
- The `bottom-sheet` variant in dialog.tsx uses `slide-in-from-bottom` / `slide-out-to-bottom` which is correct — do not modify.
- `photo-preview-dialog.tsx` already uses zoom-only and needs no changes.

---

### Task 2: Fix Start Over not clearing PhotoCapture thumbnails
**Linear Issue:** [FOO-847](https://linear.app/lw-claude/issue/FOO-847/start-over-does-not-clear-photo-thumbnails-in-photocapture)
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**Steps:**
1. **RED:** In `food-analyzer.test.tsx`, add a test: when Start Over is confirmed, PhotoCapture should re-mount and all photo thumbnails should be cleared. The test should: add photos via the camera input, confirm preview images render, click "Start over", confirm the AlertDialog, then assert no preview images remain in the DOM while the camera input still exists (component re-rendered fresh).
2. Run `npx vitest run "food-analyzer"` — expect the new test to fail because PhotoCapture retains internal state after Start Over.
3. **GREEN:** In `food-analyzer.tsx`, add a `photoCaptureKey` state counter: `const [photoCaptureKey, setPhotoCaptureKey] = useState(0)`. In `handleStartOver` (line 137), increment it: `setPhotoCaptureKey(k => k + 1)`. Pass `key={photoCaptureKey}` to the `<PhotoCapture>` component at line 710. This forces a full re-mount, clearing all internal state.
4. Run `npx vitest run "food-analyzer"` — expect the test to pass.

**Notes:**
- The `key` prop approach is the simplest fix — avoids lifting state or adding imperative refs.

---

### Task 3: Remove redundant Clear All button from PhotoCapture
**Linear Issue:** [FOO-848](https://linear.app/lw-claude/issue/FOO-848/remove-redundant-clear-all-button-from-photocapture)
**Files:**
- `src/components/photo-capture.tsx` (modify)
- `src/components/__tests__/photo-capture.test.tsx` (modify)

**Steps:**
1. **RED:** In `photo-capture.test.tsx`, update existing tests: any test that asserts the presence of "Clear All" buttons or the "Clear all photos?" confirmation dialog should be updated to assert their ABSENCE instead. Tests for individual photo removal via X buttons should remain unchanged.
2. Run `npx vitest run "photo-capture"` — expect updated tests to fail (Clear All still exists).
3. **GREEN:** In `photo-capture.tsx`:
   - Remove the `showClearConfirm` state (line 49)
   - Remove `handleClearClick` function (lines 229-237)
   - Remove `handleClearRestoredPhotos` function (lines 260-265)
   - Remove `doClear` function (lines 239-258)
   - Remove the "Clear All" button for restored photos (lines 430-439)
   - Remove the "Clear All" button for new photos (lines 482-491)
   - Remove the `AlertDialog` for clear confirmation (lines 502-515)
   - Remove the AlertDialog-related imports (lines 6-14) — the only AlertDialog usage in this component is the clear confirmation dialog
4. Run `npx vitest run "photo-capture"` — expect tests to pass.
5. Check `e2e/tests/analyze-photos.spec.ts` for any "Clear All" references that need updating.

**Notes:**
- Individual photo X buttons remain — they are the primary removal mechanism.
- "Start over" in FoodAnalyzer handles full clearing (working correctly after Task 2).

---

### Task 4: Move HEIC processing placeholders inline with photo grid
**Linear Issue:** [FOO-849](https://linear.app/lw-claude/issue/FOO-849/heic-processing-placeholder-appears-above-existing-photos-instead-of)
**Files:**
- `src/components/photo-capture.tsx` (modify)
- `src/components/__tests__/photo-capture.test.tsx` (modify)

**Steps:**
1. **RED:** In `photo-capture.test.tsx`, add a test: when photos exist AND processing is in progress, the processing placeholders should appear WITHIN the same grid container as the photo previews (as sibling elements), not in a separate grid above them. Assert that `processing-placeholder` testid elements share the same parent grid element as the preview thumbnails.
2. Run `npx vitest run "photo-capture"` — expect the test to fail (placeholders are in a separate grid).
3. **GREEN:** In `photo-capture.tsx`:
   - Remove the standalone processing placeholders block (lines 376-390 — the entire `{processingCount > 0 && ...}` section with its own grid).
   - Inside the new photos previews grid (the `<div className="grid grid-cols-3 gap-2">` at line 445), after the `{previews.map(...)}` block, add the processing placeholder items as additional grid children: `{processingCount > 0 && Array.from({ length: processingCount }).map((_, index) => (` with the same placeholder markup (grey background, spinner).
   - Handle the edge case when there are NO existing previews but processing is happening (first HEIC photo selection). Change the condition at line 443 from `{previews.length > 0 && (` to `{(previews.length > 0 || processingCount > 0) && (` so the grid renders even when only processing placeholders exist.
4. Run `npx vitest run "photo-capture"` — expect the test to pass.

**Notes:**
- The restored photos grid (lines 393-428) does not need processing placeholders — HEIC processing only happens for new file selections.
- After Task 3, line numbers will have shifted due to removed Clear All code. The implementer should locate elements by content rather than line numbers.

---

### Task 5: Move History link from top banner to bottom button
**Linear Issue:** [FOO-850](https://linear.app/lw-claude/issue/FOO-850/move-history-link-from-top-banner-to-bottom-button-on-home-screen)
**Files:**
- `src/components/dashboard-shell.tsx` (modify)
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/dashboard-shell.test.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify)

**Steps:**
1. **RED:** In `dashboard-shell.test.tsx`, update tests to assert no History link exists. In `daily-dashboard.test.tsx`, add a test asserting a History link pointing to `/app/history` exists, rendered near the Settings link with a Clock icon.
2. Run `npx vitest run "dashboard"` — expect dashboard-shell tests to fail (link still present) and daily-dashboard tests to fail (link not present).
3. **GREEN:**
   - In `dashboard-shell.tsx`: Remove the History link block (lines 17-27). Remove the `Clock` import from lucide-react (line 5) and the `Link` import from next/link (line 4) since they are no longer used in this component.
   - In `daily-dashboard.tsx`: Add a History link in the bottom buttons area, inside the same `flex flex-col gap-2` container as the "Update Lumen goals" button (around line 428). Follow the existing Settings link pattern (line 448): `<Link>` with inline button classes, `Clock` icon, `min-h-[44px]`, `w-full`, text "History". Add `Clock` to the existing lucide-react import statement. The link should use `href="/app/history"`.
4. Run `npx vitest run "dashboard"` — expect all tests to pass.

**Notes:**
- Follow the Settings link pattern at daily-dashboard.tsx:448-454 exactly for visual consistency.
- Only DailyDashboard gets the History link — WeeklyDashboard does not need it.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix 5 UX issues: dialog fly-in animation, Start Over not clearing photos, redundant Clear All button, HEIC placeholder positioning, and History link placement.
**Linear Issues:** FOO-847, FOO-848, FOO-849, FOO-850, FOO-851
**Approach:** Task 1 removes broken slide-in CSS classes from dialog/alert-dialog (keep zoom+fade). Task 2 uses React `key` prop to force PhotoCapture re-mount on Start Over. Task 3 removes Clear All buttons and their confirmation dialog. Task 4 moves processing placeholders inline with the photo grid. Task 5 relocates the History link from DashboardShell to DailyDashboard's bottom button group.
**Scope:** 5 tasks, 8 files modified, ~8 tests added/updated
**Key Decisions:** Using `key` prop for PhotoCapture reset (simplest approach, no state lifting needed)
**Risks:** None significant — all changes are UI-only with no backend or data impact
