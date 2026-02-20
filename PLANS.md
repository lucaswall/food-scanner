# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-678-navigation-restructure
**Issues:** FOO-678, FOO-679, FOO-680, FOO-681
**Created:** 2026-02-20
**Last Updated:** 2026-02-20

## Summary

Restructure the app's navigation system: refactor Chat from a full-screen overlay to a layout page, replace Settings with Chat in the bottom nav, add swipe gesture navigation between tabs, and update E2E tests for all changes. This is a cohesive set of 4 issues with strict dependencies: FOO-678 → FOO-679 → FOO-680 → FOO-681.

## Issues

### FOO-678: Refactor Chat page from full-screen overlay to app layout page

**Priority:** High
**Labels:** Feature
**Description:** The Chat page renders as a full-screen overlay (`fixed inset-0 z-[60]`) that hides the bottom navigation. This must be refactored so Chat can become a bottom nav tab where users can see and use the nav bar while in chat.

**Key constraint:** FoodChat is used in two contexts:
1. `/app/chat` page via ChatPageClient — must render within app layout (new behavior)
2. Analyze page refine flow via `food-analyzer.tsx` line 565 — must remain an overlay

**Acceptance Criteria:**
- [ ] FoodChat component no longer uses `fixed inset-0 z-[60]` — it fills its parent container
- [ ] Chat page (`/app/chat`) renders within app layout with BottomNav visible
- [ ] Chat messages scroll within the chat container (not the whole page)
- [ ] Chat input sits above BottomNav, not overlapping it
- [ ] Refine chat from Analyze page still works as an overlay
- [ ] FoodLogConfirmation renders within the layout, not fullscreen
- [ ] Chat loading skeleton matches new layout
- [ ] Back arrow still works for returning to previous screen

### FOO-679: Restructure bottom nav: new tab order with Chat, without Settings

**Priority:** High
**Labels:** Feature
**Description:** Settings occupies a prime bottom nav slot despite being rarely used. Chat is hidden behind a header icon. Restructure: new tab order Home, History, Analyze, Quick Select, Chat. Move Settings to a header gear icon on the Home page. Remove Camera shortcut from header (redundant with Analyze tab).

**Acceptance Criteria:**
- [ ] Bottom nav shows 5 tabs: Home, History, Analyze, Quick Select, Chat
- [ ] Settings is NOT in the bottom nav
- [ ] Chat tab uses MessageCircle icon and links to `/app/chat`
- [ ] Home page header shows Settings gear icon (links to `/settings`)
- [ ] Camera shortcut removed from header
- [ ] On `/settings` page, BottomNav renders but no tab is highlighted
- [ ] Active state (`aria-current="page"`) works correctly for all tabs

### FOO-680: Add swipe navigation between bottom nav tabs

**Priority:** Medium
**Labels:** Feature
**Description:** Add left/right swipe gesture navigation between tabs using `react-swipeable`. Entry animation with CSS `translateX`, direction-lock threshold, edge handling, Safari back-swipe mitigation via `router.replace()`, accessibility support.

**Acceptance Criteria:**
- [ ] Swipe left → next tab, swipe right → previous tab
- [ ] No navigation past first (Home) or last (Chat) tab
- [ ] Entry animation: ~250ms ease-out CSS translateX from correct direction
- [ ] Direction-lock: first 10px of movement determines horizontal vs vertical
- [ ] Pull-to-refresh prevention: `overscroll-behavior-y: contain`
- [ ] History stack stays flat: `router.replace()` used for swipe nav
- [ ] Swipe disabled when dialog/modal open
- [ ] Swipe disabled when text input focused (Chat page)
- [ ] Respects `prefers-reduced-motion` — skip animation, navigate instantly
- [ ] Animated active indicator on BottomNav transitions between tabs
- [ ] Touch-only (no mouse-drag equivalent needed)
- [ ] Settings page (`/settings`) does NOT participate in swipe

### FOO-681: Update E2E tests for navigation restructure and swipe

**Priority:** Medium
**Labels:** Improvement
**Description:** Existing E2E tests validate old 5-tab nav order (Home, Quick Select, Analyze, History, Settings) and header actions (Chat, Camera). All must be updated for the new structure.

