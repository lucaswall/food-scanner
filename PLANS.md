# Implementation Plan

**Created:** 2026-03-06
**Source:** Inline request: Revamp analyze screen with seamless persistence, individual photo removal, always-visible reset, sticky CTA, and modern minimal layout
**Linear Issues:** [FOO-825](https://linear.app/lw-claude/issue/FOO-825/fix-description-persistence-create-session-on-description-input), [FOO-826](https://linear.app/lw-claude/issue/FOO-826/individual-photo-removal-with-x-badges), [FOO-827](https://linear.app/lw-claude/issue/FOO-827/tile-add-more-photo-trigger-with-dropdown-picker), [FOO-828](https://linear.app/lw-claude/issue/FOO-828/always-visible-start-over-reset-button), [FOO-829](https://linear.app/lw-claude/issue/FOO-829/sticky-bottom-cta-bar-for-analyzelog-actions), [FOO-830](https://linear.app/lw-claude/issue/FOO-830/tighter-layout-and-spacing-refinements-for-analyze-screen)
**Branch:** feat/analyze-screen-revamp

## Context Gathered

### Codebase Analysis
- **Related files:**
  - `src/components/food-analyzer.tsx` — Root analyze screen component, manages state flow and renders all sub-components
  - `src/components/photo-capture.tsx` — Photo grid, camera/gallery inputs, "Clear All" button, restored photo handling
  - `src/components/description-input.tsx` — Textarea with character counter, 500 char max
  - `src/components/analysis-result.tsx` — Analysis card with nutrition grid, streaming text, error/retry, collapsible narrative
  - `src/components/food-match-card.tsx` — Similar food cards with "Use this" button
  - `src/components/meal-type-selector.tsx` — Select dropdown for meal type with time hint
  - `src/components/time-selector.tsx` — Now/custom time toggle with hour:minute selects
  - `src/components/food-log-confirmation.tsx` — Success screen after logging
  - `src/hooks/use-analysis-session.ts` — Session persistence hook (sessionStorage + IndexedDB for photos)
  - `src/lib/analysis-session.ts` — Session storage/retrieval, TTL, IndexedDB operations
  - `src/components/bottom-nav.tsx` — Existing fixed bottom nav bar pattern (`fixed bottom-0 left-0 right-0 bg-background border-t z-50`)
  - `src/components/ui/dropdown-menu.tsx` — Radix DropdownMenu (installed, available)
  - `src/components/ui/dialog.tsx` — Dialog with custom `bottom-sheet` variant
  - `src/components/ui/alert-dialog.tsx` — Confirmation dialogs
  - `src/components/__tests__/photo-capture.test.tsx` — 1159 lines, comprehensive photo tests
  - `src/components/__tests__/food-analyzer.test.tsx` — ~4000 lines, full analyzer tests
- **Existing patterns:**
  - Fixed bottom bar: `bottom-nav.tsx` uses `fixed bottom-0 left-0 right-0 bg-background border-t z-50` with safe area insets
  - Bottom sheet: `<DialogContent variant="bottom-sheet">` pattern used in analysis-result.tsx and food-entry-detail-sheet.tsx
  - Touch targets: `min-h-[44px]` consistently used on all interactive elements
  - Photo mocks: `createMockFile()` helper, `URL.createObjectURL`/`revokeObjectURL` mocks
  - Session ID creation: `ensureSessionId()` only called in `setPhotos` — not in `setDescription`
- **Test conventions:** Colocated `__tests__/` directories, Vitest + Testing Library, mock hooks with `vi.mock`, `vi.fn()` for callbacks, `fireEvent` for user interactions, `waitFor` for async state

### MCP Context
- **MCPs used:** Linear (team verification)
- **Findings:** Team "Food Scanner" with prefix FOO-xxx confirmed. Previous related issues: FOO-817 (Start Fresh), FOO-821 (Start Fresh fix), FOO-824 (Clear All consolidation, complete).

## Tasks

### Task 1: Fix description persistence — create session on description input
**Linear Issue:** [FOO-825](https://linear.app/lw-claude/issue/FOO-825/fix-description-persistence-create-session-on-description-input)
**Files:**
- `src/hooks/__tests__/use-analysis-session.test.ts` (create if not exists, or modify)
- `src/hooks/use-analysis-session.ts` (modify)

**Steps:**
1. Write/add tests in the session hook test file:
   - Test: setting description to non-empty string when no session exists calls `createSessionId` and creates a session
   - Test: setting description to empty string does NOT create a session
   - Test: setting description when session already exists does NOT create a duplicate session
   - Test: description changes are saved via debounced `saveSessionState` (existing behavior, ensure covered)
   - Follow existing mock patterns for `analysis-session` module
2. Run verifier with pattern "use-analysis-session" (expect fail)
3. In `use-analysis-session.ts`:
   - Modify `setDescription` callback to call `ensureSessionId()` when description becomes non-empty (i.e., `description.trim().length > 0`)
   - Also trigger an immediate `saveSessionState` call (same pattern as `setPhotos` does at line 224) so the session is persisted right away rather than waiting for debounce
4. Run verifier with pattern "use-analysis-session" (expect pass)

**Notes:**
- `ensureSessionId()` is idempotent — safe to call when session already exists (returns existing ID)
- The debounced save effect already watches `state.description`, so subsequent changes are auto-saved; only the initial session creation + first save needs the immediate call
- This is a prerequisite for Task 5 (auto-save feedback) — without a session, there's nothing to indicate as "saved"

### Task 2: Individual photo removal with X badges
**Linear Issue:** [FOO-826](https://linear.app/lw-claude/issue/FOO-826/individual-photo-removal-with-x-badges)
**Files:**
- `src/components/__tests__/photo-capture.test.tsx` (modify)
- `src/components/photo-capture.tsx` (modify)

**Steps:**
1. Add tests in `photo-capture.test.tsx`:
   - Test: each photo preview has a remove button with accessible label "Remove photo N"
   - Test: clicking remove on a single photo removes only that photo and calls `onPhotosChange` with remaining photos
   - Test: clicking remove on the last remaining photo calls `onPhotosChange([], [])`
   - Test: remove buttons are not shown during processing (`processingCount > 0`)
   - Test: restored photo previews also have individual remove buttons
   - Test: clicking remove on a restored photo removes it and calls `onPhotosChange` with remaining blobs
   - Test: remove buttons respect disabled/processing state
2. Run verifier with pattern "photo-capture" (expect fail)
3. In `photo-capture.tsx`:
   - Add a `handleRemovePhoto(index: number)` function:
     - Revoke the preview URL at that index
     - Create new arrays without the removed index for photos, previews, and convertedBlobs
     - Call `onPhotosChange` with updated arrays
     - If resulting array is empty, call `onPhotosChange([], [])`
   - Add a `handleRemoveRestoredPhoto(index: number)` function:
     - Revoke the restored preview URL at that index
     - Create new array of restoredBlobs without the removed index
     - Update restoredPreviews state
     - If the `restoredBlobs` prop was provided, need to pass remaining blobs back via `onPhotosChange` — since we don't have the original `restoredBlobs` in state, add `restoredBlobsRef` to store them, then filter and call back
   - On each photo preview button in the grid (both regular and restored), overlay an X button:
     - Position: `absolute top-1 right-1 z-10`
     - Style: `w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center`
     - Use lucide `X` icon at `h-3.5 w-3.5`
     - `onClick` with `e.stopPropagation()` to prevent opening the preview dialog
     - `aria-label="Remove photo N"`
   - The photo preview container needs `relative` class (already has it via `relative aspect-square`)
   - Remove the "Clear All" button when only 1 photo exists (individual X is sufficient). Keep "Clear All" for 2+ photos as a convenience shortcut.
4. Run verifier with pattern "photo-capture" (expect pass)

**Notes:**
- `e.stopPropagation()` is critical — the X button sits inside the preview button that opens the full-size dialog
- For restored photos, we need to track the blobs in a ref since they come as a prop. Store `restoredBlobs` in a `useRef` on mount.
- Removing the last photo triggers the full reset flow in `food-analyzer.tsx` via `handlePhotosChange` (files.length === 0 → resetAnalysisState + clearSession)

### Task 3: "+" tile add-more photo trigger with dropdown picker
**Linear Issue:** [FOO-827](https://linear.app/lw-claude/issue/FOO-827/tile-add-more-photo-trigger-with-dropdown-picker)
**Files:**
- `src/components/__tests__/photo-capture.test.tsx` (modify)
- `src/components/photo-capture.tsx` (modify)

**Steps:**
1. Add tests in `photo-capture.test.tsx`:
   - Test: when photos exist and count < max, a "+" add tile is shown as the last grid item
   - Test: when photos count equals max, no "+" tile is shown
   - Test: clicking "+" tile opens a dropdown with "Take photo" and "Choose from gallery" options
   - Test: selecting "Take photo" from dropdown triggers camera input click
   - Test: selecting "Choose from gallery" from dropdown triggers gallery input click
   - Test: when no photos exist, the full-width camera/gallery buttons are shown (empty state — keep existing buttons)
   - Test: "+" tile is not shown during processing
2. Run verifier with pattern "photo-capture" (expect fail)
3. In `photo-capture.tsx`:
   - Import `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` from `@/components/ui/dropdown-menu`
   - Import `Plus` icon from lucide
   - When photos/restoredPreviews exist AND count < maxPhotos, render a "+" tile as the last item in the grid:
     - Same `aspect-square rounded-md` sizing as photo previews
     - Style: `border-2 border-dashed border-muted-foreground/30 flex items-center justify-center`
     - Contains `Plus` icon (`h-6 w-6 text-muted-foreground`)
     - Wrapped in `DropdownMenu` — tile is the trigger, content has two items
     - DropdownMenuItem "Take photo" with Camera icon → clicks `cameraInputRef`
     - DropdownMenuItem "Choose from gallery" with ImageIcon → clicks `galleryInputRef`
   - Keep existing full-width "Take Photo" / "Choose from Gallery" buttons for the empty state (no photos yet) — the "+" tile only appears when photos already exist
4. Run verifier with pattern "photo-capture" (expect pass)

**Notes:**
- The "+" tile replaces the need to scroll past photos to find action buttons
- Empty state keeps the prominent buttons because first-time discoverability matters
- DropdownMenu from shadcn/ui handles z-index, positioning, and accessibility automatically
- The grid remains `grid-cols-3`, so the "+" tile is naturally placed as the next grid cell

### Task 4: Always-visible "Start over" reset button
**Linear Issue:** [FOO-828](https://linear.app/lw-claude/issue/FOO-828/always-visible-start-over-reset-button)
**Files:**
- `src/components/__tests__/food-analyzer.test.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)

**Steps:**
1. Add tests in `food-analyzer.test.tsx`:
   - Test: "Start over" button is NOT shown when no content exists (no photos, empty description, no analysis)
   - Test: "Start over" button IS shown when photos exist
   - Test: "Start over" button IS shown when description is non-empty (even without photos)
   - Test: "Start over" button IS shown when analysis exists
   - Test: clicking "Start over" shows a confirmation dialog with "Start over?" title
   - Test: confirming the dialog calls `resetAnalysisState` + `clearSession` and resets all state
   - Test: canceling the dialog does not clear state
   - Test: after confirming, photos, description, and analysis are all cleared
2. Run verifier with pattern "Start over" (expect fail)
3. In `food-analyzer.tsx`:
   - Import `RotateCcw` from lucide
   - Import `AlertDialog`, `AlertDialogAction`, `AlertDialogCancel`, `AlertDialogContent`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogHeader`, `AlertDialogTitle` from `@/components/ui/alert-dialog`
   - Add `showStartOverConfirm` state (boolean, default false)
   - Derive `hasContent` boolean: `photos.length > 0 || convertedPhotoBlobs.length > 0 || description.trim().length > 0 || analysis !== null`
   - Add `handleStartOver` function: calls `resetAnalysisState()`, then `actions.clearSession()`, then `setShowStartOverConfirm(false)`. The `clearSession` action resets all state to defaults.
   - In the JSX, at the top of the main return (inside `<div className="space-y-...">`, before the photo capture):
     - Render a flex row with a "Start over" ghost button (only when `hasContent` is true):
       - `<button>` with `RotateCcw` icon + "Start over" text
       - Style: `text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 min-h-[44px] ml-auto` (right-aligned via ml-auto)
       - `onClick={() => setShowStartOverConfirm(true)}`
     - Render the `AlertDialog` for confirmation:
       - Title: "Start over?"
       - Description: "This will clear all photos, description, and analysis results."
       - Cancel + "Start over" action button (destructive variant)
   - Remove the first-time guidance block (lines 653-666 in current code) — it's replaced by the self-explanatory empty state with "+" tile and prominent buttons
4. Run verifier with pattern "Start over" (expect pass)

**Notes:**
- Using text+icon button (not just icon) for clarity — research shows label is important for destructive actions
- Right-aligned to separate from primary flow, per NNGroup guidelines on consequential options
- Confirmation dialog prevents accidental loss, per UX best practices
- Removing first-time guidance: the camera/gallery buttons and description placeholder already explain the flow; this is a single-user app where the user already knows the purpose

### Task 5: Sticky bottom CTA bar
**Linear Issue:** [FOO-829](https://linear.app/lw-claude/issue/FOO-829/sticky-bottom-cta-bar-for-analyzelog-actions)
**Files:**
- `src/components/__tests__/food-analyzer.test.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/app/app/analyze/page.tsx` (modify)

**Steps:**
1. Add tests in `food-analyzer.test.tsx`:
   - Test: "Analyze Food" button renders in the sticky bar area (testid `sticky-cta-bar`)
   - Test: when analysis exists, sticky bar shows "Log to Fitbit" button instead
   - Test: when analysis exists with matches, sticky bar shows "Log as new"
   - Test: sticky bar is not rendered when loading/compressing (buttons are disabled, bar still shows)
   - Test: sticky bar is not rendered when `logResponse` exists (confirmation screen shown instead)
   - Update existing button tests that find "Analyze Food" / "Log to Fitbit" to account for new container structure
2. Run verifier with pattern "sticky" or "Analyze Food" or "Log to Fitbit" (expect fail)
3. In `food-analyzer.tsx`:
   - Remove the inline "Analyze Food" button (currently between description and analysis section)
   - Remove the inline "Log to Fitbit" / "Log as new" button (currently at the bottom of post-analysis controls)
   - Add a sticky bottom bar at the END of the main return JSX (outside the `space-y-...` div but still inside the fragment/wrapper):
     - Container: `fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 z-40 px-4`
       - The `bottom` offset accounts for the bottom-nav height (~4rem + safe area)
     - Inner: `mx-auto w-full max-w-md py-3`
     - Background: `bg-background/80 backdrop-blur-sm border-t` for frosted glass effect
     - Renders the primary CTA button (full width, `min-h-[44px]`):
       - Before analysis: "Analyze Food" (disabled when `!canAnalyze`)
       - After analysis: "Log to Fitbit" or "Log as new" (disabled when `logging`)
       - During compression: "Preparing images..."
       - During loading: "Analyzing..."
       - During logging: "Logging..."
   - Add bottom padding to the scrollable content area to prevent the sticky bar from overlapping the last content item:
     - Add `pb-24` to the main content wrapper (accounts for sticky bar + bottom nav)
   - In `page.tsx`: no changes needed — the FoodAnalyzer component handles its own sticky positioning
4. Run verifier with pattern "Analyze Food|Log to Fitbit|sticky" (expect pass)

**Notes:**
- z-40 is below bottom-nav's z-50, so the nav stays on top
- `bottom-[calc(4rem+env(safe-area-inset-bottom))]` positions the CTA bar just above the bottom nav. Adjust the `4rem` value to match the actual bottom-nav height.
- Frosted glass (`bg-background/80 backdrop-blur-sm`) is a common modern pattern that lets the user see content scrolling behind the bar
- The sticky bar does NOT hide on keyboard open — the analyze screen's textarea is short, and the Analyze button being visible while typing is actually helpful (research: users want to submit immediately after typing)
- `max-w-md mx-auto` matches the page's content width constraint

### Task 6: Tighter layout and spacing refinements
**Linear Issue:** [FOO-830](https://linear.app/lw-claude/issue/FOO-830/tighter-layout-and-spacing-refinements-for-analyze-screen)
**Files:**
- `src/components/__tests__/food-analyzer.test.tsx` (modify — update snapshot/structure assertions if any)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/photo-capture.tsx` (modify)

**Steps:**
1. Update any tests that assert specific class names or container structure (if any exist — check first). Most tests use testids and text content, so this may need minimal test changes.
2. Run verifier (expect pass — layout-only changes should not break behavior tests)
3. In `food-analyzer.tsx`:
   - Change main container from `space-y-6` to `space-y-4` for tighter vertical rhythm
   - Group meal type and time selectors in a single `space-y-3` container (reduce spacing between them)
   - Move "Refine with chat" button BELOW meal type/time selectors but ABOVE the match cards — it's a secondary action, should not interrupt the log flow
   - The post-analysis section ordering becomes: analysis result card → meal type + time → refine with chat → match cards → log error (if any)
   - Remove the `<Label>` wrappers for meal type and time where they just say "Meal Type" and "Meal Time" — these are self-evident from the component's content. If labels are needed for accessibility, use `aria-label` on the selects instead.
4. In `photo-capture.tsx`:
   - Change "Take Photo" / "Choose from Gallery" button row from `flex-col sm:flex-row` to just `flex gap-2` (always side by side — these are short labels that fit on one line)
   - Remove the photo count text (`X/9 photos selected`) — the visual grid makes this obvious, and the "+" tile's absence at max count signals the limit
5. Run verifier (expect pass)

**Notes:**
- These are visual refinements only — no behavioral changes
- Keeping `space-y-4` everywhere creates a more cohesive, less "spacey" feel
- Removing the photo count label reduces clutter; the grid is the count
- Reordering post-analysis controls puts the most common flow (analyze → pick meal/time → log) in a straight line without detours

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Revamp the analyze screen to fix description persistence, add individual photo removal, provide an always-visible reset mechanism, add a sticky bottom CTA bar, and refine layout spacing for a modern minimal design
**Linear Issues:** FOO-825, FOO-826, FOO-827, FOO-828, FOO-829, FOO-830
**Approach:** Six tasks in dependency order. Task 1 fixes the core persistence bug (session ID creation on description input). Task 2 adds per-photo X badges for individual removal. Task 3 adds a "+" tile with dropdown picker for adding more photos. Task 4 adds an always-visible "Start over" button with confirmation. Task 5 moves the primary CTA (Analyze/Log) to a sticky bottom bar. Task 6 tightens spacing and reorders post-analysis controls for cleaner flow.
**Scope:** 6 tasks, ~8 files, ~30 tests
**Key Decisions:**
- "Start over" as text+icon button (not just icon) with confirmation dialog — UX research shows labels are critical for destructive actions
- Sticky CTA positioned above bottom nav (z-40 < z-50) with frosted glass background
- Keep full-width camera/gallery buttons for empty state, "+" tile only when photos exist — first-time discoverability matters
- Remove first-time guidance and photo count label — reduce clutter, let UI speak for itself
- DropdownMenu for photo picker (already installed, handles accessibility)
**Risks:**
- Sticky bar bottom offset needs to match actual bottom-nav height — may need fine-tuning
- Individual photo removal changes the `onPhotosChange` contract slightly (partial removal vs clear-all) — existing tests need careful updates
- Removing Labels from meal type/time selectors needs accessibility audit (ensure aria-label coverage)
