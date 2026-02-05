# Implementation Plan

**Created:** 2026-02-04
**Source:** Inline request: Add HEIC image format support using heic2any library (Option B - universal browser support)
**Linear Issues:** [FOO-41](https://linear.app/lw-claude/issue/FOO-41), [FOO-42](https://linear.app/lw-claude/issue/FOO-42), [FOO-43](https://linear.app/lw-claude/issue/FOO-43), [FOO-44](https://linear.app/lw-claude/issue/FOO-44), [FOO-45](https://linear.app/lw-claude/issue/FOO-45)

## Context Gathered

### Codebase Analysis
- **Related files:**
  - `src/lib/image.ts` — Client-side image compression (compressImage function using canvas)
  - `src/lib/__tests__/image.test.ts` — Tests for image compression
  - `src/components/photo-capture.tsx` — File input component with ALLOWED_TYPES validation
  - `src/components/__tests__/photo-capture.test.tsx` — Tests for photo capture
  - `src/components/food-analyzer.tsx` — Parent component that calls compressImage
  - `src/app/api/analyze-food/route.ts` — Server-side validation (no changes needed - receives JPEG from client)
- **Existing patterns:**
  - Client-side image processing in `src/lib/image.ts` using canvas API
  - File validation in PhotoCapture component with ALLOWED_TYPES array
  - Tests mock canvas APIs and Image class
- **Test conventions:**
  - Mock browser APIs (URL.createObjectURL, canvas, Image)
  - Use createMockFile helper for File objects
  - Test both success and error paths

### MCP Context
- **MCPs used:** Linear (for issue creation)
- **Findings:** Team "Food Scanner" (ID: `3e498d7a-30d2-4c11-89b3-ed7bd8cb2031`)

### Research Findings
- **Claude API supported formats:** JPEG, PNG, GIF, WebP only — HEIC NOT supported
- **heic2any library:** ~2.7MB, converts HEIC to JPEG/PNG client-side using libheif WebAssembly
- **Browser HEIC support:** Safari 17.6+ native, Chrome/Firefox/Edge need conversion
- **Android relevance:** Android Photos app saves in HEIC by default on many devices; conversion is necessary

## Original Plan

### Task 1: Add heic2any dependency
**Linear Issue:** [FOO-41](https://linear.app/lw-claude/issue/FOO-41)

1. No tests needed (dependency installation)
2. Install heic2any: `npm install heic2any`
3. Install @types/heic2any: `npm install --save-dev @types/heic2any`
4. Verify installation in package.json
5. Run verifier (expect pass)

### Task 2: Create HEIC detection and conversion utility
**Linear Issue:** [FOO-42](https://linear.app/lw-claude/issue/FOO-42)

1. Write tests in `src/lib/__tests__/image.test.ts` for HEIC handling:
   - Test `isHeicFile(file)` returns true for image/heic MIME type
   - Test `isHeicFile(file)` returns true for image/heif MIME type
   - Test `isHeicFile(file)` returns true for .heic file extension (fallback when MIME is empty)
   - Test `isHeicFile(file)` returns true for .heif file extension
   - Test `isHeicFile(file)` returns false for JPEG/PNG files
   - Test `convertHeicToJpeg(file)` returns Blob with image/jpeg type
   - Test `convertHeicToJpeg(file)` throws on conversion failure
2. Run verifier (expect fail)
3. Implement in `src/lib/image.ts`:
   - Add `isHeicFile(file: File): boolean` — check MIME type and extension
   - Add `convertHeicToJpeg(file: File): Promise<Blob>` — use heic2any library
   - Export both functions
4. Run verifier (expect pass)

### Task 3: Update compressImage to handle HEIC input
**Linear Issue:** [FOO-43](https://linear.app/lw-claude/issue/FOO-43)

1. Write tests in `src/lib/__tests__/image.test.ts`:
   - Test `compressImage` with HEIC file converts before canvas processing
   - Test `compressImage` still works with JPEG/PNG (no conversion)
   - Test `compressImage` propagates conversion errors
2. Run verifier (expect fail)
3. Update `compressImage` in `src/lib/image.ts`:
   - At start, check if file is HEIC using `isHeicFile`
   - If HEIC, convert to JPEG using `convertHeicToJpeg` first
   - Create new File from converted blob for canvas processing
   - Existing canvas resize/compress logic unchanged
4. Run verifier (expect pass)

### Task 4: Update PhotoCapture to accept HEIC files
**Linear Issue:** [FOO-44](https://linear.app/lw-claude/issue/FOO-44)

1. Write tests in `src/components/__tests__/photo-capture.test.tsx`:
   - Test HEIC files (image/heic) are accepted without validation error
   - Test HEIF files (image/heif) are accepted without validation error
   - Test files with .heic extension but empty MIME type are accepted
   - Test updated error message includes HEIC format
2. Run verifier (expect fail)
3. Update `src/components/photo-capture.tsx`:
   - Add `image/heic` and `image/heif` to ALLOWED_TYPES array
   - Update accept attribute on file inputs to include HEIC
   - Update validateFile to also check file extension for .heic/.heif
   - Update error message: "Only JPEG, PNG, and HEIC images are allowed"
4. Run verifier (expect pass)

### Task 5: Update CLAUDE.md and ROADMAP.md documentation
**Linear Issue:** [FOO-45](https://linear.app/lw-claude/issue/FOO-45)

1. No tests needed (documentation)
2. Update CLAUDE.md Security section to list HEIC alongside JPEG/PNG
3. Update ROADMAP.md image validation section to include HEIC format
4. Run verifier (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Add HEIC image format support with universal browser compatibility

**Request:** User requested Option B (heic2any library) for HEIC support since they use Android, which often saves photos in HEIC format by default.

**Linear Issues:** FOO-41, FOO-42, FOO-43, FOO-44, FOO-45

**Approach:** Install heic2any library for client-side HEIC-to-JPEG conversion. Create detection and conversion utilities in the image library. Update compressImage to automatically convert HEIC before canvas processing. Update PhotoCapture component to accept HEIC files in validation and file input accept attributes. The conversion happens transparently client-side, so no API changes are needed (server always receives JPEG).

**Scope:**
- Tasks: 5
- Files affected: 5 (2 source files, 2 test files, 2 docs)
- New tests: yes

**Key Decisions:**
- Convert HEIC to JPEG (not PNG) to maintain existing compression pipeline
- Detection checks both MIME type and file extension (Android sometimes reports empty MIME for HEIC)
- Conversion happens in compressImage transparently — caller doesn't need to know about HEIC
- heic2any loaded synchronously (adds ~2.7MB to bundle, acceptable for this use case)

**Risks/Considerations:**
- heic2any adds ~2.7MB to client bundle — acceptable tradeoff for universal support
- HEIC conversion takes 1-3 seconds per image — user sees normal "Analyzing..." state
- If heic2any fails to load or convert, error propagates to user as "Failed to load image"
- Testing HEIC conversion requires mocking heic2any library