**Acceptance Criteria:**
- [ ] `navigation.spec.ts` updated for new tab order and Chat tab
- [ ] `dashboard.spec.ts` updated for Settings gear icon in header
- [ ] `refine-chat.spec.ts` verified — overlay behavior preserved from Analyze
- [ ] Chat nav tab E2E test: navigates to /app/chat, BottomNav visible, active state
- [ ] Settings accessibility: gear icon visible, navigates to /settings, no active tab
- [ ] Swipe gesture logic tested via unit tests (Playwright touch API limited)

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] No active PLANS.md (previous plan is COMPLETE)

## Implementation Tasks

### Task 1: Remove fixed overlay from FoodChat and make it a layout component

**Issue:** FOO-678
**Files:**
- `src/components/__tests__/food-chat.test.tsx` (modify)
- `src/components/food-chat.tsx` (modify)

**TDD Steps:**

1. **RED** — Update food-chat.test.tsx:
   - Assert FoodChat root element does NOT have `fixed` positioning class
   - Assert FoodChat root is a flex column (`flex flex-col`) that fills its parent
   - Assert header does NOT have `pt-[max(0.5rem,env(safe-area-inset-top))]`
   - Assert input area does NOT have `pb-[max(0.5rem,env(safe-area-inset-bottom))]`
   - Run: `npm test -- food-chat`
   - Verify: Tests fail (FoodChat still has fixed overlay)

2. **GREEN** — Update food-chat.tsx:
   - Remove `fixed inset-0 z-[60] bg-background` from root div (line 517)
   - Replace with flex column that fills parent: the root div becomes a flex column stretching to fill available space
   - Remove safe-area-inset-top padding from the header div (line 545)
   - Remove safe-area-inset-bottom padding from input container (line 780)
   - Keep all chat functionality (messages, input, scroll, SSE, images) unchanged
   - Run: `npm test -- food-chat`
   - Verify: Tests pass

3. **REFACTOR** — Review that no unused safe-area classes remain

**Notes:**
- The `onClose` prop and back arrow behavior remain unchanged — user navigates to /app (or uses nav bar)
- `z-[70]` on dialogs/SelectContent remains unchanged
- All internal scroll logic (scrollContainerRef, handleScroll, scrollToBottom) stays the same — the messages area still uses `flex-1 overflow-y-auto`

### Task 2: Update ChatPageClient and chat loading skeleton for layout rendering

**Issue:** FOO-678
**Files:**
- `src/components/chat-page-client.tsx` (modify)
- `src/app/app/chat/loading.tsx` (modify)

**TDD Steps:**

1. **RED** — No new unit tests needed for ChatPageClient (behavior tested via E2E). Verify build passes after changes.

2. **GREEN** — Update chat-page-client.tsx:
   - Wrap FoodChat in a height-constrained container that fills available space between the top of the page and the BottomNav (viewport height minus BottomNav height, approximately `h-[calc(100dvh-5rem)]`)
   - FoodLogConfirmation state: remove the `min-h-screen flex items-center justify-center p-4` wrapper (line 18) — render confirmation within the same height-constrained container
   - The container should use flex column layout so FoodChat fills it

3. **GREEN** — Update chat/loading.tsx:
   - Remove `fixed inset-0 z-[60]` overlay pattern from root div (line 5)
   - Match the new layout structure: height-constrained flex column with header skeleton, message area skeleton, and input area skeleton
   - Remove safe-area-inset-top from header and safe-area-inset-bottom from input

4. **REFACTOR** — Verify chat loading skeleton visually matches the loaded state structure

**Notes:**
- The `pb-20` on the app layout parent adds bottom padding for BottomNav clearance — the chat container's strict height accounts for this
- Use `100dvh` (not `100vh`) for dynamic viewport height on mobile (accounts for collapsing browser chrome)
- Reference: app layout at `src/app/app/layout.tsx` wraps children in `<div className="pb-20">`

### Task 3: Preserve overlay behavior for Analyze page refine flow

**Issue:** FOO-678
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify, if overlay assertions exist)

**TDD Steps:**

1. **RED** — Check existing food-analyzer tests for chat overlay assertions. If they exist, they should still pass after wrapping FoodChat. If not, add a test that when chatOpen is true, FoodChat is rendered inside a fixed overlay container.
   - Run: `npm test -- food-analyzer`

