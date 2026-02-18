# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-601-critical-bugs
**Issues:** FOO-601, FOO-602, FOO-603, FOO-606, FOO-607
**Created:** 2026-02-18
**Last Updated:** 2026-02-18

## Summary

Fix 5 critical bugs affecting visual correctness, accessibility, and security: a washed-out confirmation screen in light mode, missing landmarks on the chat page, broken settings page layout, broken color tokens in the pending submission handler, and missing Content-Security-Policy header.

## Issues

### FOO-601: Analyze confirmation screen washed out in light mode

**Priority:** Urgent
**Labels:** Bug
**Description:** The success confirmation screen after logging food is reportedly nearly unreadable in light mode. The dark mode version renders correctly (vibrant green checkmark, white text, solid Done button). The light mode version may appear washed out. This was identified from E2E screenshot review.

**Acceptance Criteria:**
- [ ] Success confirmation text is clearly readable in both light and dark mode
- [ ] Done button is visually distinct and looks interactive in both modes
- [ ] Green checkmark icon is vibrant in both modes
- [ ] Contrast ratio meets WCAG AA (4.5:1) for all text elements

### FOO-602: Chat page missing landmark structure (main, h1, SkipLink)

**Priority:** High
**Labels:** Bug
**Description:** The Chat page (`/app/chat`) has no `<main>` landmark, no `<h1>` heading (when analysis is present), and no SkipLink. Every other app page has all three. Screen reader users and keyboard users have no landmarks or route announcement.

**Acceptance Criteria:**
- [ ] Chat page has `<main id="main-content">` landmark
- [ ] Chat page always has an `<h1>` heading (visible or sr-only)
- [ ] `<SkipLink />` present on chat page
- [ ] Route navigation announced by Next.js route announcer

### FOO-603: Settings page layout broken — sections outside main, inconsistent widths

**Priority:** High
**Labels:** Bug
**Description:** The Settings page has two structural problems: (1) `SettingsContent` closes `<main>` at its own boundary, causing `ApiKeyManager`, `ClaudeUsageSection`, and `AboutSection` to render outside the main landmark. (2) `SettingsContent` uses `max-w-sm` (384px) while the sections below use `max-w-2xl` (672px), creating a jarring width jump.

**Acceptance Criteria:**
- [ ] All settings sections are within a single `<main>` landmark
- [ ] Consistent max-width across all settings sections
- [ ] Valid heading hierarchy (no skipped levels)
- [ ] No jarring width changes when scrolling
- [ ] SkipLink still present and functional

### FOO-606: Pending submission handler uses broken color tokens

**Priority:** High
**Labels:** Bug
**Description:** Two color issues: (1) Resubmitting alert uses `text-primary-foreground` (near-white in light mode, oklch 0.985) on `bg-primary/10` (very light background), making text invisible. (2) Success state uses hardcoded `border-green-500 bg-green-500/10 text-green-600 text-green-900` bypassing semantic tokens — `text-green-900` is nearly invisible on dark backgrounds.

**Acceptance Criteria:**
- [ ] Resubmitting alert text readable in both light and dark mode (4.5:1 contrast)
- [ ] Success state text readable in both modes
- [ ] All colors use semantic theme tokens, no hardcoded color values

### FOO-607: No Content-Security-Policy header configured

**Priority:** High
**Labels:** Security
**Description:** The app has no CSP header (`next.config.ts` headers section). The app uses `dangerouslySetInnerHTML` for an inline theme script in `layout.tsx:70`. Without CSP, injected scripts run unchecked.

**Acceptance Criteria:**
- [ ] Content-Security-Policy header present in all responses
- [ ] Inline theme script continues to work under the CSP
- [ ] No external scripts can execute without explicit allowlisting
- [ ] Image sources allow `data:` and `blob:` (needed for photo handling)
- [ ] Build and tests pass with the new header

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] `npm install` up to date
- [ ] Tests passing (`npm test`)

## Implementation Tasks

### Task 1: Investigate and fix confirmation screen light mode colors (FOO-601)

**Issue:** FOO-601
**Files:**
- `src/components/food-log-confirmation.tsx` (modify)
- `src/components/__tests__/food-log-confirmation.test.tsx` (modify)

**TDD Steps:**

1. **INVESTIGATE** — Run the E2E screenshot suite and visually inspect `e2e/screenshots/light/analyze-confirmation.png` vs `dark/analyze-confirmation.png`. The issue was identified from screenshot review, so the first step is to reproduce and understand what's actually wrong.

