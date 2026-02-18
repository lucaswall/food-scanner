# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-586-markdown-autoscroll-commit-hash
**Issues:** FOO-586, FOO-587, FOO-588
**Created:** 2026-02-18
**Last Updated:** 2026-02-18

## Summary

Three independent UI/DX improvements: (1) render markdown in chat assistant messages instead of raw text, (2) auto-scroll to the analysis progress area when the user taps "Analyze Food", and (3) display the git commit hash alongside the version on staging to make deployed commits identifiable.

## Issues

### FOO-586: Chat messages display raw markdown instead of rendered text

**Priority:** Medium
**Labels:** Improvement
**Description:** The Claude AI model sends responses with markdown formatting (bold, lists, tables), but the chat UI renders them as plain text via `<p className="text-sm whitespace-pre-wrap">{msg.content}</p>` at `food-chat.tsx:610`. Users see literal `**` characters, raw pipe-delimited tables, and other formatting artifacts.

**Acceptance Criteria:**
- [ ] Assistant messages render markdown (bold, italic, lists, tables)
- [ ] `remark-gfm` plugin is included for table support (highest-impact formatting issue)
- [ ] User messages remain plain text
- [ ] Thinking messages (line 598) remain plain italic text
- [ ] Rendered markdown matches existing chat bubble typography (text-sm)
- [ ] Headings, images, and other block-level elements that don't belong in chat bubbles are restricted

### FOO-587: Analyze screen does not auto-scroll to show analysis progress

**Priority:** Medium
**Labels:** Improvement
**Description:** When pressing "Analyze Food" with images attached, the image previews push the button and progress area below the fold. After tapping, nothing visually changes in the viewport — users must manually scroll to see the analysis is happening.

**Acceptance Criteria:**
- [ ] After tapping "Analyze Food", the page scrolls to show the analysis progress indicator
- [ ] Scroll uses `behavior: 'smooth'` for a polished experience
- [ ] The `analysisSectionRef` (already exists at `food-analyzer.tsx:47`) is reused for the scroll target

### FOO-588: Staging version display should include commit hash

**Priority:** Low
**Labels:** Improvement
**Description:** Both staging and production display the same version string from `package.json`. There's no way to tell which commit is deployed on staging. The health route at `src/app/api/health/route.ts` returns bare `packageJson.version`, and the about section displays it as-is.

**Acceptance Criteria:**
- [ ] Staging displays version as `1.12.0+abc1234` (semver + 7-char commit hash)
- [ ] Production displays version as `1.12.0` (unchanged behavior)
- [ ] `/api/health` response includes a `commitHash` field (e.g., `"commitHash": "abc1234"`)
- [ ] The `version` field in `/api/health` reflects the environment-specific format
- [ ] Commit hash is injected at build time via `next.config.ts` (not runtime git commands)
- [ ] Locally (dev), commit hash falls back to empty string
- [ ] About section and health route tests updated

## Prerequisites

- [ ] `react-markdown` and `remark-gfm` npm packages installed (for FOO-586)

## Implementation Tasks

### Task 1: Install react-markdown and remark-gfm

**Issue:** FOO-586
**Files:**
- `package.json` (modify)

**Steps:**

1. Install `react-markdown` and `remark-gfm` as production dependencies via `npm install react-markdown remark-gfm`
2. Verify the install succeeded and both packages appear in `package.json` dependencies
3. Run `npm run typecheck` to confirm no type conflicts

**Notes:**
- `react-markdown` provides the `<ReactMarkdown>` component; `remark-gfm` adds GitHub Flavored Markdown support (tables, strikethrough, autolinks)
- Both are production dependencies because they run in the client bundle

### Task 2: Create ChatMarkdown component with tests

**Issue:** FOO-586
**Files:**
- `src/components/chat-markdown.tsx` (create)
- `src/components/__tests__/chat-markdown.test.tsx` (create)

**TDD Steps:**

