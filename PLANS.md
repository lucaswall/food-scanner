# Implementation Plan

**Created:** 2026-02-19
**Source:** Inline request: Reorganize home screen — dashboard data first, floating action buttons for Quick Select (primary), Take Photo, Chat
**Linear Issues:** [FOO-669](https://linear.app/lw-claude/issue/FOO-669), [FOO-670](https://linear.app/lw-claude/issue/FOO-670), [FOO-671](https://linear.app/lw-claude/issue/FOO-671), [FOO-672](https://linear.app/lw-claude/issue/FOO-672)

## Context Gathered

### Codebase Analysis
- **Home page:** `src/app/app/page.tsx` — Server Component, renders action cards (Take Photo, Quick Select, Chat) then LumenBanner then DashboardShell
- **Dashboard shell:** `src/components/dashboard-shell.tsx` — Client Component, Daily/Weekly toggle + conditional dashboard rendering
- **Lumen banner:** `src/components/lumen-banner.tsx` — Client Component, conditional CTA (hidden when goals are set)
- **Bottom nav:** `src/components/bottom-nav.tsx` — Fixed `bottom-0`, `z-50`, with safe-area padding
- **App layout:** `src/app/app/layout.tsx` — Wraps children with `pb-20` for bottom nav clearance, renders BottomNav
- **Loading skeleton:** `src/app/app/loading.tsx` — Skeleton matching current layout (heading + 2 card grid + banner + preview)
- **Z-index tiers:** z-50 (bottom nav, tooltips), z-[60] (FoodChat overlay), z-[70] (selects, dialogs)
- **Existing tests:** `src/app/app/__tests__/page.test.tsx` (14 tests, asserts action card links), `src/app/app/__tests__/loading.test.tsx` (4 tests)
- **E2E tests affected:** `e2e/tests/dashboard.spec.ts` — asserts "Take Photo" and "Quick Select" text visible on /app, tests action link navigation

### Design Decision
Three floating action buttons stacked vertically on bottom-right of home screen:
- **Quick Select** (bottom, closest to thumb) — 56px, primary/accent color, icon-only
- **Take Photo / Camera** (middle) — 40px, secondary/surface color, icon-only
- **Chat** (top) — 40px, secondary/surface color, icon-only

Positioned `fixed bottom-20 right-4 z-[55]` — above the bottom nav (z-50) but below FoodChat (z-[60]) and dialogs (z-[70]). Only rendered on the home page (inside page.tsx, not layout.tsx).

Dashboard content (DashboardShell) moves to directly after the title, making nutrition data visible at first glance.

## Original Plan

### Task 1: Create FloatingActions component
**Linear Issue:** [FOO-669](https://linear.app/lw-claude/issue/FOO-669)

**Files:**
- `src/components/floating-actions.tsx` (create)
- `src/components/__tests__/floating-actions.test.tsx` (create)

**Specification:**
- Client component with three stacked `<Link>` elements, fixed position bottom-right
- Stack order (bottom to top): Quick Select (primary), Take Photo (secondary), Chat (secondary)
- Quick Select: 56px diameter circle, `bg-primary text-primary-foreground shadow-lg`, `ListChecks` icon, links to `/app/quick-select`
- Take Photo: 40px diameter circle, `bg-card text-foreground border shadow-md`, `Camera` icon, links to `/app/analyze?autoCapture=true`
- Chat: 40px diameter circle, `bg-card text-foreground border shadow-md`, `MessageCircle` icon, links to `/app/chat`
- Container: `fixed bottom-20 right-4 z-[55]`, flex column with `gap-3`, items aligned end
- All buttons need `aria-label` attributes: "Quick Select", "Take Photo", "Chat"
- All buttons need `min-h-[44px] min-w-[44px]` for touch targets (the 56px and 40px diameters satisfy this for the primary, but the 40px secondaries are borderline — use 44px minimum)
- Icons: use same lucide icons as current action cards (`Camera`, `ListChecks`, `MessageCircle`)

**TDD Steps:**
1. Write tests asserting: three links render with correct hrefs, correct aria-labels, container has fixed positioning classes, primary button has `bg-primary` class, secondary buttons have `bg-card` class
2. Run verifier (expect fail)
3. Implement the component
4. Run verifier (expect pass)

---

### Task 2: Reorganize home page layout + update tests
**Linear Issue:** [FOO-670](https://linear.app/lw-claude/issue/FOO-670)

**Files:**
- `src/app/app/page.tsx` (modify)
- `src/app/app/__tests__/page.test.tsx` (modify)

**Specification:**
Remove the three action card links (Take Photo grid card, Quick Select grid card, Chat full-width card) from the page body. Reorder remaining content so dashboard data comes first:

New layout order:
1. `<h1>Food Scanner</h1>`
2. `<FitbitStatusBanner />` (conditional — only shows when there's a Fitbit issue)
3. `<DashboardShell />` (the main nutrition dashboard — immediately visible)
4. `<LumenBanner />` (conditional CTA — below the dashboard it contextualizes)
5. `<DashboardPrefetch />`
6. `<FloatingActions />` (new — floating buttons, no vertical space consumed)

Remove imports: `Camera`, `ListChecks`, `MessageCircle` from lucide-react, `Link` from next/link.
Add import: `FloatingActions` from `@/components/floating-actions`.

**Test updates:**
- Remove tests for Take Photo CTA link, Quick Select CTA link, Chat CTA link (they no longer exist in the page body)
- Remove test for CTA button touch target sizes (action cards are gone)
- Add test asserting FloatingActions component is rendered (mock it like other components)
- Update LumenBanner position test description (it's now after DashboardShell, not between button grid and dashboard)
- Keep: heading test, redirect test, FitbitStatusBanner test, DashboardShell test, skip link tests

**TDD Steps:**
1. Update tests first: remove action card assertions, add FloatingActions mock + assertion, update descriptions
2. Run verifier (expect fail — FloatingActions not yet imported in page, action cards still in page)
3. Modify page.tsx: remove action cards, reorder components, add FloatingActions
4. Run verifier (expect pass)

---

### Task 3: Update loading skeleton
**Linear Issue:** [FOO-671](https://linear.app/lw-claude/issue/FOO-671)

**Files:**
- `src/app/app/loading.tsx` (modify)
- `src/app/app/__tests__/loading.test.tsx` (modify)

**Specification:**
Update skeleton to match new layout. Remove the two card skeletons (action cards are gone). New skeleton structure:

1. Heading skeleton (keep as-is)
2. Dashboard toggle skeleton — a rounded-full bar matching the Daily/Weekly segmented control
3. Large dashboard preview skeleton (keep as-is, or increase height slightly)

Remove: the `grid grid-cols-2` with two `skeleton-card` elements, the `skeleton-banner` element.
Add: a `skeleton-toggle` element — `h-11 rounded-full` (matching the segmented control's rounded-full pill shape).

**Test updates:**
- Remove "renders two card skeletons in a grid" test
- Add test for skeleton-toggle element
- Keep: heading skeleton test, dashboard preview skeleton test, container layout test

**TDD Steps:**
1. Update tests: remove card skeleton assertion, add toggle skeleton assertion
2. Run verifier (expect fail)
3. Update loading.tsx skeleton structure
4. Run verifier (expect pass)

---

### Task 4: Update E2E dashboard tests
**Linear Issue:** [FOO-672](https://linear.app/lw-claude/issue/FOO-672)

**Files:**
- `e2e/tests/dashboard.spec.ts` (modify)

**Specification:**
The E2E tests reference "Take Photo" and "Quick Select" text on the /app page. With FABs (icon-only, no text labels), these assertions need updating.

Changes:
- "displays dashboard layout" test: Replace `page.getByText('Take Photo')` / `page.getByText('Quick Select')` with assertions for the FAB aria-labels: `page.getByRole('link', { name: 'Take Photo' })` and `page.getByRole('link', { name: 'Quick Select' })`
- "action links navigate" test: Update selectors to use `page.getByRole('link', { name: 'Take Photo' })` and `page.getByRole('link', { name: 'Quick Select' })` — same navigation assertions (URLs unchanged)
- Screenshot names remain the same — the new screenshots will show the updated layout

**Note:** This task only touches E2E tests, not unit tests. Run E2E verification after all other tasks are complete.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings
3. Run `verifier "e2e"` — Verify E2E tests pass with updated selectors and new screenshots

---

## Plan Summary

**Objective:** Reorganize home screen to show dashboard data first, with floating action buttons for quick access

**Request:** Move nutrition dashboard to the top of the home screen for immediate visibility. Replace inline action cards with a vertical FAB stack (Quick Select primary, Take Photo secondary, Chat secondary) floating on the bottom-right, always accessible while scrolling.

**Linear Issues:** FOO-669, FOO-670, FOO-671, FOO-672

**Approach:** Create a new FloatingActions client component with three stacked icon-only link buttons. Restructure the home page Server Component to render DashboardShell immediately after the title. Update the loading skeleton to match the new layout. Update E2E tests that reference the old action card text.

**Scope:**
- Tasks: 4
- Files affected: 8 (2 new, 6 modified)
- New tests: yes (FloatingActions component tests)

**Key Decisions:**
- FABs render only on the home page (inside page.tsx), not globally in layout.tsx
- z-[55] positions FABs above bottom nav (z-50) but below chat overlay (z-[60]) and dialogs (z-[70])
- Quick Select is the primary FAB (56px, accent color) — most frequently used action
- LumenBanner moves below DashboardShell (after the data it contextualizes, not before)

**Risks/Considerations:**
- FAB overlap with right-aligned content (macro values "36g") when scrolling — mitigated by FABs being small and content having left-aligned labels
- 40px secondary FABs meet the 44px touch target minimum if we account for gap spacing, but may need padding adjustment
- Bottom nav still has Quick Select tab — intentional redundancy (nav = page switching, FAB = shortcut from home)

---

## Iteration 1

**Implemented:** 2026-02-19
**Method:** Single-agent (effort score 6, 3 units — worker overhead exceeds implementation time)

### Tasks Completed This Iteration
- Task 1: Create FloatingActions component (FOO-669) — New client component with 3 stacked FABs, 5 unit tests
- Task 2: Reorganize home page layout (FOO-670) — Dashboard first, removed action cards, added FloatingActions
- Task 3: Update loading skeleton (FOO-671) — Removed card skeletons, added toggle skeleton
- Task 4: Update E2E dashboard tests (FOO-672) — Updated selectors from text to aria-label roles

### Files Modified
- `src/components/floating-actions.tsx` — Created FloatingActions client component
- `src/components/__tests__/floating-actions.test.tsx` — Created 5 unit tests
- `src/app/app/page.tsx` — Removed action cards, reordered to dashboard-first, added FloatingActions
- `src/app/app/__tests__/page.test.tsx` — Updated mocks and assertions, added DashboardShell mock
- `src/app/app/loading.tsx` — Simplified skeleton to heading + toggle + preview
- `src/app/app/__tests__/loading.test.tsx` — Updated to match new skeleton structure
- `e2e/tests/dashboard.spec.ts` — Updated FAB selectors to use aria-label roles

### Linear Updates
- FOO-669: Todo → In Progress → Review
- FOO-670: Todo → In Progress → Review
- FOO-671: Todo → In Progress → Review
- FOO-672: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 4 issues (1 false positive z-index, 1 fixed DashboardShell mock, 2 cosmetic skips)
- verifier: All 2,060 tests pass, zero warnings, build clean

### Continuation Status
All tasks completed.