2. **RED** — Based on findings, write a test in `food-log-confirmation.test.tsx` that asserts the correct CSS classes are applied. For example, if the issue is incorrect color token usage, test that the rendered output uses the correct token classes (e.g., `text-foreground` instead of `text-primary-foreground`). If the icon uses a color that doesn't meet contrast requirements, assert the correct class.

3. **GREEN** — Fix the color tokens in `food-log-confirmation.tsx`. Reference the dark mode version as the correct design intent. Key areas to audit:
   - CheckCircle icon: currently `text-success` — verify this resolves to a visible green in light mode (oklch 0.691 on white background)
   - Heading text: inherits `text-foreground` — should be near-black in light mode
   - NutritionFactsCard: rendered inline, uses `border-foreground` — verify contrast
   - Done button: `variant="default"` — should be dark bg with white text

4. **REFACTOR** — If no actual code bug is found (the CSS tokens are correct and the screenshot shows normal rendering), close the issue with a comment explaining the findings. The issue may have been a screenshot timing artifact (captured during the `animate-slide-up` animation at partial opacity).

**Notes:**
- E2E screenshots are generated by Playwright. Run `npm run e2e` to regenerate.
- Light mode CSS variables: `--success: oklch(0.691 0.169 145.477)`, `--foreground: oklch(0.145 0 0)`, `--primary: oklch(0.205 0 0)`, `--primary-foreground: oklch(0.985 0 0)`
- The confirmation is rendered in two contexts: `food-analyzer.tsx:567-577` (analyze flow) and `chat-page-client.tsx:17-25` (chat flow). Check both.

### Task 2: Add landmark structure to chat page (FOO-602)

**Issue:** FOO-602
**Files:**
- `src/app/app/chat/page.tsx` (modify)
- `src/components/chat-page-client.tsx` (modify)
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify — if it exists, otherwise create)

**TDD Steps:**

1. **RED** — Write tests asserting:
   - The chat page renders a `<main id="main-content">` landmark
   - An `<h1>` heading is always present (even when `latestAnalysis` mode shows the MealTypeSelector + Log button header instead of the simple title header)
   - A SkipLink component is rendered

2. **GREEN** — Implement the changes:
   - In `src/app/app/chat/page.tsx`: Add `<SkipLink />` before the client component
   - In `src/components/chat-page-client.tsx`: Wrap the content in `<main id="main-content">`. The confirmation state already wraps in a `<div className="min-h-screen ...">` — add `<main>` around it. The FoodChat state renders a `fixed inset-0` overlay — the `<main>` should wrap FoodChat too.
   - In `src/components/food-chat.tsx`: When `latestAnalysis` is present (lines 521-552), the header has no `<h1>`. Add an sr-only `<h1>` (e.g., `<h1 className="sr-only">Chat</h1>`) so the Next.js route announcer can find it. The simple header mode (lines 554-564) already has `<h1>`.

3. **REFACTOR** — Verify the SkipLink target `#main-content` correctly focuses the main landmark. The existing `SkipLink` component (in `src/components/skip-link.tsx`) defaults to `#main-content`.

**Notes:**
- Pattern reference: `src/app/app/setup-fitbit/page.tsx` shows the standard landmark pattern — `<SkipLink />` + `<main id="main-content">` wrapping content.
- FoodChat uses `fixed inset-0 z-[60]` positioning — the `<main>` wrapper must not interfere with this layout. Consider adding `<main>` with just `id="main-content"` and `className="contents"` (CSS `display: contents`) so it acts as a semantic-only wrapper.
- The chat page's `<SkipLink />` must be rendered in the Server Component (`page.tsx`) to be in the DOM before hydration. Since SkipLink is not a client component, this works directly.

### Task 3: Fix settings page layout (FOO-603)