1. **RED** — Write tests for the ChatMarkdown component:
   - Renders plain text as-is
   - Renders `**bold**` as a `<strong>` element
   - Renders markdown tables (pipe-delimited) into `<table>` elements (requires remark-gfm)
   - Renders numbered lists as `<ol>` elements
   - Does NOT render images (restrict via `allowedElements` or `disallowedElements`)
   - Does NOT render headings (h1-h6) — these don't belong in chat bubbles; should fall through as plain text or paragraphs
   - Applies `text-sm` base typography to match chat bubble styling
   - Run: `npm test -- chat-markdown`
   - Verify: Tests fail (component doesn't exist)

2. **GREEN** — Create the ChatMarkdown component:
   - A `'use client'` component that wraps `react-markdown` with `remarkPlugins={[remarkGfm]}`
   - Props: `content: string`
   - Use `disallowedElements` to block `img`, `h1`-`h6` (or `allowedElements` allowlist — whichever is cleaner)
   - Apply Tailwind `prose`-like styles inline (or minimal custom classes) so that tables, lists, and inline formatting look good inside the chat bubble's `text-sm` context. Do NOT add `@tailwindcss/typography` — hand-style the few elements that matter (table borders/padding, list spacing, paragraph spacing, strong/em)
   - The wrapper element should NOT add its own `<p>` — `react-markdown` generates `<p>` tags from markdown paragraphs already
   - Run: `npm test -- chat-markdown`
   - Verify: All tests pass

3. **REFACTOR** — Ensure the component is minimal and well-typed.

**Notes:**
- Reference existing component patterns in `src/components/` for file structure
- The component should be reusable but currently only used in food-chat.tsx
- `react-markdown` renders each block element (paragraph, table, list) as a proper HTML element — no need for `whitespace-pre-wrap`
- Test with `@testing-library/react` — use `render(<ChatMarkdown content="**bold**" />)` and query the DOM

### Task 3: Integrate ChatMarkdown into food-chat message rendering

**Issue:** FOO-586
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify, if needed)

**TDD Steps:**

1. **RED** — If any existing food-chat tests assert on the raw text rendering of assistant messages (e.g., checking for `<p>` with `whitespace-pre-wrap`), update them to expect the new ChatMarkdown rendering instead. Run: `npm test -- food-chat`

2. **GREEN** — Replace the plain text `<p>` at `food-chat.tsx:610` with the ChatMarkdown component:
   - For `msg.role === "assistant"`: render `<ChatMarkdown content={msg.content} />`
   - For `msg.role === "user"`: keep the existing `<p className="text-sm whitespace-pre-wrap">{msg.content}</p>`
   - The thinking messages at line 598 remain unchanged (already italic/muted)
   - Import ChatMarkdown at the top of the file
   - Run: `npm test -- food-chat`
   - Verify: All tests pass

3. **REFACTOR** — Remove any now-unnecessary `whitespace-pre-wrap` class from the assistant message branch if it was there.

**Notes:**
- Both the analyze-food SSE path (`needs_chat` event) and the direct chat path render through the same `food-chat.tsx:610` line — single fix point
- The `MiniNutritionCard` below the message (line 611-618) is unaffected — it's a sibling to the text content

### Task 4: Add auto-scroll to analysis progress on analyze click

**Issue:** FOO-587
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Write a test that clicks the "Analyze Food" button (with a photo or description present so `canAnalyze` is true) and asserts that `scrollIntoView` was called on the analysis section element. Mock `scrollIntoView` on `Element.prototype` (pattern already used in `food-chat.test.tsx:44`). Run: `npm test -- food-analyzer.test`

2. **GREEN** — In `handleAnalyze()` in `food-analyzer.tsx`, after the `setLoading(true)` call (around line 160), add a `scrollIntoView({ behavior: 'smooth' })` call on `analysisSectionRef.current`. The ref already exists (line 47) and points to the analysis section `<div>` (line 638). Run: `npm test -- food-analyzer.test`

3. **REFACTOR** — Verify the scroll timing feels right. The scroll should happen when loading starts (so the user sees the spinner), not when analysis completes (the focus effect at line 472 already handles that).

**Notes:**
- The `analysisSectionRef` is already wired up at line 638 — no new refs needed
- `scrollIntoView` is already mocked in `food-chat.test.tsx` (line 44) — follow the same pattern
- The scroll call should be unconditional during analyze (not gated on image count) since even text-only analysis benefits from seeing the progress area

### Task 5: Expose commit hash at build time via next.config.ts

