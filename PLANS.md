# Implementation Plan

**Created:** 2026-02-05
**Source:** Inline request: UX improvements from comprehensive review (all except sound and recent food)
**Linear Issues:** [FOO-65](https://linear.app/lw-claude/issue/FOO-65), [FOO-66](https://linear.app/lw-claude/issue/FOO-66), [FOO-67](https://linear.app/lw-claude/issue/FOO-67), [FOO-68](https://linear.app/lw-claude/issue/FOO-68), [FOO-69](https://linear.app/lw-claude/issue/FOO-69), [FOO-70](https://linear.app/lw-claude/issue/FOO-70), [FOO-71](https://linear.app/lw-claude/issue/FOO-71), [FOO-72](https://linear.app/lw-claude/issue/FOO-72), [FOO-73](https://linear.app/lw-claude/issue/FOO-73), [FOO-74](https://linear.app/lw-claude/issue/FOO-74), [FOO-75](https://linear.app/lw-claude/issue/FOO-75), [FOO-76](https://linear.app/lw-claude/issue/FOO-76), [FOO-77](https://linear.app/lw-claude/issue/FOO-77), [FOO-78](https://linear.app/lw-claude/issue/FOO-78), [FOO-79](https://linear.app/lw-claude/issue/FOO-79), [FOO-80](https://linear.app/lw-claude/issue/FOO-80), [FOO-81](https://linear.app/lw-claude/issue/FOO-81), [FOO-82](https://linear.app/lw-claude/issue/FOO-82), [FOO-83](https://linear.app/lw-claude/issue/FOO-83), [FOO-84](https://linear.app/lw-claude/issue/FOO-84)

## Context Gathered

### Codebase Analysis
- **Main workflow component:** `src/components/food-analyzer.tsx` - orchestrates entire flow
- **Photo handling:** `src/components/photo-capture.tsx` - camera/gallery, HEIC conversion
- **Analysis display:** `src/components/analysis-result.tsx` - loading, error, results
- **Editor:** `src/components/nutrition-editor.tsx` - manual editing of values
- **Confirmation:** `src/components/food-log-confirmation.tsx` - success state
- **Settings:** `src/app/settings/page.tsx` - session info, Fitbit reconnect, logout
- **App header:** `src/app/app/page.tsx` - text link to settings
- **UI components:** `src/components/ui/` - button, input, label, select (shadcn/ui)
- **Test conventions:** `__tests__/` subdirectories with `.test.tsx` files

### UX Issues Identified (from review)
1. No visual feedback during image compression before analysis
2. Destructive "Clear All" without confirmation
3. Edit mode loses changes on regenerate without warning
4. Settings link buried as text in header
5. No haptic feedback on mobile
6. No keyboard shortcuts
7. Meal type default not communicated to user
8. Inconsistent button hierarchy post-analysis
9. No first-time user guidance
10. Confidence indicator not explained
11. Loading spinner is generic (no progress steps)
12. Photo previews not zoomable
13. No dark mode toggle
14. No animation on state transitions
15. Settings page loads session on every mount
16. Portion size input awkward (no quick-select)
17. Missing aria-live for dynamic content
18. Focus not managed after actions
19. Color-only confidence indicator (accessibility)
20. No skip links

### Exclusions (per user request)
- No success sound
- No recent foods list

### MCP Context
- **Linear MCP:** Connected (verified via list_teams)
- **Team:** Food Scanner (ID: 3e498d7a-30d2-4c11-89b3-ed7bd8cb2031)

## Original Plan

### Task 1: Add image compression loading state
**Linear Issue:** [FOO-65](https://linear.app/lw-claude/issue/FOO-65/add-image-compression-loading-state)

Add visual feedback during image compression before AI analysis begins.

1. Write test in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test "Preparing images..." state appears before "Analyzing..."
   - Test loading state shows during compression phase
2. Run verifier (expect fail)
3. Update `src/components/food-analyzer.tsx`:
   - Add `compressing` state boolean
   - Set `compressing=true` before `Promise.all(photos.map(compressImage))`
   - Set `compressing=false` after compression completes
   - Update button text: "Preparing images..." when compressing
4. Run verifier (expect pass)

### Task 2: Add confirmation dialog for Clear All
**Linear Issue:** [FOO-66](https://linear.app/lw-claude/issue/FOO-66/add-confirmation-dialog-for-clear-all-photos)

Prevent accidental photo deletion with confirmation when 2+ photos selected.

1. Write test in `src/components/__tests__/photo-capture.test.tsx`:
   - Test clicking Clear All with 1 photo clears immediately
   - Test clicking Clear All with 2+ photos shows confirmation
   - Test confirming dialog clears photos
   - Test canceling dialog keeps photos
2. Run verifier (expect fail)
3. Create `src/components/ui/alert-dialog.tsx` (shadcn/ui AlertDialog)
4. Update `src/components/photo-capture.tsx`:
   - Import AlertDialog components
   - Add `showClearConfirm` state
   - Show confirmation when photos.length >= 2
   - Clear immediately when photos.length === 1
5. Run verifier (expect pass)

### Task 3: Warn before regenerate discards edits
**Linear Issue:** [FOO-67](https://linear.app/lw-claude/issue/FOO-67/warn-before-regenerate-discards-edits)

Warn users when clicking Regenerate will discard their manual edits.

1. Write test in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test regenerate without edits proceeds immediately
   - Test regenerate with edits shows warning dialog
   - Test confirming regenerate discards edits and re-analyzes
   - Test canceling regenerate keeps edits
2. Run verifier (expect fail)
3. Update `src/components/food-analyzer.tsx`:
   - Add `showRegenerateConfirm` state
   - Check if `editedAnalysis` differs from `analysis` before regenerate
   - Show AlertDialog when edits exist
   - Proceed directly when no edits
4. Run verifier (expect pass)

### Task 4: Replace settings text link with icon button
**Linear Issue:** [FOO-68](https://linear.app/lw-claude/issue/FOO-68/replace-settings-text-link-with-icon-button)

Make settings more discoverable with a gear icon button.

1. Write test in `src/app/app/__tests__/page.test.tsx`:
   - Test settings button is rendered with accessible name
   - Test settings button has proper aria-label
   - Test settings button meets 44px touch target
2. Run verifier (expect fail)
3. Update `src/app/app/page.tsx`:
   - Replace Link with Button using asChild
   - Add Settings icon from lucide-react
   - Add aria-label="Settings"
   - Add min-h-[44px] min-w-[44px] for touch target
4. Run verifier (expect pass)

### Task 5: Add haptic feedback on mobile actions
**Linear Issue:** [FOO-69](https://linear.app/lw-claude/issue/FOO-69/add-haptic-feedback-on-mobile-actions)

Add vibration feedback for success and error states on mobile.

1. Write test in `src/lib/__tests__/haptics.test.ts`:
   - Test vibrate success pattern
   - Test vibrate error pattern
   - Test graceful handling when Vibration API unavailable
2. Run verifier (expect fail)
3. Create `src/lib/haptics.ts`:
   - Export `vibrateSuccess()` - 200ms vibration
   - Export `vibrateError()` - [100, 50, 100] pattern
   - Check `navigator.vibrate` exists before calling
4. Update `src/components/food-analyzer.tsx`:
   - Call `vibrateSuccess()` after successful log
   - Call `vibrateError()` on log/analyze errors
5. Update `src/components/food-log-confirmation.tsx`:
   - Call `vibrateSuccess()` on mount
6. Run verifier (expect pass)

### Task 6: Add keyboard shortcuts for common actions
**Linear Issue:** [FOO-70](https://linear.app/lw-claude/issue/FOO-70/add-keyboard-shortcuts-for-common-actions)

Add keyboard shortcuts for power users.

1. Write test in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test Ctrl+Enter triggers analyze when photos present
   - Test Ctrl+Shift+Enter triggers log when analysis present
   - Test Escape exits edit mode
2. Run verifier (expect fail)
3. Create `src/hooks/use-keyboard-shortcuts.ts`:
   - Custom hook for keyboard event handling
   - Handle Ctrl+Enter (analyze)
   - Handle Ctrl+Shift+Enter (log to Fitbit)
   - Handle Escape (exit edit mode)
4. Update `src/components/food-analyzer.tsx`:
   - Use the keyboard shortcuts hook
   - Wire up to existing handlers
5. Run verifier (expect pass)

### Task 7: Show meal type time-based hint
**Linear Issue:** [FOO-71](https://linear.app/lw-claude/issue/FOO-71/show-meal-type-time-based-hint)

Explain why a specific meal type is pre-selected.

1. Write test in `src/components/__tests__/meal-type-selector.test.tsx`:
   - Test helper text shows current time context
   - Test helper text updates with time
2. Run verifier (expect fail)
3. Update `src/components/meal-type-selector.tsx`:
   - Add optional `showTimeHint` prop (default true)
   - Add helper text below selector showing current time
   - Format: "Based on current time (7:15 PM)"
4. Run verifier (expect pass)

### Task 8: Fix button hierarchy post-analysis
**Linear Issue:** [FOO-72](https://linear.app/lw-claude/issue/FOO-72/fix-button-hierarchy-post-analysis)

Make "Log to Fitbit" the clear primary action.

1. Write test in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test "Log to Fitbit" uses default (primary) variant
   - Test "Edit Manually" uses ghost variant
   - Test "Regenerate" uses ghost variant
2. Run verifier (expect fail)
3. Update `src/components/food-analyzer.tsx`:
   - Change "Edit Manually" to `variant="ghost"`
   - Change "Regenerate" to `variant="ghost"`
   - Keep "Log to Fitbit" as default (primary) variant
4. Run verifier (expect pass)

### Task 9: Add first-time user guidance
**Linear Issue:** [FOO-73](https://linear.app/lw-claude/issue/FOO-73/add-first-time-user-guidance)

Show inline tips for new users on workflow.

1. Write test in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test tips show when no photos and no analysis
   - Test tips hidden after photos added
2. Run verifier (expect fail)
3. Update `src/components/food-analyzer.tsx`:
   - Add guidance section when photos.length === 0 && !analysis
   - Show numbered steps: "1. Take a photo → 2. Add description → 3. Log to Fitbit"
   - Use muted-foreground styling
4. Run verifier (expect pass)

### Task 10: Add confidence indicator tooltip
**Linear Issue:** [FOO-74](https://linear.app/lw-claude/issue/FOO-74/add-confidence-indicator-tooltip)

Explain what confidence levels mean with a tooltip.

1. Write test in `src/components/__tests__/analysis-result.test.tsx`:
   - Test tooltip appears on confidence indicator hover/tap
   - Test tooltip has explanation text
2. Run verifier (expect fail)
3. Create `src/components/ui/tooltip.tsx` (shadcn/ui Tooltip)
4. Update `src/components/analysis-result.tsx`:
   - Wrap confidence indicator in Tooltip
   - Add content explaining confidence levels
5. Update `src/components/nutrition-editor.tsx`:
   - Same tooltip treatment for consistency
6. Run verifier (expect pass)

### Task 11: Add multi-step loading progress
**Linear Issue:** [FOO-75](https://linear.app/lw-claude/issue/FOO-75/add-multi-step-loading-progress)

Show progress steps during AI analysis.

1. Write test in `src/components/__tests__/analysis-result.test.tsx`:
   - Test loading shows step text
   - Test step text updates (mock timing)
2. Run verifier (expect fail)
3. Update `src/components/analysis-result.tsx`:
   - Add `loadingStep` prop (optional)
   - Show step text: "Reading images...", "Identifying food...", "Calculating nutrition..."
4. Update `src/components/food-analyzer.tsx`:
   - Add `loadingStep` state
   - Update step during compression/analysis phases
   - Pass to AnalysisResult
5. Run verifier (expect pass)

### Task 12: Add photo preview zoom
**Linear Issue:** [FOO-76](https://linear.app/lw-claude/issue/FOO-76/add-photo-preview-zoom)

Allow tapping thumbnails to see full-screen preview.

1. Write test in `src/components/__tests__/photo-capture.test.tsx`:
   - Test tapping preview opens full-screen view
   - Test full-screen view shows close button
   - Test close button returns to normal view
2. Run verifier (expect fail)
3. Create `src/components/ui/dialog.tsx` (shadcn/ui Dialog) if not exists
4. Create `src/components/photo-preview-dialog.tsx`:
   - Full-screen image display
   - Close button
   - Basic styling
5. Update `src/components/photo-capture.tsx`:
   - Make preview images clickable
   - Open PhotoPreviewDialog on click
   - Pass selected preview URL
6. Run verifier (expect pass)

### Task 13: Add dark mode toggle
**Linear Issue:** [FOO-77](https://linear.app/lw-claude/issue/FOO-77/add-dark-mode-toggle)

Allow manual dark mode control in settings.

1. Write test in `src/app/settings/__tests__/page.test.tsx`:
   - Test dark mode toggle is rendered
   - Test toggle changes theme
   - Test preference persists in localStorage
2. Run verifier (expect fail)
3. Create `src/hooks/use-theme.ts`:
   - Custom hook for theme management
   - Read/write localStorage
   - Apply class to document.documentElement
4. Update `src/app/settings/page.tsx`:
   - Add "Appearance" section
   - Add toggle for dark/light/system
5. Run verifier (expect pass)

### Task 14: Add state transition animations
**Linear Issue:** [FOO-78](https://linear.app/lw-claude/issue/FOO-78/add-state-transition-animations)

Smooth transitions between workflow steps.

1. Write test in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test transition classes applied during state changes
2. Run verifier (expect fail)
3. Update `src/app/globals.css`:
   - Add fade-in animation keyframe
   - Add slide-up animation keyframe
4. Update `src/components/food-analyzer.tsx`:
   - Add animation classes to state containers
   - Use `animate-fade-in` for appearing elements
5. Update `src/components/food-log-confirmation.tsx`:
   - Add entrance animation
6. Run verifier (expect pass)

### Task 15: Cache session in settings page
**Linear Issue:** [FOO-79](https://linear.app/lw-claude/issue/FOO-79/cache-session-in-settings-page)

Avoid loading spinner on every settings page visit.

1. Write test in `src/app/settings/__tests__/page.test.tsx`:
   - Test cached session shows immediately
   - Test stale session triggers background refresh
2. Run verifier (expect fail)
3. Install SWR if not present: `npm install swr`
4. Update `src/app/settings/page.tsx`:
   - Use SWR with stale-while-revalidate pattern
   - Show cached data immediately
   - Revalidate in background
5. Run verifier (expect pass)

### Task 16: Add portion size quick-select buttons
**Linear Issue:** [FOO-80](https://linear.app/lw-claude/issue/FOO-80/add-portion-size-quick-select-buttons)

Add Small/Medium/Large quick-select for portions.

1. Write test in `src/components/__tests__/nutrition-editor.test.tsx`:
   - Test clicking "Small" sets portion to 100g
   - Test clicking "Medium" sets portion to 200g
   - Test clicking "Large" sets portion to 350g
   - Test manual input still works
2. Run verifier (expect fail)
3. Update `src/components/nutrition-editor.tsx`:
   - Add row of quick-select buttons above portion input
   - Map: Small=100g, Medium=200g, Large=350g
   - Style as toggle buttons (outline when not selected)
4. Run verifier (expect pass)

### Task 17: Add aria-live regions for dynamic content
**Linear Issue:** [FOO-81](https://linear.app/lw-claude/issue/FOO-81/add-aria-live-regions-for-dynamic-content)

Announce state changes to screen readers.

1. Write test in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test aria-live="polite" on error messages
   - Test aria-live="assertive" on success state
2. Run verifier (expect fail)
3. Update `src/components/food-analyzer.tsx`:
   - Add `aria-live="polite"` to error containers
   - Add `aria-live="assertive"` to loading state
4. Update `src/components/analysis-result.tsx`:
   - Add `aria-live="polite"` to result container
5. Update `src/components/food-log-confirmation.tsx`:
   - Add `aria-live="assertive"` to success message
6. Run verifier (expect pass)

### Task 18: Manage focus after actions
**Linear Issue:** [FOO-82](https://linear.app/lw-claude/issue/FOO-82/manage-focus-after-actions)

Move focus to relevant content after state changes.

1. Write test in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test focus moves to analysis result after analysis completes
   - Test focus moves to confirmation after log succeeds
2. Run verifier (expect fail)
3. Update `src/components/food-analyzer.tsx`:
   - Add refs for analysis result and confirmation sections
   - Use `useEffect` to focus after state changes
   - Focus analysis result when `analysis` changes from null
   - Focus confirmation when `logResponse` changes from null
4. Run verifier (expect pass)

### Task 19: Add accessible confidence indicator
**Linear Issue:** [FOO-83](https://linear.app/lw-claude/issue/FOO-83/add-accessible-confidence-indicator)

Add text labels alongside color indicators for colorblind users.

1. Write test in `src/components/__tests__/analysis-result.test.tsx`:
   - Test confidence shows text label not just color
   - Test icon differs by confidence level
2. Run verifier (expect fail)
3. Update `src/components/analysis-result.tsx`:
   - Add icon next to confidence text (CheckCircle for high, AlertTriangle for medium/low)
   - Keep color as visual enhancement
4. Update `src/components/nutrition-editor.tsx`:
   - Same icon treatment for consistency
5. Run verifier (expect pass)

### Task 20: Add skip link for keyboard navigation
**Linear Issue:** [FOO-84](https://linear.app/lw-claude/issue/FOO-84/add-skip-link-for-keyboard-navigation)

Allow keyboard users to skip to main content.

1. Write test in `src/app/app/__tests__/page.test.tsx`:
   - Test skip link exists and is focusable
   - Test skip link scrolls to main content
2. Run verifier (expect fail)
3. Create `src/components/skip-link.tsx`:
   - Visually hidden but focusable link
   - Shows on focus
   - Links to #main-content
4. Update `src/app/app/page.tsx`:
   - Add SkipLink at top of page
   - Add id="main-content" to main element
5. Run verifier (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Improve UX across all screens with accessibility, feedback, and polish enhancements

**Request:** Implement all UX improvements from the comprehensive review except sound effects and recent foods list

**Linear Issues:** FOO-65, FOO-66, FOO-67, FOO-68, FOO-69, FOO-70, FOO-71, FOO-72, FOO-73, FOO-74, FOO-75, FOO-76, FOO-77, FOO-78, FOO-79, FOO-80, FOO-81, FOO-82, FOO-83, FOO-84

**Approach:** Incremental TDD implementation of UX improvements, starting with critical issues (visual feedback, confirmations), then major workflow improvements (settings icon, keyboard shortcuts, haptics), followed by polish items (animations, caching) and accessibility (aria-live, focus management, skip links). Each task is self-contained with full file paths and clear acceptance criteria.

**Scope:**
- Tasks: 20
- Files affected: ~25 (components, hooks, pages, styles)
- New tests: yes (all tasks include tests)

**Key Decisions:**
- Use shadcn/ui AlertDialog for confirmation dialogs (consistent with existing UI)
- Use SWR for session caching (industry standard, minimal bundle impact)
- Haptic feedback via Vibration API with graceful fallback
- Quick-select portion sizes: Small=100g, Medium=200g, Large=350g

**Risks/Considerations:**
- Vibration API not available on all devices - graceful degradation required
- Dark mode toggle affects entire app - needs careful testing
- Animation additions should be subtle to avoid motion sickness concerns
- SWR installation adds small bundle size (~4KB gzipped)

---

## Iteration 1

**Implemented:** 2026-02-05

### Tasks Completed This Iteration
- Task 1: Add image compression loading state - Added `compressing` state to show "Preparing images..." before "Analyzing..."
- Task 2: Add confirmation dialog for Clear All - Created AlertDialog component, shows confirmation when clearing 2+ photos
- Task 3: Warn before regenerate discards edits - Shows warning dialog when user has made edits before regenerating
- Task 4: Replace settings text link with icon button - Gear icon with proper aria-label and 44px touch target
- Task 5: Add haptic feedback on mobile actions - Created haptics utility, integrated into success/error states
- Task 6: Add keyboard shortcuts for common actions - Ctrl+Enter (analyze), Ctrl+Shift+Enter (log), Escape (exit edit)

### Tasks Remaining
- Task 7: Show meal type time-based hint
- Task 8: Fix button hierarchy post-analysis
- Task 9: Add first-time user guidance
- Task 10: Add confidence indicator tooltip
- Task 11: Add multi-step loading progress
- Task 12: Add photo preview zoom
- Task 13: Add dark mode toggle
- Task 14: Add state transition animations
- Task 15: Cache session in settings page
- Task 16: Add portion size quick-select buttons
- Task 17: Add aria-live regions for dynamic content
- Task 18: Manage focus after actions
- Task 19: Add accessible confidence indicator
- Task 20: Add skip link for keyboard navigation

### Files Modified
- `src/components/food-analyzer.tsx` - Added compressing state, regenerate warning, haptics, keyboard shortcuts
- `src/components/photo-capture.tsx` - Added clear confirmation dialog
- `src/components/food-log-confirmation.tsx` - Added haptic feedback on mount
- `src/components/ui/alert-dialog.tsx` - Created new shadcn/ui AlertDialog component
- `src/app/app/page.tsx` - Replaced settings text link with icon button
- `src/lib/haptics.ts` - Created new haptic feedback utility
- `src/hooks/use-keyboard-shortcuts.ts` - Created new keyboard shortcuts hook

### Tests Added
- `src/components/__tests__/food-analyzer.test.tsx` - Tests for compression loading, regenerate warning, keyboard shortcuts
- `src/components/__tests__/photo-capture.test.tsx` - Tests for clear confirmation dialog
- `src/app/app/__tests__/page.test.tsx` - Tests for settings icon button
- `src/lib/__tests__/haptics.test.ts` - Tests for haptic feedback utility
- `src/hooks/__tests__/use-keyboard-shortcuts.test.ts` - Tests for keyboard shortcuts hook

### Linear Updates
- FOO-65: Todo → In Progress → Review
- FOO-66: Todo → In Progress → Review
- FOO-67: Todo → In Progress → Review
- FOO-68: Todo → In Progress → Review
- FOO-69: Todo → In Progress → Review
- FOO-70: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 bugs (double haptic, escape key interference), fixed before proceeding
- verifier: All 309 tests pass, zero type errors, 1 acceptable lint warning (blob URL img)

### Continuation Status
Context running low (~35% remaining). More tasks remain.

### Review Findings

Files reviewed: 7 source files, 5 test files
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Conventions

No issues found - all implementations are correct and follow project conventions.

**Detailed Review:**

1. **`src/components/food-analyzer.tsx`**
   - Compressing state correctly toggles between "Preparing images..." and "Analyzing..."
   - Regenerate warning dialog properly checks `hasEdits` before showing confirmation
   - Haptic feedback called on errors, success delegated to confirmation component
   - Keyboard shortcuts hook properly integrated with condition guards

2. **`src/components/photo-capture.tsx`**
   - Clear confirmation shows for 2+ photos, clears immediately for 1
   - AlertDialog properly integrated with state management
   - URL.revokeObjectURL called to prevent memory leaks

3. **`src/components/food-log-confirmation.tsx`**
   - vibrateSuccess called in useEffect with response dependency
   - Properly guards against null response

4. **`src/components/ui/alert-dialog.tsx`**
   - Standard shadcn/ui component, correctly exported

5. **`src/app/app/page.tsx`**
   - Settings button uses Button with asChild, Link inside
   - Proper aria-label and 44px touch targets

6. **`src/lib/haptics.ts`**
   - Proper navigator check before vibrate calls
   - Handles both undefined navigator and missing vibrate method

7. **`src/hooks/use-keyboard-shortcuts.ts`**
   - useCallback for handler, proper dependencies
   - Event listener cleanup in useEffect return
   - Dialog check prevents Escape from interfering with modals

**Test Quality:**
- All tests have meaningful assertions
- Edge cases covered (no photos, 1 photo, 2+ photos)
- Async behavior properly awaited with waitFor
- Mocks appropriately scoped

### Linear Updates
- FOO-65: Review → Merge
- FOO-66: Review → Merge
- FOO-67: Review → Merge
- FOO-68: Review → Merge
- FOO-69: Review → Merge
- FOO-70: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Iteration 2

**Implemented:** 2026-02-05

### Tasks Completed This Iteration
- Task 7: Show meal type time-based hint - Added showTimeHint prop with current time display and 60s auto-update
- Task 8: Fix button hierarchy post-analysis - Changed "Edit Manually" and "Regenerate" to ghost variant
- Task 9: Add first-time user guidance - Added numbered steps guidance when no photos and no analysis
- Task 10: Add confidence indicator tooltip - Added shadcn/ui Tooltip with explanations for high/medium/low confidence in both AnalysisResult and NutritionEditor
- Task 11: Add multi-step loading progress - Added loadingStep prop to AnalysisResult, integrated with FoodAnalyzer

### Tasks Remaining
- Task 12: Add photo preview zoom
- Task 13: Add dark mode toggle
- Task 14: Add state transition animations
- Task 15: Cache session in settings page
- Task 16: Add portion size quick-select buttons
- Task 17: Add aria-live regions for dynamic content
- Task 18: Manage focus after actions
- Task 19: Add accessible confidence indicator
- Task 20: Add skip link for keyboard navigation

### Files Modified
- `src/components/meal-type-selector.tsx` - Added showTimeHint prop with time-based hint display
- `src/components/food-analyzer.tsx` - Changed button variants, added guidance, added loadingStep state
- `src/components/analysis-result.tsx` - Added confidence tooltip and loadingStep prop
- `src/components/nutrition-editor.tsx` - Added confidence tooltip
- `src/components/ui/tooltip.tsx` - Created new shadcn/ui Tooltip component

### Tests Added/Modified
- `src/components/__tests__/meal-type-selector.test.tsx` - Tests for time-based hint
- `src/components/__tests__/food-analyzer.test.tsx` - Tests for button hierarchy and first-time guidance
- `src/components/__tests__/analysis-result.test.tsx` - Tests for confidence tooltip and multi-step loading
- `src/components/__tests__/nutrition-editor.test.tsx` - Tests for confidence tooltip

### Linear Updates
- FOO-71: Todo → In Progress → Review
- FOO-72: Todo → In Progress → Review
- FOO-73: Todo → In Progress → Review
- FOO-74: Todo → In Progress → Review
- FOO-75: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 medium issues (loading step timing, code duplication), fixed loading step issue
- verifier: All 325 tests pass, zero type errors, 1 acceptable lint warning (blob URL img)

### Continuation Status
Context running low (~35% remaining). More tasks remain.

### Review Findings

Files reviewed: 5 source files, 4 test files
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Conventions

No issues found - all implementations are correct and follow project conventions.

**Detailed Review:**

1. **`src/components/meal-type-selector.tsx`**
   - Time hint feature correctly implemented with `showTimeHint` prop
   - useEffect interval properly cleaned up when component unmounts
   - Early return prevents interval creation when `showTimeHint=false`
   - Time format uses locale-aware `toLocaleTimeString`

2. **`src/components/food-analyzer.tsx`**
   - Button variants correctly applied: "Edit Manually" and "Regenerate" use `variant="ghost"`
   - "Log to Fitbit" remains primary (default variant)
   - First-time guidance shows only when `photos.length === 0 && !analysis`
   - `loadingStep` state properly managed during compression/analysis phases

3. **`src/components/analysis-result.tsx`**
   - Tooltip properly wraps confidence indicator
   - `loadingStep` prop with fallback to "Analyzing your food..."
   - Confidence explanations are clear and context-appropriate

4. **`src/components/nutrition-editor.tsx`**
   - Same tooltip implementation as AnalysisResult for consistency
   - Confidence colors and explanations match AnalysisResult

5. **`src/components/ui/tooltip.tsx`**
   - Standard shadcn/ui component, correctly exported

**Documented (no fix needed):**
- [MEDIUM] Code duplication: `confidenceColors` and `confidenceExplanations` are duplicated between `analysis-result.tsx` and `nutrition-editor.tsx`. Could be extracted to a shared file, but this is a style preference not affecting correctness.

**Test Quality:**
- All tests have meaningful assertions
- Edge cases covered (time updates, different confidence levels, hover/tap interactions)
- Async behavior properly tested with `waitFor` and fake timers
- Mocks appropriately scoped

### Linear Updates
- FOO-71: Review → Merge
- FOO-72: Review → Merge
- FOO-73: Review → Merge
- FOO-74: Review → Merge
- FOO-75: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Iteration 3

**Implemented:** 2026-02-05

### Tasks Completed This Iteration
- Task 12: Add photo preview zoom - Created Dialog component, PhotoPreviewDialog, made previews clickable
- Task 13: Add dark mode toggle - Created useTheme hook, added appearance section to settings page
- Task 14: Add state transition animations - Added CSS keyframes and animation classes to globals.css
- Task 15: Cache session in settings page - Installed SWR, refactored settings page to use useSWR

### Tasks Remaining
- Task 16: Add portion size quick-select buttons
- Task 17: Add aria-live regions for dynamic content
- Task 18: Manage focus after actions
- Task 19: Add accessible confidence indicator
- Task 20: Add skip link for keyboard navigation

### Files Modified
- `src/components/ui/dialog.tsx` - Created new shadcn/ui Dialog component
- `src/components/photo-preview-dialog.tsx` - Created new full-screen preview dialog
- `src/components/photo-capture.tsx` - Made previews clickable, opens dialog on click
- `src/hooks/use-theme.ts` - Created new theme management hook with hydration fix
- `src/app/settings/page.tsx` - Added dark mode toggle, refactored to use SWR
- `src/app/globals.css` - Added fade-in and slide-up animation keyframes
- `src/components/food-analyzer.tsx` - Added animation class with key prop to analysis section
- `src/components/food-log-confirmation.tsx` - Added slide-up animation
- `src/test-setup.ts` - Added window.matchMedia mock for theme tests
- `package.json` - Added SWR dependency

### Tests Added/Modified
- `src/components/__tests__/photo-capture.test.tsx` - Tests for preview zoom dialog
- `src/hooks/__tests__/use-theme.test.ts` - Tests for theme hook
- `src/app/settings/__tests__/page.test.tsx` - Tests for dark mode toggle and SWR caching
- `src/components/__tests__/food-analyzer.test.tsx` - Tests for animation class

### Linear Updates
- FOO-76: Todo → In Progress → Review
- FOO-77: Todo → In Progress → Review
- FOO-78: Todo → In Progress → Review
- FOO-79: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 medium bugs (animation key, stale preview index, hydration mismatch), all fixed
- verifier: All 340 tests pass, zero type errors, 2 acceptable lint warnings (img element)

### Continuation Status
Context running low (~35% remaining). More tasks remain.

### Review Findings

Files reviewed: 10 source files, 4 test files
Checks applied: Security, Logic, Async, Resources, Type Safety, Error Handling, Conventions

No issues found - all implementations are correct and follow project conventions.

**Detailed Review:**

1. **`src/components/ui/dialog.tsx`**
   - Standard shadcn/ui Dialog component with proper forwardRef usage
   - Accessibility: Close button has `sr-only` text for screen readers
   - Proper animation classes for open/close states

2. **`src/components/photo-preview-dialog.tsx`**
   - Early return when `imageUrl` is null prevents rendering empty dialog
   - Uses `VisuallyHidden` for DialogTitle (accessibility requirement)
   - Close button has proper `aria-label` and 44px touch target

3. **`src/components/photo-capture.tsx`**
   - Preview click opens dialog with correct index tracking
   - `doClear` properly resets dialog state

4. **`src/hooks/use-theme.ts`**
   - Hydration handled correctly: starts with "system", updates after mount
   - `useEffect` cleanup for system theme media query listener
   - `setTheme` wrapped in `useCallback` for stable reference
   - localStorage operations properly guarded with `typeof window` checks

5. **`src/app/settings/page.tsx`**
   - SWR properly configured with revalidation options
   - Theme toggle buttons have proper accessibility and touch targets
   - Error handling for failed session fetch

6. **`src/app/globals.css`**
   - Animation keyframes properly defined
   - `prefers-reduced-motion` media query respects accessibility

7. **`src/components/food-analyzer.tsx`**
   - Animation class applied conditionally with `key` prop for re-animation
   - `loadingStep` state properly managed

8. **`src/components/food-log-confirmation.tsx`**
   - `animate-slide-up` class properly applied

9. **`src/test-setup.ts`**
   - `window.matchMedia` mock properly structured for theme tests

**Test Quality:**
- All tests have meaningful assertions covering open/close, persistence, and edge cases
- SWR tests use fresh cache wrapper to prevent test interference
- Animation tests verify class application

### Linear Updates
- FOO-76: Review → Merge
- FOO-77: Review → Merge
- FOO-78: Review → Merge
- FOO-79: Review → Merge

<!-- REVIEW COMPLETE -->