**Issue:** FOO-603
**Files:**
- `src/app/settings/page.tsx` (modify)
- `src/components/settings-content.tsx` (modify)
- `src/components/__tests__/settings-content.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests asserting:
   - All settings sections (profile/auth card, Fitbit credentials card, appearance card, API keys, Claude usage, About) are within a single `<main>` element
   - The `<main>` element has `id="main-content"`
   - All sections have consistent max-width (no `max-w-sm` vs `max-w-2xl` mismatch)
   - Heading hierarchy is valid: `<h1>` Settings, then `<h2>` for each section

2. **GREEN** — Restructure the layout:
   - **Option A (recommended):** Move `<main>` and `<SkipLink>` to `settings/page.tsx`. Have `SettingsContent` render only its cards (no `<main>`, no `<SkipLink>`, no `min-h-screen` centering). The page file wraps everything in a single `<main>` with consistent width.
   - Remove the `flex min-h-screen items-center justify-center` centering from `SettingsContent` — settings is a scrollable page, not a centered card.
   - Use `max-w-2xl` for all sections (matching the current ApiKeyManager/ClaudeUsage/About width) instead of `max-w-sm`.
   - Verify heading hierarchy: `SettingsContent` has `<h1>Settings</h1>` + `<h2>Fitbit App Credentials</h2>` + `<h2>Appearance</h2>`. `ApiKeyManager` should use `<h2>` (check its current heading level). `ClaudeUsageSection` should use `<h2>`. `AboutSection` already uses `<h2>`.
   - Keep the back arrow button — despite FOO-629 noting it's inconsistent, that issue is separate and in the backlog.

3. **REFACTOR** — Remove the `min-h-screen items-center justify-center` vertical centering. Settings is a content-heavy scrollable page that should start at the top, not be centered. Use top padding consistent with other app pages.

**Notes:**
- Current structure: `SettingsContent` renders `<div class="flex min-h-screen items-center justify-center"><SkipLink /><main id="main-content" class="max-w-sm">...cards...</main></div>`. Then page.tsx renders sibling `<div class="max-w-2xl">...more sections...</div>`.
- Target structure: `page.tsx` renders `<SkipLink /><main id="main-content" class="max-w-2xl mx-auto px-4 py-6 pb-24">` wrapping both `<SettingsContent />` and the additional sections.
- `SettingsContent` is a client component (uses `useState`, `useSWR`). The `<main>` wrapper should be in the server component (`page.tsx`).

### Task 4: Fix pending submission handler color tokens (FOO-606)

**Issue:** FOO-606
**Files:**
- `src/components/pending-submission-handler.tsx` (modify)
- `src/components/__tests__/pending-submission-handler.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write tests asserting the correct CSS classes for each state:
   - Resubmitting state: Alert should NOT have `text-primary-foreground` class. Should use `text-primary` or `text-foreground`.
   - Success state: Alert should NOT have hardcoded `text-green-*` classes. Should use semantic `text-success` / `border-success` / `bg-success/10` tokens.

2. **GREEN** — Fix the color tokens in `pending-submission-handler.tsx`:
   - **Resubmitting state (line 114-119):** Change `bg-primary/10` + `text-primary-foreground` → use `bg-info/10 border-info` + `text-info-foreground` (or `text-foreground`). The resubmitting state is informational, not a primary action. Using the `info` semantic tokens is most appropriate. The Loader2 icon can use `text-info`.
   - **Success state (lines 125-129):** Replace `border-green-500 bg-green-500/10` → `border-success bg-success/10`. Replace `text-green-600` on icon → `text-success`. Replace `text-green-900` on text → `text-success-foreground` (or `text-foreground`). Check that `--success` and `--success-foreground` have good contrast in both modes.

3. **REFACTOR** — Verify the semantic tokens provide correct contrast:
   - Light mode: `--success: oklch(0.691 0.169 145.477)` (green), `--success-foreground: oklch(0.985 0 0)` (near-white)
   - Dark mode: `--success: oklch(0.753 0.159 145.477)` (lighter green), `--success-foreground: oklch(0.145 0 0)` (near-black)
   - For the success alert, `text-success` on a light `bg-success/10` background should provide good contrast in both modes. The `text-success-foreground` token (near-white in light mode) would NOT work on a light background — use `text-success` or `text-foreground` instead.

**Notes:**
- Pattern reference: The existing `Alert variant="destructive"` in the error state (lines 136-140) correctly uses the destructive variant with inherited colors — no hardcoded values.
- The `info` tokens exist in the design system: `--info: oklch(0.567 0.214 254.604)` (light), `--info-foreground: oklch(0.205 0 0)` (light). These are blue-toned and appropriate for "in progress" states.
- Existing test file at `src/components/__tests__/pending-submission-handler.test.tsx` already tests state transitions. Add class assertions to existing test cases.

### Task 5: Add Content-Security-Policy header (FOO-607)

**Issue:** FOO-607
**Files:**
- `next.config.ts` (modify)
- `src/components/__tests__/csp-header.test.ts` (create — optional, see notes)

**TDD Steps:**

1. **RED** — Write a test that verifies the CSP header is present and contains required directives. Since `next.config.ts` headers are returned as an async function, test the function output directly by importing the config or by writing an integration test that checks the actual response headers.

   Alternatively, since this is a configuration change with no runtime logic, the build verification (`npm run build`) and manual verification via `curl -I` may be sufficient. Use judgment on whether a unit test adds value here.

