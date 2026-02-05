# Implementation Plan

**Created:** 2026-02-05
**Source:** Inline request: Complete Iteration 4 (PWA setup) from ROADMAP.md
**Linear Issues:** [FOO-60](https://linear.app/lw-claude/issue/FOO-60/create-pwa-manifest-file), [FOO-61](https://linear.app/lw-claude/issue/FOO-61/create-pwa-icon-assets), [FOO-62](https://linear.app/lw-claude/issue/FOO-62/link-manifest-in-root-layout), [FOO-63](https://linear.app/lw-claude/issue/FOO-63/increase-button-touch-target-size-to-44px-minimum), [FOO-64](https://linear.app/lw-claude/issue/FOO-64/update-documentation-for-pwa-setup)

## Context Gathered

### Codebase Analysis
- **Root layout:** `src/app/layout.tsx` - Has basic metadata, no manifest link
- **Public directory:** Empty - no PWA assets exist
- **Button component:** `src/components/ui/button.tsx` - Default height is h-9 (36px), below 44px touch target
- **Component buttons:** PhotoCapture, FoodAnalyzer, etc. use default button size

### ROADMAP Requirements (Iteration 4: Mobile & PWA)
- Touch-friendly: All buttons minimum 44px x 44px
- PWA manifest for "Add to Home Screen" (no service worker, no offline support)
- Icons: 192x192 and 512x512 PNG files
- Manifest fields: name, short_name, description, start_url, display, colors, orientation, icons

### MCP Context
- **Linear MCP:** Connected (verified via list_teams)
- **Railway MCP:** Available for deployment verification

## Original Plan

### Task 1: Create PWA manifest file
**Linear Issue:** [FOO-60](https://linear.app/lw-claude/issue/FOO-60/create-pwa-manifest-file)

1. Write test in `src/app/__tests__/manifest.test.ts` for manifest presence and fields
   - Test manifest.json exists in public directory
   - Test required fields are present (name, short_name, start_url, display, icons)
   - Test icon paths are valid
2. Run verifier (expect fail)
3. Create `public/manifest.json` with ROADMAP-specified fields:
   - name: "Food Logger"
   - short_name: "FoodLog"
   - description: "AI-powered food logging for Fitbit"
   - start_url: "/app"
   - display: "standalone"
   - background_color: "#ffffff"
   - theme_color: "#000000"
   - orientation: "portrait"
   - icons: 192x192 and 512x512
4. Run verifier (expect pass)

### Task 2: Create PWA icon assets
**Linear Issue:** [FOO-61](https://linear.app/lw-claude/issue/FOO-61/create-pwa-icon-assets)

1. No test needed (static asset)
2. Create `public/icon-192.png` - 192x192 PNG icon
3. Create `public/icon-512.png` - 512x512 PNG icon
4. Verify icons are properly sized and formatted

### Task 3: Link manifest in root layout
**Linear Issue:** [FOO-62](https://linear.app/lw-claude/issue/FOO-62/link-manifest-in-root-layout)

1. Write test in `src/app/__tests__/layout.test.tsx` for manifest link
   - Test layout renders with manifest link in head
   - Test theme-color meta tag is present
2. Run verifier (expect fail)
3. Update `src/app/layout.tsx`:
   - Add manifest link to metadata
   - Add theme-color meta tag
   - Add apple-touch-icon link for iOS
4. Run verifier (expect pass)

### Task 4: Increase button touch target size
**Linear Issue:** [FOO-63](https://linear.app/lw-claude/issue/FOO-63/increase-button-touch-target-size-to-44px-minimum)

1. Write test in `src/components/ui/__tests__/button.test.tsx` for touch-friendly size
   - Test default button height is at least 44px (h-11)
   - Test all size variants meet minimum touch target
2. Run verifier (expect fail)
3. Update `src/components/ui/button.tsx`:
   - Change default size from h-9 (36px) to h-11 (44px)
   - Update lg size from h-10 (40px) to h-12 (48px)
   - Update sm size from h-8 (32px) to h-10 (40px) - acceptable for secondary actions
   - Update icon sizes proportionally
4. Run verifier (expect pass)

### Task 5: Update documentation
**Linear Issue:** [FOO-64](https://linear.app/lw-claude/issue/FOO-64/update-documentation-for-pwa-setup)

1. No test needed (documentation)
2. Update `CLAUDE.md`:
   - Add PWA section describing manifest and icons
   - Note touch target requirement in development policies
3. Update `README.md`:
   - Add PWA setup notes
   - Document icon generation process
4. Run verifier (verify build still passes)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Complete Iteration 4 by adding PWA manifest, icons, and ensuring touch-friendly UI

**Request:** Plan the remaining work of the ROADMAP (Iteration 4: Polish & PWA)

**Linear Issues:** FOO-60, FOO-61, FOO-62, FOO-63, FOO-64

**Approach:** Create PWA manifest and icons for "Add to Home Screen" functionality on mobile. Update root layout to link manifest. Increase button touch targets from 36px to 44px minimum to meet accessibility guidelines.

**Scope:**
- Tasks: 5
- Files affected: 7 (manifest.json, 2 icons, layout.tsx, button.tsx, CLAUDE.md, README.md)
- New tests: yes (manifest validation, layout metadata, button sizing)

**Key Decisions:**
- No service worker or offline support per ROADMAP spec
- Button default size increased to h-11 (44px) to meet touch target guidelines
- Icons will be simple placeholder images (user can replace with custom branding)

**Risks/Considerations:**
- Button size increase may affect existing layouts - visual review recommended
- Icons are placeholder - production app may want branded icons