2. **GREEN** — In food-analyzer.tsx around line 562-577:
   - Wrap the FoodChat render in a fixed overlay container div with `fixed inset-0 z-[60] flex flex-col bg-background`
   - This preserves the exact same visual behavior FoodChat previously had on its own
   - Run: `npm test -- food-analyzer`
   - Verify: Tests pass

3. **REFACTOR** — Clean up the comment on line 562 (`// Show full-screen chat if open (FoodChat uses fixed positioning)`) — FoodChat no longer uses fixed positioning; the wrapper does

**Notes:**
- The overlay wrapper takes the `fixed inset-0 z-[60] bg-background` classes that were removed from FoodChat
- onClose (`setChatOpen(false)`) and onLogged callbacks remain unchanged
- Safe-area insets should be on the overlay wrapper's header/input areas — the wrapper should include `pt-[max(0.5rem,env(safe-area-inset-top))]` on top and `pb-[max(0.5rem,env(safe-area-inset-bottom))]` on bottom for the overlay context
- This is the only location (besides ChatPageClient) that renders FoodChat

### Task 4: Update BottomNav with new tab order and Chat tab

**Issue:** FOO-679
**Files:**
- `src/components/__tests__/bottom-nav.test.tsx` (modify)
- `src/components/bottom-nav.tsx` (modify)

**TDD Steps:**

1. **RED** — Update bottom-nav.test.tsx:
   - Change "renders five nav items" test: assert Home, History, Analyze, Quick Select, Chat (in that order)
   - Add test: Chat links to `/app/chat`
   - Add test: Chat is active when pathname is `/app/chat`
   - Remove test: "Settings links to /settings" and "Settings is active when on /settings"
   - Update label regex tests to match new set: `Home|History|Analyze|Quick Select|Chat`
   - Add test: when pathname is `/settings`, no nav item has `aria-current`
   - Run: `npm test -- bottom-nav`
   - Verify: Tests fail

2. **GREEN** — Update bottom-nav.tsx:
   - Change `navItems` array to: Home (`/app`), History (`/app/history`, Clock icon), Analyze (`/app/analyze`, ScanEye icon), Quick Select (`/app/quick-select`, ListChecks icon), Chat (`/app/chat`, MessageCircle icon)
   - Remove Settings import, add MessageCircle import from lucide-react
   - Chat isActive: `pathname === "/app/chat"` (exact match)
   - Run: `npm test -- bottom-nav`
   - Verify: Tests pass

3. **REFACTOR** — Consider exporting the `navItems` array or tab paths as a constant for reuse by the swipe navigation hook (FOO-680). If extracting, place in `src/lib/navigation.ts`.

**Notes:**
- Settings page at `/settings` still renders BottomNav via `src/app/settings/layout.tsx` but no tab highlights — this is the desired behavior since Settings is no longer a nav item
- The BottomNav's `isActive` functions use exact path matching — no startsWith needed

### Task 5: Replace HeaderActions with Settings gear icon

**Issue:** FOO-679
**Files:**
- `src/components/__tests__/header-actions.test.tsx` (modify)
- `src/components/header-actions.tsx` (modify)

**TDD Steps:**

1. **RED** — Update header-actions.test.tsx:
   - Assert single link rendered (not 2)
   - Assert Settings link with href `/settings`
   - Assert uses Settings icon from lucide-react
   - Assert NO Chat link rendered
   - Assert NO "Take Photo" / Camera link rendered
   - Assert touch target 44x44px
   - Run: `npm test -- header-actions`
   - Verify: Tests fail

2. **GREEN** — Update header-actions.tsx:
   - Replace Chat + Camera links with a single Settings gear icon link
   - Import `Settings` icon from lucide-react (replace `Camera`, `MessageCircle` imports)
   - Link to `/settings` with aria-label "Settings"
   - Keep existing styling pattern for the link (rounded-full, muted-foreground, 44px touch target)
   - Run: `npm test -- header-actions`
   - Verify: Tests pass

3. **REFACTOR** — Remove unused imports (Camera, MessageCircle)

**Notes:**
- HeaderActions is only used on the Home page (`src/app/app/page.tsx` line 23)
- The Home page import and usage remain the same — only the component's content changes
- Camera shortcut is removed because Analyze tab serves the same purpose

### Task 6: Install react-swipeable and create swipe navigation hook