**Issue:** FOO-588
**Files:**
- `next.config.ts` (modify)

**Steps:**

1. Add an `env` property to the Next.js config that captures `RAILWAY_GIT_COMMIT_SHA` at build time and exposes it as `COMMIT_SHA` (server-side only, no `NEXT_PUBLIC_` prefix needed since only the API route uses it). Truncate to 7 characters. Fall back to empty string when the env var is not set (local dev, CI).
2. Run `npm run typecheck` to verify the config change is valid.
3. Run `npm run build` to verify the build succeeds with the new config.

**Notes:**
- Railway sets `RAILWAY_GIT_COMMIT_SHA` automatically at build time — no Railway config changes needed
- Next.js `env` in config inlines values at build time via webpack DefinePlugin — `process.env.COMMIT_SHA` in server code will resolve to the literal string
- The about-section is a client component that fetches from `/api/health`, so the commit hash flows through the API response — no need for a `NEXT_PUBLIC_` var

### Task 6: Add commitHash to health route and format staging version

**Issue:** FOO-588
**Files:**
- `src/app/api/health/route.ts` (modify)
- `src/app/api/health/__tests__/route.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests for the new behavior:
   - When `COMMIT_SHA` is set (e.g., `"abc1234"`), response includes `commitHash: "abc1234"`
   - When `COMMIT_SHA` is set AND environment is Staging, `version` is `"X.Y.Z+abc1234"`
   - When `COMMIT_SHA` is set AND environment is Production, `version` is `"X.Y.Z"` (unchanged)
   - When `COMMIT_SHA` is empty/unset, `commitHash` is `""` and `version` is `"X.Y.Z"`
   - Use `vi.stubEnv("COMMIT_SHA", "abc1234")` pattern (already used in existing tests)
   - Run: `npm test -- route.test`
   - Verify: New tests fail

2. **GREEN** — Update the health route:
   - Read `process.env.COMMIT_SHA` (will be inlined at build time via next.config.ts)
   - Add `commitHash` field to the response
   - When environment is Staging and commitHash is non-empty, format version as `${packageJson.version}+${commitHash}`
   - Run: `npm test -- route.test`
   - Verify: All tests pass

3. **REFACTOR** — Ensure the version formatting logic is clean and readable.

**Notes:**
- The staging detection logic already exists: `appUrl.includes("food-test")` at line 11
- The `successResponse` helper wraps the object in `{ success: true, data: ... }`
- Follow the existing test patterns — each behavior gets its own `it()` block

### Task 7: Update about-section to display commit hash

**Issue:** FOO-588
**Files:**
- `src/components/about-section.tsx` (modify)
- `src/components/__tests__/about-section.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests for commit hash display:
   - When `commitHash` is present in health data, a "Commit" row displays the hash in monospace font
   - When `commitHash` is empty, no "Commit" row is rendered
   - Update `mockHealthData` to include `commitHash: ""` by default (matches production)
   - Add a separate test with `commitHash: "abc1234"` (staging scenario)
   - Run: `npm test -- about-section`
   - Verify: New tests fail

2. **GREEN** — Update the AboutSection component:
   - Add `commitHash` to the `HealthData` interface
   - Conditionally render a "Commit" row (same layout as existing rows) when `data?.commitHash` is non-empty
   - Display the commit hash in `font-mono text-xs` (same style as Claude model row)
   - Run: `npm test -- about-section`
   - Verify: All tests pass

3. **REFACTOR** — Ensure the row fits the existing spacing and alignment pattern.

**Notes:**
- Follow the existing row pattern: `<div className="flex items-center justify-between">` with label and value spans
- The version row already shows the formatted version (which includes the hash suffix on staging) — the commit hash row is a separate explicit display for clarity
- The "Commit" row should only appear when there's actually a hash to show (production and local will have empty string)

### Task 8: Integration & Verification

