# Implementation Plan

**Created:** 2026-02-19
**Source:** Inline request: Move floating action buttons to header icons (Option A from investigation)
**Linear Issues:** [FOO-676](https://linear.app/lw-claude/issue/FOO-676/move-floating-action-buttons-to-header-icons)

## Context Gathered

### Codebase Analysis
- **FloatingActions component:** `src/components/floating-actions.tsx` — three fixed-position FABs (Chat, Camera, Quick Select) stacked bottom-right with `z-[55]`
- **Home page:** `src/app/app/page.tsx` — renders `<FloatingActions />` outside `<main>`, h1 "Food Scanner" is a plain text element with no flex row
- **Bottom nav:** `src/components/bottom-nav.tsx` — already has Quick Select (`/app/quick-select`) and Analyze (`/app/analyze`) entries, 5 items at max
- **FloatingActions usage:** Only on `/app/page.tsx` — not used elsewhere
- **Test files:** `src/components/__tests__/floating-actions.test.tsx` (5 tests), `src/app/app/__tests__/page.test.tsx` (mocks FloatingActions, 1 test asserts it renders)
- **E2E:** No E2E tests reference floating actions directly
- **autoCapture:** Camera link uses `?autoCapture=true` to auto-open camera on the analyze page

### Design Decision
- **Drop Quick Select shortcut** — already in bottom nav, no need for header duplication
- **Keep Chat + Camera** — Chat has no bottom nav entry; Camera shortcut (with autoCapture) provides quick photo access distinct from the nav's Analyze entry
- **Header placement** — flex row with h1 left, icon links right. Matches common mobile app patterns (e.g., WhatsApp, Telegram header actions)

## Original Plan

### Task 1: Create HeaderActions component and replace FloatingActions
**Linear Issue:** [FOO-676](https://linear.app/lw-claude/issue/FOO-676/move-floating-action-buttons-to-header-icons)

**TDD Steps:**

1. Write tests in `src/components/__tests__/header-actions.test.tsx`:
   - Renders two links: Chat (`/app/chat`) and Take Photo (`/app/analyze?autoCapture=true`)
   - Links have correct aria-labels ("Chat" and "Take Photo")
   - All links meet minimum touch target size (`min-h-[44px]`, `min-w-[44px]`)
   - Uses `text-muted-foreground` styling for icons
   - Does NOT render a Quick Select link

2. Run verifier (expect fail — component doesn't exist)

3. Create `src/components/header-actions.tsx`:
   - Client component (`'use client'` not needed — no interactivity, just links)
   - Actually this is a server component — just renders two Next.js `Link` elements
   - Two icon links: `MessageCircle` (Chat) and `Camera` (Take Photo) from lucide-react
   - Each link: `flex items-center justify-center rounded-full min-h-[44px] min-w-[44px] h-9 w-9 text-muted-foreground hover:text-foreground transition-colors`
   - Layout: `flex items-center gap-1`

4. Update `src/app/app/page.tsx`:
   - Replace `import { FloatingActions }` with `import { HeaderActions }`
   - Change the h1 area to a flex row: `<div className="flex items-center justify-between">` wrapping the h1 and `<HeaderActions />`
   - Remove the standalone `<FloatingActions />` at the bottom
   - `<HeaderActions />` goes inside `<main>`, in the header flex row (not outside main like FloatingActions was)

5. Update `src/app/app/__tests__/page.test.tsx`:
   - Replace `FloatingActions` mock with `HeaderActions` mock
   - Update the test that asserts "renders FloatingActions component" → "renders HeaderActions component"

6. Delete `src/components/floating-actions.tsx` and `src/components/__tests__/floating-actions.test.tsx`

7. Run verifier (expect pass)

## Post-Implementation Checklist
1. Run `bug-hunter` agent - Review changes for bugs
2. Run `verifier` agent - Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Move floating action buttons to inline header icons to fix content overlap on home screen

**Request:** Replace the three floating action buttons (Chat, Camera, Quick Select) that overlap dashboard content with two small icon buttons (Chat, Camera) in the page header next to the title. Drop Quick Select shortcut since it's already in the bottom nav.

**Linear Issues:** FOO-676

**Approach:** Create a new `HeaderActions` component with Chat and Camera icon links, integrate it into the home page header as a flex row alongside the h1, delete the old `FloatingActions` component entirely.

**Scope:**
- Tasks: 1
- Files affected: 5 (create 2, modify 2, delete 2)
- New tests: yes

**Key Decisions:**
- Drop Quick Select from header shortcuts — already in bottom nav, redundant
- Camera shortcut preserves `?autoCapture=true` for quick photo access
- Server component (no `'use client'` needed — just static links)

**Risks/Considerations:**
- None significant — straightforward component swap with no data flow changes