**Issue:** FOO-680
**Files:**
- `package.json` (modify — via npm install)
- `src/hooks/use-swipe-navigation.ts` (create)
- `src/hooks/__tests__/use-swipe-navigation.test.ts` (create)

**TDD Steps:**

1. Install react-swipeable: `npm install react-swipeable`

2. **RED** — Create use-swipe-navigation.test.ts:
   - Mock `usePathname` and `useRouter` from next/navigation
   - Test: returns correct current tab index for each pathname (`/app` → 0, `/app/history` → 1, `/app/analyze` → 2, `/app/quick-select` → 3, `/app/chat` → 4)
   - Test: returns -1 for non-swipeable paths (`/settings`, `/app/food-detail/123`)
   - Test: `navigateToTab(index)` calls `router.replace(path)` with the correct path
   - Test: `canSwipeLeft` is false when at last tab (index 4)
   - Test: `canSwipeRight` is false when at first tab (index 0)
   - Test: `canSwipeLeft` and `canSwipeRight` are both false when current index is -1
   - Run: `npm test -- use-swipe-navigation`
   - Verify: Tests fail

3. **GREEN** — Create use-swipe-navigation.ts:
   - Define ordered tab paths array (import from shared nav config if extracted in Task 4, or define locally)
   - Hook reads current pathname and finds current tab index
   - Returns: `currentIndex`, `canSwipeLeft`, `canSwipeRight`, `navigateToTab(index)`
   - `navigateToTab` uses `router.replace()` (not `push`) for flat history stack
   - Run: `npm test -- use-swipe-navigation`
   - Verify: Tests pass

4. **REFACTOR** — Ensure tab paths array is the single source of truth (shared with BottomNav if extracted)

**Notes:**
- The hook is pure navigation logic — no gesture detection, no animation
- Gesture detection is handled by `react-swipeable` in the wrapper component (Task 7)
- Animation state is managed by the wrapper component (Task 7)
- `router.replace()` prevents Safari's back-swipe from creating unexpected navigation history

### Task 7: Create SwipeNavigationWrapper component

**Issue:** FOO-680
**Files:**
- `src/components/swipe-navigation-wrapper.tsx` (create)
- `src/components/__tests__/swipe-navigation-wrapper.test.tsx` (create)

**TDD Steps:**

1. **RED** — Create swipe-navigation-wrapper.test.tsx:
   - Mock useSwipeable from react-swipeable
   - Mock useSwipeNavigation hook
   - Test: renders children
   - Test: applies `touch-action: pan-y` on container
   - Test: calls navigateToTab with next index on swipe left (when canSwipeLeft)
   - Test: calls navigateToTab with previous index on swipe right (when canSwipeRight)
   - Test: does NOT navigate on swipe left when canSwipeLeft is false
   - Test: does NOT navigate on swipe right when canSwipeRight is false
   - Test: does NOT navigate when a dialog is open (check for `[data-state="open"]` on dialog elements)
   - Test: does NOT navigate when a text input/textarea is focused
   - Test: respects prefers-reduced-motion (skip animation, navigate instantly)
   - Run: `npm test -- swipe-navigation-wrapper`
   - Verify: Tests fail

2. **GREEN** — Create swipe-navigation-wrapper.tsx:
   - Client component (`'use client'`)
   - Uses `useSwipeable` from react-swipeable for gesture detection
   - Uses `useSwipeNavigation` hook for navigation logic
   - Direction-lock: configure swipeable with delta threshold (~10px), and check initial movement direction — if more vertical than horizontal, abandon swipe
   - On `onSwipedLeft`: if `canSwipeLeft`, navigate to `currentIndex + 1`
   - On `onSwipedRight`: if `canSwipeRight`, navigate to `currentIndex - 1`
   - Before navigating, check disable conditions: open dialog (`document.querySelector('[data-state="open"][role="dialog"]')`), focused input (`document.activeElement?.tagName === 'INPUT' || 'TEXTAREA'`)
   - CSS entry animation: maintain direction state and apply `animate-slide-in-left` or `animate-slide-in-right` class using CSS `@keyframes` with `transform: translateX()`
   - Duration: ~250ms ease-out
   - If `prefers-reduced-motion`: skip animation (no translateX, just instant render)
   - Container has `touch-action: pan-y` style
   - Run: `npm test -- swipe-navigation-wrapper`
   - Verify: Tests pass

