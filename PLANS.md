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