2. **GREEN** — Add a CSP header to `next.config.ts`:

   The app's resource requirements:
   - **Scripts:** Self-hosted only + one inline theme script → `script-src 'self' 'unsafe-inline'`
   - **Styles:** Tailwind CSS (bundled by Next.js) + potential inline styles → `style-src 'self' 'unsafe-inline'`
   - **Images:** Self-hosted + data URIs (base64 images) + blob URIs (camera/gallery) → `img-src 'self' data: blob:`
   - **Connections:** Same-origin API calls only → `connect-src 'self'`
   - **Fonts:** Next.js self-hosts Google fonts → `font-src 'self'`
   - **Frames:** Already blocked by X-Frame-Options: DENY → `frame-ancestors 'none'`
   - **Default:** Restrict everything else → `default-src 'self'`
   - **Base URI:** Prevent base tag injection → `base-uri 'self'`
   - **Form actions:** Allow form submissions to self only → `form-action 'self'`

   Add the header to the existing headers array in `next.config.ts`, alongside the other security headers.

   Note: `'unsafe-inline'` for `script-src` is a pragmatic starting point. The inline theme script prevents flash-of-wrong-theme and can't easily use a nonce with Next.js static export. A future improvement could migrate to nonce-based CSP.

3. **REFACTOR** — After adding the CSP, run `npm run build` and `npm run dev` to verify:
   - The inline theme script still works (no CSP violation in browser console)
   - Images load correctly (photo capture, gallery)
   - API calls work (fetch to /api/* endpoints)
   - Google fonts load (self-hosted by Next.js, should be under `'self'`)

**Notes:**
- The `X-Frame-Options: DENY` header can be kept alongside `frame-ancestors 'none'` for backward compatibility with older browsers.
- Do NOT add `'unsafe-eval'` — the app has no eval usage and this would weaken the CSP significantly.
- Railway deployment should inherit the CSP from `next.config.ts` headers — no separate config needed.
- The app has no external CDN scripts, analytics, or third-party integrations that would need allowlisting.

### Task 6: Integration verification

**Issue:** FOO-601, FOO-602, FOO-603, FOO-606, FOO-607
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run build: `npm run build`
5. Manual verification:
   - [ ] Start dev server and check Settings page layout in both modes
   - [ ] Check chat page with screen reader or accessibility inspector
   - [ ] Verify pending submission handler colors (trigger via Fitbit token expiry flow)
   - [ ] Inspect CSP header via browser DevTools Network tab
   - [ ] Check browser console for CSP violations
6. Run E2E tests: `npm run e2e` (generates fresh screenshots for FOO-601 verification)

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| CSP blocks legitimate resource | Adjust policy directive | Manual + build verification |
| Settings layout breaks on narrow screens | Responsive max-w with px-4 padding | Visual inspection |
| Chat SkipLink target missing | SkipLink href matches main id | Unit test |
| Semantic tokens undefined | Build fails (Tailwind compile) | Build verification |

## Risks & Open Questions

- [ ] **FOO-601 may not be a code bug.** The E2E screenshots may have captured the confirmation during the `animate-slide-up` animation (at partial opacity). If investigation reveals no actual color token issue, close with a comment explaining findings.
- [ ] **CSP with `'unsafe-inline'`** is a stepping stone, not the final security posture. A nonce-based approach would be stronger but requires Next.js middleware changes. This is acceptable as a first iteration.
- [ ] **Settings page restructure** changes the visual layout. The back arrow (FOO-629) and vertical centering removal change the page's look. The fix is correct per the issue requirements but the user should verify the new layout.

## Scope Boundaries

**In Scope:**
- Fix color tokens for confirmation and pending submission (FOO-601, FOO-606)
- Add landmark structure to chat page (FOO-602)
- Restructure settings page layout (FOO-603)
- Add CSP header (FOO-607)

**Out of Scope:**
- FOO-608: Setup Fitbit excessive whitespace (Canceled — standard centered layout)
- FOO-611: Landing page excessive whitespace (Canceled — standard centered layout)
- FOO-625: Food history raw fetch (Canceled — initial load already uses SWR)
- FOO-627: Chat messages anchored to top (Canceled — auto-scroll already implemented)
- FOO-639: Chat "+" button no label (Canceled — already has aria-label="Add photo")
- Remaining 26 backlog issues (deferred to next batch)
- Nonce-based CSP (future improvement beyond this plan)
- Settings back arrow removal (FOO-629 — separate backlog issue)
