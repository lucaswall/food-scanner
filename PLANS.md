# Implementation Plan

**Status:** COMPLETE
**Created:** 2026-03-06
**Source:** Backlog: FOO-835, FOO-842, FOO-840, FOO-839, FOO-838, FOO-837, FOO-836, FOO-832, FOO-834, FOO-833
**Linear Issues:** [FOO-835](https://linear.app/lw-claude/issue/FOO-835/ios-safari-unwanted-zoomscaling-during-navigation), [FOO-842](https://linear.app/lw-claude/issue/FOO-842/restored-photos-clear-all-skips-confirmation-dialog), [FOO-840](https://linear.app/lw-claude/issue/FOO-840/log-as-new-cta-label-unclear-when-food-matches-are-shown), [FOO-839](https://linear.app/lw-claude/issue/FOO-839/no-cancel-button-during-in-progress-food-analysis), [FOO-838](https://linear.app/lw-claude/issue/FOO-838/no-way-to-re-analyze-after-initial-analysis-completes), [FOO-837](https://linear.app/lw-claude/issue/FOO-837/confidence-badge-tooltip-inaccessible-on-mobile-hover-only), [FOO-836](https://linear.app/lw-claude/issue/FOO-836/photo-remove-buttons-too-small-for-mobile-touch-targets-24x24px), [FOO-832](https://linear.app/lw-claude/issue/FOO-832/move-history-from-bottom-nav-to-a-button-on-the-home-screen), [FOO-834](https://linear.app/lw-claude/issue/FOO-834/claude-api-529-retry-backoff-too-aggressive-increase-delays), [FOO-833](https://linear.app/lw-claude/issue/FOO-833/sentry-anthropic-sdk-auto-instrumentation-double-reports-overloaded)
**Sentry Issues:** [FOOD-SCANNER-E](https://lucas-wall.sentry.io/issues/FOOD-SCANNER-E), [FOOD-SCANNER-D](https://lucas-wall.sentry.io/issues/FOOD-SCANNER-D)
**Branch:** fix/backlog-ux-reliability-improvements

## Context Gathered

### Codebase Analysis

- **Viewport config:** `src/app/layout.tsx:34-39` — exports `viewport` with only `themeColor`, no scaling constraints
- **Input elements with text-sm (14px):**
  - `src/components/description-input.tsx:31` — textarea uses `text-sm`
  - `src/components/food-history.tsx:248` — date input uses `text-sm`
  - `src/components/ui/input.tsx:11` — shadcn Input uses `text-base` mobile / `md:text-sm` desktop (correct)
- **Photo capture:** `src/components/photo-capture.tsx` — remove buttons at `w-6 h-6` (24px), restored Clear All has no confirmation dialog, fresh Clear All uses `handleClearClick` with dialog
- **Food analyzer:** `src/components/food-analyzer.tsx` — CTA at lines 789-804 switches between "Analyze Food" / "Log to Fitbit" / "Log as new" / loading states. AbortController at line 201-203 is internal-only. No re-analyze UI after analysis completes.
- **Confidence badge:** `src/components/confidence-badge.tsx` — Radix Tooltip (hover-only), has `min-h-[44px]` on trigger
- **Bottom nav:** `src/components/bottom-nav.tsx` — 5 items, History at index 1. `src/lib/navigation.ts` defines `TAB_PATHS` used by swipe nav
- **Claude retry:** `src/lib/claude.ts:261` — `RETRY_DELAYS_MS = [1000, 3000]`, `maxRetries = 2` default
- **Sentry config:** `src/instrumentation.ts` — server-side Sentry init with `pinoIntegration`, no `beforeSend` filter. `src/instrumentation-client.ts` — client-side with replay, no filters
- **Test conventions:** Colocated `__tests__/` directories, Vitest + Testing Library. Existing tests: `src/components/__tests__/bottom-nav.test.tsx`, `src/components/__tests__/food-analyzer.test.tsx`, `src/components/__tests__/photo-capture.test.tsx`
- **Home page:** `src/app/app/page.tsx` — server component with `DashboardShell`, `FitbitStatusBanner`, `DashboardPrefetch`
- **Swipe navigation:** `src/hooks/use-swipe-navigation.ts` uses `TAB_PATHS` from `src/lib/navigation.ts`

### MCP Context

- **MCPs used:** Linear (issue tracking)
- **Findings:** All 10 Backlog issues validated against codebase. All are real and actionable.

### Triage Results

**Planned:** FOO-835, FOO-842, FOO-840, FOO-839, FOO-838, FOO-837, FOO-836, FOO-832, FOO-834, FOO-833
**Canceled:** None

## Tasks

### Task 1: Fix iOS Safari auto-zoom on input focus
**Linear Issue:** [FOO-835](https://linear.app/lw-claude/issue/FOO-835/ios-safari-unwanted-zoomscaling-during-navigation)
**Files:**
- `src/components/description-input.tsx` (modify)
- `src/components/food-history.tsx` (modify)
- `src/app/layout.tsx` (modify)
- `src/components/__tests__/description-input.test.tsx` (create)

**Steps:**
1. **RED:** Write test in `src/components/__tests__/description-input.test.tsx` that renders `DescriptionInput` and asserts the textarea does NOT have `text-sm` class and DOES have `text-base` class. Write a second test that checks the textarea renders with expected styling classes.
2. Run `npx vitest run "description-input"` (expect fail — textarea currently has `text-sm`)
3. **GREEN:** In `src/components/description-input.tsx:31`, replace `text-sm` with `text-base` in the textarea className. This makes the textarea 16px on all screen sizes, preventing iOS auto-zoom on focus.
4. Run `npx vitest run "description-input"` (expect pass)
5. In `src/components/food-history.tsx:248`, replace `text-sm` with `text-base` on the date input className. No test needed — this is a presentational change in a server-rendered component.
6. In `src/app/layout.tsx`, add `maximumScale: 1` and `userScalable: false` to the `viewport` export. This is a PWA safeguard — the app doesn't need pinch-zoom.

**Notes:**
- The shadcn `Input` component (`src/components/ui/input.tsx:11`) already uses `text-base md:text-sm` which is correct (16px on mobile, 14px on desktop). No change needed there.
- The chat `Input` at `src/components/food-chat.tsx:1007` uses the shadcn Input component, so it's already correct.
- `src/components/fitbit-setup-form.tsx:70` uses the shadcn Input component — also correct.

---

### Task 2: Add confirmation dialog for restored photos Clear All
**Linear Issue:** [FOO-842](https://linear.app/lw-claude/issue/FOO-842/restored-photos-clear-all-skips-confirmation-dialog)
**Files:**
- `src/components/photo-capture.tsx` (modify)
- `src/components/__tests__/photo-capture.test.tsx` (modify)

**Steps:**
1. **RED:** Write test in `src/components/__tests__/photo-capture.test.tsx` that renders `PhotoCapture` with 3+ `restoredBlobs`, clicks "Clear All", and asserts that a confirmation dialog appears (check for `AlertDialogTitle` text "Clear all photos?"). Confirm clicking "Confirm" then calls `onPhotosChange` with empty arrays.
2. Run `npx vitest run "photo-capture"` (expect fail — currently clears without dialog)
3. **GREEN:** In `src/components/photo-capture.tsx`, modify the restored photos "Clear All" button (line 455) to call a new handler instead of `handleClearRestoredPhotos` directly. The new handler should set `showClearConfirm` state when `restoredPreviews.length >= 2`, and call `handleClearRestoredPhotos` directly for 1 photo. Update the existing `AlertDialog` to also handle the restored photos case — when `showClearConfirm` is true and there are restored previews but no fresh photos, the confirm action should call `handleClearRestoredPhotos` instead of `doClear`. The dialog description should show the restored count.
4. Run `npx vitest run "photo-capture"` (expect pass)
5. **REFACTOR:** Consider whether the `AlertDialog` needs a unified handler that detects which clear to perform (restored vs fresh) or if two separate dialog states are cleaner.

**Notes:**
- Follow the existing pattern at `photo-capture.tsx:524-533` for the fresh photos Clear All confirmation flow
- The `showClearConfirm` state already exists — reuse it, but ensure the confirm action dispatches to the right handler

---

### Task 3: Improve "Log as new" CTA label clarity
**Linear Issue:** [FOO-840](https://linear.app/lw-claude/issue/FOO-840/log-as-new-cta-label-unclear-when-food-matches-are-shown)
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**Steps:**
1. **RED:** Write test that renders `FoodAnalyzer` with an analysis and matches present, and asserts the CTA button text is "Log as new food" (not "Log as new"). Also assert there is contextual text near the matches section explaining the reuse option (e.g., a paragraph with text mentioning "previously logged" or "reuse").
2. Run `npx vitest run "food-analyzer"` (expect fail)
3. **GREEN:** In `src/components/food-analyzer.tsx:802`, change `"Log as new"` to `"Log as new food"`. In the matches section (around line 747), add a brief subtitle below "Similar foods you've logged before" explaining the action, e.g., "Tap a match to reuse it, or log as a new food with the button below."
4. Run `npx vitest run "food-analyzer"` (expect pass)

**Notes:**
- Keep the change minimal — just improve the label text and add a one-liner explanation
- The "Similar foods you've logged before" heading at line 748 stays; the explanation goes below it

---

### Task 4: Add cancel button during food analysis
**Linear Issue:** [FOO-839](https://linear.app/lw-claude/issue/FOO-839/no-cancel-button-during-in-progress-food-analysis)
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**Steps:**
1. **RED:** Write test that renders `FoodAnalyzer` in loading state and asserts a "Cancel" button is visible. Clicking it should abort the analysis (check that loading state clears) but photos and description should remain.
2. Run `npx vitest run "food-analyzer"` (expect fail)
3. **GREEN:** In `src/components/food-analyzer.tsx`, add a cancel handler that aborts the in-flight request via `abortControllerRef.current.abort()`, clears loading state, but preserves photos and description (do NOT call `resetAnalysisState` since that clears analysis too — just abort and set `loading` to false). In the sticky CTA area (around line 788), when `loading || compressing` is true, show a secondary "Cancel" button below or beside the "Analyzing..." button. The cancel button should call the cancel handler.
4. Run `npx vitest run "food-analyzer"` (expect pass)
5. **Edge case test:** Write test that after canceling, the CTA reverts to "Analyze Food" so the user can retry. This should already work since `analysis` will still be null after cancel.

**Notes:**
- The abort is already handled gracefully in the catch block at `food-analyzer.tsx:333` — `AbortError` returns silently. The `finally` block at line 351 clears loading state and nulls the abortControllerRef. So aborting the controller is sufficient.
- Cancel should NOT clear photos, description, or any user input — only the in-flight request
- Place the cancel button as a `variant="ghost"` button below the primary CTA in the sticky bar

---

### Task 5: Add re-analyze button after analysis completes
**Linear Issue:** [FOO-838](https://linear.app/lw-claude/issue/FOO-838/no-way-to-re-analyze-after-initial-analysis-completes)
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**Steps:**
1. **RED:** Write test that renders `FoodAnalyzer` with a completed analysis and asserts a "Re-analyze" button is visible (secondary to the "Log to Fitbit" CTA). Clicking it should trigger `handleAnalyze` (which clears previous analysis via `resetAnalysisState` internally at the start and runs a new analysis).
2. Run `npx vitest run "food-analyzer"` (expect fail)
3. **GREEN:** In the post-analysis controls section (around line 722), add a "Re-analyze" button using `RotateCcw` icon. Place it in the button group near "Refine with chat" (around line 736). Use `variant="outline"` and the same `w-full min-h-[44px]` pattern. The button calls `handleAnalyze` directly — the analyze function already handles clearing previous state.
4. Run `npx vitest run "food-analyzer"` (expect pass)
5. **Edge case test:** Verify the re-analyze button is disabled when `!canAnalyze` (e.g., during loading, or when no photos/description exist).

**Notes:**
- The re-analyze button is secondary — keep "Log to Fitbit" as the primary CTA in the sticky bar
- `handleAnalyze` already works for re-analysis: it compresses images again and sends a new request. The streaming event handler at line 272 sets the new analysis when it arrives.
- `handleAnalyze` does NOT call `resetAnalysisState` at the start — it sets `error` and `logError` to null but doesn't clear `analysis`. The old analysis shows until the new one arrives from the stream. This is acceptable UX.

---

### Task 6: Replace confidence badge Tooltip with Popover for mobile
**Linear Issue:** [FOO-837](https://linear.app/lw-claude/issue/FOO-837/confidence-badge-tooltip-inaccessible-on-mobile-hover-only)
**Files:**
- `src/components/confidence-badge.tsx` (modify)
- `src/components/__tests__/confidence-badge.test.tsx` (modify)

**Steps:**
1. **RED:** Write test that renders `ConfidenceBadge` with `confidence="medium"`, clicks the trigger button, and asserts the explanation text appears. Currently using Tooltip which doesn't respond to click — test should verify the explanation is accessible via click/tap.
2. Run `npx vitest run "confidence-badge"` (expect fail — Tooltip doesn't show on click in JSDOM)
3. **GREEN:** In `src/components/confidence-badge.tsx`, replace the `Tooltip`/`TooltipTrigger`/`TooltipContent` with `Popover`/`PopoverTrigger`/`PopoverContent` from `@/components/ui/popover`. Popover works on both click (mobile) and can be configured to work on hover (desktop). Keep the button trigger and `min-h-[44px]` touch target. The popover content shows the confidence explanation text.
4. Run `npx vitest run "confidence-badge"` (expect pass)
5. Verify the popover content uses `max-w-xs` like the current tooltip for consistent sizing.

**Notes:**
- Radix Popover opens on click by default, which is exactly what mobile needs
- The existing `cursor-help` style on the trigger can remain
- Remove the `TooltipProvider` import — not needed with Popover
- Check if `@/components/ui/popover` exists (shadcn component). If not, generate it with `npx shadcn@latest add popover`

---

### Task 7: Enlarge photo remove button touch targets
**Linear Issue:** [FOO-836](https://linear.app/lw-claude/issue/FOO-836/photo-remove-buttons-too-small-for-mobile-touch-targets-24x24px)
**Files:**
- `src/components/photo-capture.tsx` (modify)
- `src/components/__tests__/photo-capture.test.tsx` (modify)

**Steps:**
1. **RED:** Write test that renders `PhotoCapture` with photos and asserts the remove buttons have `min-h-[44px]` and `min-w-[44px]` classes (or equivalent 44px touch target).
2. Run `npx vitest run "photo-capture"` (expect fail — buttons are `w-6 h-6`)
3. **GREEN:** In `src/components/photo-capture.tsx`, update both remove button instances:
   - Line 415 (restored photos): Change from `w-6 h-6` to a larger touch target. Use the approach of keeping the visual circle small but expanding the tappable area with padding. Change to `w-8 h-8 p-1` for the visible button, and wrap with a `min-w-[44px] min-h-[44px]` touch area using `flex items-center justify-center` positioning. The visual X icon stays at `h-3.5 w-3.5`.
   - Line 487 (fresh photos): Same change.
4. Run `npx vitest run "photo-capture"` (expect pass)
5. Verify that the enlarged touch target doesn't overlap the entire photo tile in a confusing way — the button should be positioned at `top-0 right-0` with padding that creates a larger hit area extending inward.

**Notes:**
- Pattern: Keep visual size small (visible button at ~32px with icon), but expand the tappable container to 44x44px. Use `absolute top-0 right-0` positioning with the container being the 44px touch target.
- Both restored and fresh photo grids need the same fix — there are two identical button patterns in the file.

---

### Task 8: Move History from bottom nav to Home screen
**Linear Issue:** [FOO-832](https://linear.app/lw-claude/issue/FOO-832/move-history-from-bottom-nav-to-a-button-on-the-home-screen)
**Files:**
- `src/components/bottom-nav.tsx` (modify)
- `src/lib/navigation.ts` (modify)
- `src/components/dashboard-shell.tsx` (modify)
- `src/components/__tests__/bottom-nav.test.tsx` (modify)

**Steps:**
1. **RED:** Write/update tests in `src/components/__tests__/bottom-nav.test.tsx`:
   - Assert bottom nav has exactly 4 items (not 5)
   - Assert "History" is NOT in the nav items
   - Assert the remaining items are Home, Analyze, Quick Select, Chat
   - Assert the active indicator width is `25%` (was `20%`)
2. Run `npx vitest run "bottom-nav"` (expect fail — currently 5 items)
3. **GREEN:** In `src/components/bottom-nav.tsx`:
   - Remove the History entry from `navItems` array (lines 15-19)
   - Remove the `Clock` import if no longer used
4. In `src/lib/navigation.ts`:
   - Remove `"/app/history"` from `TAB_PATHS` array — this updates swipe navigation order
5. Run `npx vitest run "bottom-nav"` (expect pass)
6. **RED:** Write test for dashboard-shell that asserts a History button/link is rendered pointing to `/app/history`, with a `Clock` icon and descriptive text.
7. Run `npx vitest run "dashboard-shell"` (expect fail)
8. **GREEN:** In `src/components/dashboard-shell.tsx`, add a History button/link component above or near the existing content. Use a full-width card-style button with `Clock` icon, "History" title, and "View past logged meals" subtitle. Link to `/app/history`. Follow the card pattern used elsewhere in the dashboard (look at what `DashboardShell` renders). Use `min-h-[44px]` touch target.
9. Run `npx vitest run "dashboard-shell"` (expect pass)

**Notes:**
- The History page route (`src/app/app/history/page.tsx`) stays — only the entry point moves
- Swipe navigation via `src/hooks/use-swipe-navigation.ts` will automatically update because it reads from `TAB_PATHS`
- The dashboard-shell likely contains the daily dashboard content — read it first to determine the best placement for the History button

---

### Task 9: Increase Claude API 529 retry delays
**Linear Issue:** [FOO-834](https://linear.app/lw-claude/issue/FOO-834/claude-api-529-retry-backoff-too-aggressive-increase-delays)
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**Steps:**
1. **RED:** Write/update test that verifies `RETRY_DELAYS_MS` has values `[2000, 5000, 10000]` and `createStreamWithRetry` defaults to `maxRetries = 3`. If the test file doesn't exist, check for existing claude tests and follow their pattern.
2. Run `npx vitest run "claude"` (expect fail — currently `[1000, 3000]` and `maxRetries = 2`)
3. **GREEN:** In `src/lib/claude.ts`:
   - Line 261: Change `RETRY_DELAYS_MS = [1000, 3000]` to `[2000, 5000, 10000]`
   - Line 277: Change `maxRetries = 2` to `maxRetries = 3`
4. Run `npx vitest run "claude"` (expect pass)
5. **Edge case test:** Verify the fallback delay (`RETRY_DELAYS_MS[attempt] ?? 3000` at line 291) still works correctly when `attempt` exceeds the array length. With 3 entries and `maxRetries = 3`, the max attempt index is 2, which is within bounds.

**Notes:**
- Simple constant change — no logic changes needed
- Per Anthropic docs, 529 errors are server-side and not billable, so longer waits cost nothing
- The SDK-level `maxRetries: 2` at line 23 is separate (HTTP-level retries before stream starts) — leave it unchanged

---

### Task 10: Filter Sentry Anthropic SDK overloaded error noise
**Linear Issue:** [FOO-833](https://linear.app/lw-claude/issue/FOO-833/sentry-anthropic-sdk-auto-instrumentation-double-reports-overloaded)
**Files:**
- `src/instrumentation.ts` (modify)
- `src/lib/__tests__/sentry-filters.test.ts` (create)

**Steps:**
1. **RED:** Write test in `src/lib/__tests__/sentry-filters.test.ts` that tests a `shouldDropOverloadedSdkError` filter function. The function receives a Sentry event-like object and returns `true` when the event has mechanism `auto.ai.anthropic.stream_error` AND the exception message contains `overloaded_error`. Returns `false` for other events.
2. Run `npx vitest run "sentry-filters"` (expect fail)
3. **GREEN:** Create the filter function in `src/lib/sentry-filters.ts`. The function checks `event.exception?.values?.[0]?.mechanism?.type` for `auto.ai.anthropic.stream_error` and `event.exception?.values?.[0]?.value` for `overloaded_error`.
4. Run `npx vitest run "sentry-filters"` (expect pass)
5. **RED:** Write test that the Sentry `init` call in server config includes a `beforeSend` option (integration test may be difficult — a unit test of the filter function from step 1 is sufficient).
6. **GREEN:** In `src/instrumentation.ts`, add `beforeSend` to the server-side `Sentry.init` call (line 5-22). The `beforeSend` callback calls the filter function and returns `null` (drop) when it matches, otherwise returns the event unchanged.
7. Manually verify by reviewing the code — the filter must not drop the app-level error (FOOD-SCANNER-E) which uses mechanism `auto.log.pino`, only the SDK-level noise (FOOD-SCANNER-D) which uses `auto.ai.anthropic.stream_error`.

**Notes:**
- After deploying, resolve FOOD-SCANNER-D in Sentry manually
- Keep FOOD-SCANNER-E — that's the meaningful signal (app-level error after all retries exhausted)
- The filter is intentionally narrow — only drops overloaded errors from the Anthropic SDK auto-instrumentation, nothing else

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix 10 backlog issues spanning iOS Safari zoom bugs, UX improvements (cancel/re-analyze/clear confirmation), mobile accessibility (touch targets, tooltip-to-popover), navigation restructuring, and reliability improvements (retry backoff, Sentry noise filtering).
**Linear Issues:** FOO-835, FOO-842, FOO-840, FOO-839, FOO-838, FOO-837, FOO-836, FOO-832, FOO-834, FOO-833
**Approach:** Tackle issues in dependency order — foundational fixes first (iOS zoom, touch targets), then UX improvements (cancel, re-analyze, CTA labels), then structural changes (nav restructure), and finally backend reliability (retry delays, Sentry filters). All tasks are independent and can be parallelized by workers.
**Scope:** 10 tasks, ~15 files, ~15 tests
**Key Decisions:**
- Use `text-base` (16px) for all mobile text inputs to prevent iOS auto-zoom, plus `maximumScale: 1` viewport safeguard
- Replace Radix Tooltip with Popover for confidence badge (Popover works on click for mobile)
- Expand photo remove button touch area to 44x44px while keeping visual size small
- History button goes in DashboardShell on Home screen, removed from bottom nav and swipe nav
- Increase retry delays to `[2000, 5000, 10000]` with 3 retries per Anthropic recommendations
- Sentry filter targets only `auto.ai.anthropic.stream_error` + `overloaded_error` — narrow and safe
**Risks:**
- FOO-832 (nav restructure) touches multiple components — ensure swipe nav, active indicator, and bottom nav spacing all adjust correctly
- FOO-835 viewport `maximumScale: 1` disables pinch-zoom — acceptable for PWA but verify no accessibility concerns
- FOO-839 cancel button must not clear user state (photos/description) — only abort the in-flight request

---

## Iteration 1

**Implemented:** 2026-03-06
**Method:** Agent team (4 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Fix iOS Safari auto-zoom on input focus [FOO-835] - Changed text-sm→text-base on textarea/date inputs, added maximumScale:1 and userScalable:false to viewport (worker-3)
- Task 2: Add confirmation dialog for restored photos Clear All [FOO-842] - Reused existing AlertDialog with dynamic dispatch for restored vs fresh photos (worker-2)
- Task 3: Improve "Log as new" CTA label clarity [FOO-840] - Changed "Log as new" → "Log as new food", added contextual text below matches heading (worker-1)
- Task 4: Add cancel button during food analysis [FOO-839] - Added ghost Cancel button in sticky CTA bar during loading/compression, aborts in-flight request while preserving photos/description (worker-1)
- Task 5: Add re-analyze button after analysis completes [FOO-838] - Added outline Re-analyze button with RotateCcw icon alongside Refine with chat (worker-1)
- Task 6: Replace confidence badge Tooltip with Popover for mobile [FOO-837] - Replaced Radix Tooltip with Popover for click-to-show on mobile, created shadcn/ui popover.tsx (worker-4)
- Task 7: Enlarge photo remove button touch targets [FOO-836] - Expanded touch targets to 44x44px min while keeping visual size compact (worker-2)
- Task 8: Move History from bottom nav to Home screen [FOO-832] - Removed History from navItems and TAB_PATHS, added History card link in DashboardShell (worker-3)
- Task 9: Increase Claude API 529 retry delays [FOO-834] - Changed delays from [1000, 3000] to [2000, 5000, 10000], maxRetries from 2 to 3 (worker-4)
- Task 10: Filter Sentry Anthropic SDK overloaded error noise [FOO-833] - Created sentry-filters.ts with beforeSend filter in instrumentation.ts (worker-4)

### Files Modified
- `src/components/food-analyzer.tsx` - CTA label, cancel button, re-analyze button, AbortController moved earlier
- `src/components/__tests__/food-analyzer.test.tsx` - Tests for cancel, re-analyze, CTA label changes
- `src/components/photo-capture.tsx` - Restored photos clear confirmation, touch targets, handleClearRestoredPhotos fix
- `src/components/__tests__/photo-capture.test.tsx` - Tests for clear confirmation, touch targets
- `src/components/confidence-badge.tsx` - Tooltip → Popover
- `src/components/__tests__/confidence-badge.test.tsx` - Click-based popover tests
- `src/components/ui/popover.tsx` - New shadcn/ui Popover component
- `src/components/__tests__/analysis-result.test.tsx` - Updated tooltip tests → popover tests
- `src/components/description-input.tsx` - text-sm → text-base
- `src/components/__tests__/description-input.test.tsx` - New test for text-base class
- `src/components/food-history.tsx` - text-sm → text-base on date input
- `src/app/layout.tsx` - Viewport maximumScale:1, userScalable:false
- `src/components/bottom-nav.tsx` - Removed History from navItems
- `src/components/__tests__/bottom-nav.test.tsx` - Updated for 4 nav items
- `src/lib/navigation.ts` - Removed /app/history from TAB_PATHS
- `src/components/dashboard-shell.tsx` - Added History card link
- `src/components/__tests__/dashboard-shell.test.tsx` - New test for History link
- `src/hooks/__tests__/use-swipe-navigation.test.ts` - Updated for 4 tabs (removed /app/history)
- `src/lib/claude.ts` - Retry delays and maxRetries
- `src/lib/__tests__/claude.test.ts` - Updated timer advances for new delays
- `src/lib/__tests__/claude-retry.test.ts` - New source-level retry constant tests
- `src/lib/sentry-filters.ts` - New filter function for Anthropic SDK overloaded errors
- `src/lib/__tests__/sentry-filters.test.ts` - Tests for filter function
- `src/instrumentation.ts` - Added beforeSend filter

### Linear Updates
- FOO-835: Todo → In Progress → Review
- FOO-842: Todo → In Progress → Review
- FOO-840: Todo → In Progress → Review
- FOO-839: Todo → In Progress → Review
- FOO-838: Todo → In Progress → Review
- FOO-837: Todo → In Progress → Review
- FOO-836: Todo → In Progress → Review
- FOO-832: Todo → In Progress → Review
- FOO-834: Todo → In Progress → Review
- FOO-833: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 4 bugs (1 HIGH, 2 MEDIUM, 1 LOW). Fixed HIGH (Cancel button no-op during compression — moved AbortController creation before compression) and LOW (handleClearRestoredPhotos missing setShowClearConfirm). Skipped 2 MEDIUM: raw API error message in UI (pre-existing), source-parsing test approach (not a runtime bug).
- verifier: All 2622 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 3, 4, 5 (food-analyzer CTA/controls domain)
- Worker 2: Tasks 2, 7 (photo-capture UX domain)
- Worker 3: Tasks 1, 8 (navigation/layout domain)
- Worker 4: Tasks 9, 10, 6 (backend reliability + confidence badge)

### Merge Summary
- Worker 4: fast-forward (first merge, no conflicts)
- Worker 2: clean merge (no conflicts), typecheck passed
- Worker 1: clean merge (no conflicts), typecheck passed
- Worker 3: clean merge (no conflicts), typecheck passed
- Post-merge: Fixed 19 integration test failures (swipe nav tests referenced removed /app/history path, analysis-result tests referenced old Tooltip behavior)

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 24
Reviewers: security, reliability, quality (agent team)
Checks applied: Security (OWASP), Logic, Async, Resources, Type Safety, Conventions, Logging, Test Quality

No issues found - all implementations are correct and follow project conventions.

**Discarded findings (not bugs):**
- [DISCARDED] [low] ASYNC: `r.json()` instead of `safeResponseJson(r)` in find-matches fetch (`src/components/food-analyzer.tsx:291`) — This is a non-blocking best-effort match search. The catch block explicitly handles errors silently by design. If the response isn't JSON, matches simply don't show — acceptable degradation for an optional enhancement.
- [DISCARDED] [low] RESOURCE: Untracked `setTimeout` in photo-capture (`src/components/photo-capture.tsx:192`) — React 18+ treats state updates on unmounted components as no-ops. No crash, no leak, no incorrect behavior.
- [DISCARDED] [low] EDGE CASE: `handleRemovePhoto` out-of-bounds index (`src/components/photo-capture.tsx:269-270`) — `URL.revokeObjectURL(undefined)` is a no-op per spec, and `Array.filter` produces correct results. Requires a programming error elsewhere to trigger.

### Linear Updates
- FOO-835: Review → Merge
- FOO-842: Review → Merge
- FOO-840: Review → Merge
- FOO-839: Review → Merge
- FOO-838: Review → Merge
- FOO-837: Review → Merge
- FOO-836: Review → Merge
- FOO-832: Review → Merge
- FOO-834: Review → Merge
- FOO-833: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
