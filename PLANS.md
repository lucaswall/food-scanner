# Fix Plan: HEIC Distortion + Backlog Bugs

**Date:** 2026-02-05
**Status:** Planning
**Branch:** fix/FOO-87-heic-distortion-and-backlog-bugs (proposed)

## Overview

This plan addresses three bugs:
1. **HEIC Image Distortion** (new) - Photos selected from phone in HEIC format display as distorted/corrupted images
2. **FOO-85** - Food Scanner screen always displays in light mode regardless of theme setting
3. **FOO-86** - No way to return to Food Scanner from Settings page

---

## Task 1: Fix HEIC Image Distortion

**Linear Issue:** [FOO-87](https://linear.app/lw-claude/issue/FOO-87)

### Bug Report
Photos selected from phone in HEIC format get corrupted and display as very distorted images. When submitted, Claude receives these distorted images and food recognition degrades significantly.

### Classification
- **Type:** Integration
- **Severity:** High
- **Affected Area:** `src/lib/image.ts`, `src/components/photo-capture.tsx`

### Root Cause Analysis

The app uses `heic2any@0.0.4` (published April 2023) which bundles an outdated version of `libheif`. A [known GitHub issue #16](https://github.com/alexcorvi/heic2any/issues/16) documents "Slant Image after converting" which produces distorted, skewed images for certain HEIC files.

#### Evidence
- **File:** `src/lib/image.ts:33-36` - Uses heic2any without quality parameter
- **File:** `package.json` - heic2any@0.0.4 (outdated, last published April 2023)
- **Documentation:** heic2any explicitly states "Library doesn't take any metadata from the original file" - this breaks orientation handling

#### Related Code
```typescript
// Current code in src/lib/image.ts
const result = await heic2any({
  blob: file,
  toType: "image/jpeg",
  // quality is NOT specified
});
```

### Impact
- HEIC photos (default iPhone format) appear distorted in previews and analysis
- Claude receives corrupted images, degrading food recognition accuracy
- Users must take photos in JPEG format or use a different phone

### Fix Plan (TDD Approach)

#### Step 1: Write Failing Test
- **File:** `src/lib/__tests__/image.test.ts`
- **Test:** Verify heic-to library is called with correct parameters

```typescript
it("converts HEIC file using heic-to with quality parameter", async () => {
  // Mock heic-to instead of heic2any
  // Verify quality: 1 is passed for maximum quality
  // Verify type: "image/jpeg" is passed
});
```

#### Step 2: Implement Fix
- **File:** `package.json` - Replace heic2any with heic-to
- **File:** `src/lib/image.ts` - Update convertHeicToJpeg to use heic-to

```bash
npm uninstall heic2any && npm install heic-to
```

```typescript
// New code in src/lib/image.ts
export async function convertHeicToJpeg(file: File): Promise<Blob> {
  const heicTo = (await import("heic-to")).default;

  const result = await heicTo({
    blob: file,
    type: "image/jpeg",
    quality: 1, // Maximum quality to preserve image fidelity
  });

  return result;
}
```

#### Step 3: Verify
- [ ] Failing test now passes
- [ ] Existing HEIC tests still pass (update mocks)
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Manual verification with actual HEIC photos from iPhone

#### Step 4: Additional Tests
- [ ] Test heic-to returns single blob (not array like heic2any)
- [ ] Test error propagation when conversion fails

---

## Task 2: Fix Theme Not Applied on Food Scanner Page

**Linear Issue:** [FOO-85](https://linear.app/lw-claude/issue/FOO-85)

### Bug Report
When opening the app, the Food Scanner page is not respecting the theme setting and always displays in light mode.

### Classification
- **Type:** Frontend Bug
- **Severity:** Urgent
- **Affected Area:** `src/app/layout.tsx`, `src/hooks/use-theme.ts`

### Root Cause Analysis

The `useTheme` hook applies the theme class to `document.documentElement`, but this only happens when a component using `useTheme` mounts. The main `/app/page.tsx` is a Server Component that doesn't use `useTheme`, and no client component at the layout level initializes the theme on page load.

#### Evidence
- **File:** `src/app/layout.tsx:43-44` - `<html>` element has no theme class
- **File:** `src/app/app/page.tsx:8` - Server Component, doesn't use `useTheme`
- **File:** `src/hooks/use-theme.ts:26-33` - Only applies theme when hook is called

#### Related Code
```typescript
// src/app/layout.tsx - no theme initialization
<html lang="en">
  <body>...</body>
</html>
```

### Impact
- Users see light mode on initial load even with dark preference
- Flash of wrong theme when navigating from settings to app
- Poor UX for users who prefer dark mode

### Fix Plan (TDD Approach)

#### Step 1: Write Failing Test
- **File:** `src/app/__tests__/layout.test.tsx` (new)
- **Test:** Verify ThemeProvider is rendered

```typescript
it("renders ThemeProvider in layout", async () => {
  render(<RootLayout><div>test</div></RootLayout>);
  // ThemeProvider should initialize theme on mount
});
```

#### Step 2: Implement Fix
- **File:** `src/components/theme-provider.tsx` - Create new ThemeProvider component
- **File:** `src/app/layout.tsx` - Wrap children in ThemeProvider
- **File:** `src/app/layout.tsx` - Add script to apply theme before hydration (prevent flash)

```typescript
// src/components/theme-provider.tsx
"use client";

import { useEffect } from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const stored = localStorage.getItem("theme") || "system";
    const root = document.documentElement;
    root.classList.remove("light", "dark");

    if (stored === "system") {
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.classList.add(systemDark ? "dark" : "light");
    } else {
      root.classList.add(stored);
    }
  }, []);

  return <>{children}</>;
}
```

```typescript
// src/app/layout.tsx
import { ThemeProvider } from "@/components/theme-provider";

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            const stored = localStorage.getItem("theme") || "system";
            const root = document.documentElement;
            if (stored === "system") {
              const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
              root.classList.add(dark ? "dark" : "light");
            } else {
              root.classList.add(stored);
            }
          })();
        `}} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

#### Step 3: Verify
- [ ] Failing test now passes
- [ ] Existing tests still pass
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Manual verification: theme applies immediately on page load

#### Step 4: Additional Tests
- [ ] Test system theme detection works
- [ ] Test theme persists across page navigation

---

## Task 3: Add Back Navigation from Settings

**Linear Issue:** [FOO-86](https://linear.app/lw-claude/issue/FOO-86)

### Bug Report
There is no way of returning to the Food Scanner screen after going to settings.

### Classification
- **Type:** Frontend Bug
- **Severity:** Urgent
- **Affected Area:** `src/app/settings/page.tsx`

### Root Cause Analysis

The settings page has no back button or link to return to `/app`. Users are stuck unless they manually edit the URL or use browser back button (which may not work in PWA mode).

#### Evidence
- **File:** `src/app/settings/page.tsx` - No navigation element to return to `/app`
- **Pattern:** `/app/page.tsx:17-21` has settings icon button as reference

### Impact
- Users stuck on settings page in PWA mode
- Poor navigation UX
- Forces users to use browser controls or URL bar

### Fix Plan (TDD Approach)

#### Step 1: Write Failing Test
- **File:** `src/app/settings/__tests__/page.test.tsx`
- **Test:** Verify back button exists and links to /app

```typescript
it("renders back button that links to /app", () => {
  render(<SettingsPage />);
  const backButton = screen.getByRole("link", { name: /back to food scanner/i });
  expect(backButton).toHaveAttribute("href", "/app");
});

it("back button has proper touch target size", () => {
  render(<SettingsPage />);
  const backButton = screen.getByRole("link", { name: /back to food scanner/i });
  expect(backButton).toHaveClass("min-h-[44px]", "min-w-[44px]");
});
```

#### Step 2: Implement Fix
- **File:** `src/app/settings/page.tsx` - Add back button with arrow icon

```typescript
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// In the return, add before h1:
<div className="flex items-center gap-2">
  <Button asChild variant="ghost" size="icon" className="min-h-[44px] min-w-[44px]">
    <Link href="/app" aria-label="Back to Food Scanner">
      <ArrowLeft className="h-5 w-5" />
    </Link>
  </Button>
  <h1 className="text-2xl font-bold">Settings</h1>
</div>
```

#### Step 3: Verify
- [ ] Failing test now passes
- [ ] Existing tests still pass
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Manual verification: clicking back button returns to food scanner

---

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix HEIC image distortion and address urgent backlog bugs

**Linear Issues:** [FOO-85](https://linear.app/lw-claude/issue/FOO-85), [FOO-86](https://linear.app/lw-claude/issue/FOO-86), [FOO-87](https://linear.app/lw-claude/issue/FOO-87)

**Approach:**
1. Replace outdated heic2any with actively maintained heic-to library (uses libheif 1.21.2)
2. Add ThemeProvider to layout with inline script to prevent theme flash
3. Add back navigation button to settings page

**Scope:**
- Tasks: 3
- Files affected: ~6 (image.ts, layout.tsx, settings/page.tsx, new theme-provider.tsx)
- New tests: yes (all tasks include tests)

**Key Decisions:**
- Use heic-to library (libheif 1.21.2, actively maintained, updated Feb 2026)
- Inline script in layout prevents flash of wrong theme (industry standard approach)
- Back button uses ArrowLeft icon consistent with mobile navigation patterns

**Risks/Considerations:**
- heic-to has slightly different API than heic2any (returns single Blob, not array)
- Inline script requires `suppressHydrationWarning` on html element
- Bundle size change: heic2any (2.7MB) → heic-to (unknown, likely similar)

---

## Iteration 1

**Implemented:** 2026-02-05

### Tasks Completed This Iteration
- Task 1: Fix HEIC Image Distortion (FOO-87) - Replaced heic2any with heic-to library, uses named export `heicTo` with quality: 1
- Task 2: Fix Theme Not Applied (FOO-85) - Created ThemeProvider component, added inline script in layout.tsx to prevent flash
- Task 3: Add Back Navigation from Settings (FOO-86) - Added ArrowLeft back button with proper touch target size

### Files Modified
- `package.json` - Replaced heic2any with heic-to dependency
- `src/lib/image.ts` - Updated convertHeicToJpeg to use heic-to, fixed validateImage to accept HEIC with empty MIME
- `src/lib/__tests__/image.test.ts` - Rewrote tests for heic-to API, added validateImage HEIC fallback tests
- `src/components/theme-provider.tsx` - Created new ThemeProvider component
- `src/app/layout.tsx` - Added ThemeProvider wrapper and inline theme script
- `src/app/__tests__/layout.test.tsx` - Added ThemeProvider and script tests
- `src/app/settings/page.tsx` - Added back button with ArrowLeft icon
- `src/app/settings/__tests__/page.test.tsx` - Added back navigation tests
- `src/components/photo-capture.tsx` - Fixed bounds check for preview index access

### Linear Updates
- FOO-87: Todo → In Progress → Review
- FOO-85: Todo → In Progress → Review
- FOO-86: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 medium bugs, fixed before proceeding (preview index bounds check, validateImage HEIC fallback)
- verifier: All 378 tests pass, zero warnings, build successful

### Continuation Status
All tasks completed.