3. **REFACTOR** — Extract animation keyframes to Tailwind config or a CSS module if needed

**Notes:**
- Reference the `animate-slide-up` pattern already used in `src/components/food-log-confirmation.tsx` line 41 for CSS animation approach
- Desktop: touch events only, no mouse-drag needed
- The animation is entry-only (new page slides in from correct direction). No exit animation — old page disappears and new page slides in. This matches native app behavior and avoids AnimatePresence issues with App Router.

### Task 8: Integrate swipe wrapper in app layout and add pull-to-refresh prevention

**Issue:** FOO-680
**Files:**
- `src/app/app/layout.tsx` (modify)
- `src/app/globals.css` or root layout (modify — for overscroll-behavior)

**TDD Steps:**

1. **GREEN** — Update app layout:
   - Import SwipeNavigationWrapper
   - Wrap the `{children}` div in SwipeNavigationWrapper
   - The wrapper sits between the pb-20 div and the actual page content

2. **GREEN** — Add overscroll-behavior-y: contain:
   - Add to `html` and/or `body` element styling to prevent pull-to-refresh from interfering with horizontal swipes
   - This can be done in globals.css or the root layout

3. Verify manually or via build that the layout still renders correctly

**Notes:**
- Settings page at `/settings` has its own layout (`src/app/settings/layout.tsx`) — it does NOT use the app layout, so swipe is naturally excluded from Settings
- `overscroll-behavior-y: contain` prevents the browser's native pull-to-refresh gesture on the outer scroll container

### Task 9: Add animated active indicator to BottomNav

**Issue:** FOO-680
**Files:**
- `src/components/__tests__/bottom-nav.test.tsx` (modify)
- `src/components/bottom-nav.tsx` (modify)

**TDD Steps:**

1. **RED** — Update bottom-nav.test.tsx:
   - Assert active indicator element exists within the nav
   - Assert indicator has a CSS transition class for smooth movement
   - Assert indicator position corresponds to the active tab index
   - Run: `npm test -- bottom-nav`
   - Verify: Tests fail

2. **GREEN** — Update bottom-nav.tsx:
   - Add an animated indicator element (bar or dot) positioned under the active tab
   - Use CSS `transition` and `transform: translateX()` to animate between positions
   - Calculate indicator position based on active tab index (each tab is 1/5 of nav width)
   - The indicator should transition smoothly on both tap navigation and swipe navigation
   - Run: `npm test -- bottom-nav`
   - Verify: Tests pass

3. **REFACTOR** — Ensure indicator respects `prefers-reduced-motion` (instant position change, no transition)

**Notes:**
- The indicator is a visual enhancement — purely CSS, no JavaScript animation library needed
- Reference: the nav currently has `max-w-md mx-auto` container with `flex justify-around`
- Active tab index can be derived from pathname using the same navItems array

### Task 10: Update navigation and dashboard E2E tests

**Issue:** FOO-681
**Files:**
- `e2e/tests/navigation.spec.ts` (modify)
- `e2e/tests/dashboard.spec.ts` (modify)

**TDD Steps:**

1. **RED** — Run existing E2E tests to confirm they fail with the new structure:
   - `npm run e2e -- --grep "Bottom Navigation|Dashboard"`

2. **GREEN** — Update navigation.spec.ts:
   - "shows all 5 navigation items": assert Home, History, Analyze, Quick Select, Chat (remove Settings)
   - "shows Home as active on /app": unchanged
   - "navigates to Quick Select": unchanged
   - "navigates to History": unchanged
   - Remove "navigates to Settings" test entirely
   - Add "navigates to Chat and shows it as active" test: click Chat, verify URL is `/app/chat`, verify `aria-current="page"`
   - "nav bar remains visible": remove Settings from the navigation chain, add Chat
   - Add "no active tab on Settings page": navigate to /settings via URL, verify nav visible but no `aria-current="page"` on any link

3. **GREEN** — Update dashboard.spec.ts:
   - Remove/update assertion for `getByRole('link', { name: 'Take Photo' })` — this link no longer exists in header
   - Update "displays dashboard layout" test: assert Settings gear icon link instead of Take Photo/Quick Select FABs
   - Update "action links navigate" test: test Settings gear navigates to `/settings`, remove Take Photo navigation test
   - Keep all dashboard content tests (daily/weekly tabs, calorie display, etc.) unchanged

