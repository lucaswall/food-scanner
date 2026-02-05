# Implementation Plan

**Created:** 2026-02-04
**Source:** Inline request: Separate camera capture from gallery file selection in PhotoCapture component
**Linear Issues:** [FOO-32](https://linear.app/lw-claude/issue/FOO-32)

## Context Gathered

### Codebase Analysis
- **Related files:**
  - `src/components/photo-capture.tsx` — Current implementation with single file input
  - `src/components/__tests__/photo-capture.test.tsx` — Existing tests
  - `src/components/ui/button.tsx` — shadcn/ui button component for styling
  - `src/components/food-analyzer.tsx` — Parent component that uses PhotoCapture
- **Existing patterns:**
  - PhotoCapture uses `'use client'` directive for interactivity
  - Single file input with `accept="image/*"` and `capture="environment"`
  - Preview thumbnails using `URL.createObjectURL()`
  - Validation for file type (JPEG/PNG) and size (10MB max)
  - Clear button to reset state
- **Test conventions:**
  - Tests colocated in `__tests__/` subdirectory
  - Mock `URL.createObjectURL/revokeObjectURL` with `vi.stubGlobal()`
  - `createMockFile()` helper for File creation
  - Test validation error display, preview rendering, callbacks

### MCP Context
- **MCPs used:** Linear (for issue creation)
- **Findings:** Team "Food Scanner" ID: `3e498d7a-30d2-4c11-89b3-ed7bd8cb2031`

## Original Plan

### Task 1: Separate camera capture from gallery selection in PhotoCapture
**Linear Issue:** [FOO-32](https://linear.app/lw-claude/issue/FOO-32)

1. Update tests in `src/components/__tests__/photo-capture.test.tsx`:
   - Test renders "Take Photo" button that triggers camera input (`capture="environment"`)
   - Test renders "Choose from Gallery" button that triggers file input (no capture attribute)
   - Test both inputs are hidden (visually) and triggered via button clicks
   - Test "Take Photo" input has `capture="environment"` attribute
   - Test "Choose from Gallery" input does NOT have `capture` attribute
   - Test both inputs share validation and photo limit logic
   - Test photos from either source are combined correctly
   - Update existing tests to work with new dual-input structure
2. Run verifier (expect fail)
3. Update `src/components/photo-capture.tsx`:
   - Replace single file input with two hidden inputs:
     - Camera input: `accept="image/*"` `capture="environment"` (for taking photos)
     - Gallery input: `accept="image/jpeg,image/png"` without capture (for file selection)
   - Add two visible buttons:
     - "Take Photo" button (triggers camera input via ref)
     - "Choose from Gallery" button (triggers gallery input via ref)
   - Share `handleFileChange` logic between both inputs
   - Keep existing validation, preview, and clear functionality
   - Style buttons using shadcn/ui Button component with icons
4. Run verifier (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Provide separate buttons for camera capture and gallery file selection

**Request:** The UI shows "Choose file" but opens camera directly. User wants two separate actions: one to take a photo with camera, another to choose existing photos from gallery.

**Linear Issues:** FOO-32

**Approach:** Replace the single file input with two hidden inputs—one with `capture="environment"` for camera, one without capture for gallery access. Add two styled buttons that trigger each input via refs. Both inputs share the same validation and state management logic.

**Scope:**
- Tasks: 1
- Files affected: 2 (component + tests)
- New tests: yes (update existing tests + add new ones)

**Key Decisions:**
- Use two hidden file inputs with button triggers (standard mobile-compatible pattern)
- Camera input uses `capture="environment"` for back camera preference
- Gallery input omits capture attribute entirely to show native file picker
- Both inputs share validation logic to maintain consistency

**Risks/Considerations:**
- Browser behavior varies: some Android browsers may still show a picker even with capture attribute
- iOS Safari handles capture attribute differently than Android Chrome
- Testing hidden inputs requires triggering via refs/programmatic clicks