**Issue:** FOO-586, FOO-587, FOO-588
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification (post-deploy):
   - [ ] Open chat, send a message that triggers markdown response (e.g., ask Claude to list foods) — verify tables render properly
   - [ ] Attach multiple images on analyze screen, tap "Analyze Food" — verify page scrolls to show progress
   - [ ] On staging, check Settings > About — verify version shows commit hash suffix
   - [ ] On staging, check `/api/health` — verify `commitHash` field is present
   - [ ] On production, verify version shows no hash suffix (after release)

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| `react-markdown` fails to parse invalid markdown | Falls back to rendering raw text (react-markdown's default) | Not explicitly tested — library handles gracefully |
| `COMMIT_SHA` env var missing at build time | Falls back to empty string, version shows without hash | Unit test |
| `scrollIntoView` not available (SSR) | Ref is null during SSR, no-op via optional chaining | Not applicable (client-only component) |

## Risks & Open Questions

- [ ] `react-markdown` bundle size — adds to client JS. Acceptable for the chat component which is already feature-heavy. If concerned, could lazy-load, but likely not worth the complexity.
- [ ] Markdown table styling — need to ensure tables don't overflow the chat bubble on mobile. The ChatMarkdown component should apply `overflow-x-auto` and constrained `max-width` to table containers.

## Scope Boundaries

**In Scope:**
- Rendering markdown in assistant chat messages (FOO-586)
- Auto-scrolling to analysis progress on analyze click (FOO-587)
- Displaying commit hash on staging version and health API (FOO-588)

**Out of Scope:**
- Markdown rendering in other parts of the app (analysis results, loading steps)
- Service worker or offline support for commit hash
- Syntax highlighting in code blocks (not expected in food chat responses)

---

## Iteration 1

**Implemented:** 2026-02-18
**Method:** Agent team (2 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Install react-markdown and remark-gfm — Added production dependencies (lead)
- Task 2: Create ChatMarkdown component with tests — New component wrapping react-markdown + remark-gfm, blocks images and headings, 8 tests (worker-1)
- Task 3: Integrate ChatMarkdown into food-chat message rendering — Assistant messages now use ChatMarkdown, user messages stay plain text (worker-1)
- Task 4: Add auto-scroll to analysis progress on analyze click — scrollIntoView({ behavior: 'smooth' }) on analysisSectionRef after setLoading(true), 1 new test (worker-1)
- Task 5: Expose commit hash at build time via next.config.ts — COMMIT_SHA from RAILWAY_GIT_COMMIT_SHA, truncated to 7 chars (worker-2)
- Task 6: Add commitHash to health route and format staging version — New commitHash field, version formatted as X.Y.Z+hash on staging, 4 new tests (worker-2)
- Task 7: Update about-section to display commit hash — Conditional "Commit" row in font-mono text-xs, 2 new tests (worker-2)

### Files Modified
- `package.json` / `package-lock.json` — Added react-markdown and remark-gfm
- `src/components/chat-markdown.tsx` — Created ChatMarkdown component
- `src/components/__tests__/chat-markdown.test.tsx` — Created tests for ChatMarkdown
- `src/components/food-chat.tsx` — Integrated ChatMarkdown for assistant messages
- `src/components/food-analyzer.tsx` — Added scrollIntoView on analyze
- `src/components/__tests__/food-analyzer.test.tsx` — Added scrollIntoView mock + test
- `src/components/__tests__/food-analyzer-reconnect.test.tsx` — Added scrollIntoView mock (post-merge fix)
- `next.config.ts` — Added env.COMMIT_SHA build-time injection
- `src/app/api/health/route.ts` — Added commitHash field, staging version format
- `src/app/api/health/__tests__/route.test.ts` — Added commit hash tests, hardened version test
- `src/components/about-section.tsx` — Added commitHash to HealthData, conditional Commit row
- `src/components/__tests__/about-section.test.tsx` — Added commit hash display tests

### Linear Updates
- FOO-586: Todo → In Progress → Review
- FOO-587: Todo → In Progress → Review
- FOO-588: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 bugs (2 medium, 1 low) — all fixed before commit
  - Fixed: unwrapDisallowed leaking img alt text (used components prop instead)
  - Fixed: hardened version test with explicit env stubs
  - Fixed: scrollIntoView mock missing in food-analyzer-reconnect.test.tsx
- verifier: All 1934 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 2, 3, 4 (UI domain — markdown rendering, chat integration, auto-scroll)
- Worker 2: Tasks 5, 6, 7 (infra/API domain — next.config, health route, about-section)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: clean merge via ort strategy (no conflicts)

### Continuation Status
All tasks completed.