4. Verify: `npm run e2e -- --grep "Bottom Navigation|Dashboard"`

### Task 11: Add Chat nav tab and refine-chat E2E tests

**Issue:** FOO-681
**Files:**
- `e2e/tests/navigation.spec.ts` (modify — may already be done in Task 10)
- `e2e/tests/refine-chat.spec.ts` (verify/modify)

**TDD Steps:**

1. **GREEN** — Verify refine-chat.spec.ts:
   - Run: `npm run e2e -- --grep "Refine Chat"`
   - The `setupChatOverlay` helper navigates to `/app/analyze`, triggers analysis, clicks "Refine with chat"
   - After Task 3's overlay wrapper, the refine chat should still work as a fixed overlay
   - If tests pass: no changes needed
   - If tests fail: update assertions to account for the overlay wrapper structure

2. **GREEN** — Add Chat-as-nav-tab E2E test (in navigation.spec.ts or refine-chat.spec.ts):
   - Navigate to `/app/chat` via bottom nav tap
   - Assert BottomNav is visible (not hidden by overlay)
   - Assert Chat tab has `aria-current="page"`
   - Assert chat greeting message is visible ("Hi! Ask me anything about your nutrition")
   - Navigate away via Home tab, then back to Chat — verify it works

**Notes:**
- Playwright does not support native touch/swipe gestures reliably — swipe logic is tested via unit tests in Task 7
- The `touchscreen.swipe()` API exists but is limited; unit tests for useSwipeNavigation provide better coverage

### Task 12: Integration & Verification

**Issue:** FOO-678, FOO-679, FOO-680, FOO-681
**Files:** Various files from previous tasks

**Steps:**

1. Run full unit test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run full E2E suite: `npm run e2e`
5. Build check: `npm run build`
6. Manual verification:
   - [ ] Chat page renders within layout with BottomNav visible
   - [ ] All 5 nav tabs work (tap navigation)
   - [ ] Settings gear icon on Home page navigates to /settings
   - [ ] Refine chat from Analyze still works as overlay
   - [ ] Swipe left/right navigates between tabs on mobile
   - [ ] Swipe respects edge boundaries (no wrap)
   - [ ] Swipe disabled when dialog open or input focused
   - [ ] Active indicator animates between tabs
   - [ ] No pull-to-refresh interference during swipe
   - [ ] Reduced motion: instant navigation, no slide animation

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Swipe on non-swipeable page (/settings) | No navigation occurs | Unit test |
| Swipe at edge (first/last tab) | No navigation, no error | Unit test |
| Swipe while dialog open | Swipe ignored | Unit test |
| Swipe while input focused | Swipe ignored | Unit test |
| Chat page with no network | Existing error handling in FoodChat | Existing tests |
| Browser without touch support | No swipe handlers attached, tap nav works | Graceful degradation |

## Risks & Open Questions

- [ ] **CSS height for chat container:** The exact height calculation for the chat page container (viewport minus BottomNav) needs careful testing on real mobile devices. `100dvh` accounts for collapsing browser chrome but safe-area-inset-bottom interaction with BottomNav height may need fine-tuning.
- [ ] **react-swipeable bundle size:** ~3KB gzipped per the issue. Verify actual impact on build size.
- [ ] **viewTransition in next.config.js:** The issue suggests considering `viewTransition: true` for free tap-based nav transitions. This is opt-in and degrades gracefully — implementer should evaluate whether it complements or conflicts with the custom swipe animation.
- [ ] **Overlay safe-area insets:** When FoodChat renders in the Analyze overlay context (Task 3), the overlay wrapper needs to handle safe-area insets that FoodChat no longer manages. Verify on iOS devices.

## Scope Boundaries

**In Scope:**
- FoodChat overlay → layout refactor
- Bottom nav tab reorder (Chat in, Settings out)
- Settings gear icon in Home header
- Swipe gesture navigation with react-swipeable
- CSS entry animation for swipe
- Animated active indicator on BottomNav
- Pull-to-refresh prevention
- All E2E test updates for nav changes

**Out of Scope:**
- Service worker / offline support
- Exit animation for page transitions (AnimatePresence broken with App Router per vercel/next.js#49279)
- Mouse-drag swipe on desktop
- Tab reordering or customization by user
- Chat page conversation persistence across navigations
