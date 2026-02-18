# Implementation Plan

**Status:** COMPLETE
**Branch:** feat/FOO-593-overload-retry-and-fixes
**Issues:** FOO-593, FOO-594, FOO-595, FOO-596
**Created:** 2026-02-18
**Last Updated:** 2026-02-18

## Summary

Four improvements: (1) Add retry with user feedback for Claude API 529 overloaded errors, (2) fix markdown table overflow on mobile, (3) add E2E screenshots for the free-form chat page, and (4) add E2E screenshots for secondary UI states (Quick Select Recent tab, food detail error, refine chat error).

## Issues

### FOO-593: Claude API overloaded_error crashes food analysis and chat with no retry

**Priority:** Medium
**Labels:** Improvement
**Description:** When the Anthropic Claude API returns 529 `overloaded_error`, the SSE stream crashes with a generic "An internal error occurred" message. The SDK has `maxRetries: 2` which handles transparent retries, but there is no user feedback during retries and the final error message is unhelpful. Affects both `/api/analyze-food` and `/api/chat-food` routes.

**Acceptance Criteria:**
- [ ] Automatic retries (1-2) with exponential backoff for `overloaded_error` only
- [ ] Visible SSE message during retry ("The AI service is momentarily busy, retrying...")
- [ ] Improved final error message when all retries exhausted (clear, specific, not the user's fault)
- [ ] Both routes covered (analyze-food and chat-food)

### FOO-594: Markdown tables in chat overflow on mobile screens

**Priority:** Medium
**Labels:** Bug
**Description:** The `ChatMarkdown` component renders tables with `[&_table]:w-full` but has no overflow handling. Tables with 4+ columns overflow on mobile. Cell padding is generous for mobile. Single-file change in `src/components/chat-markdown.tsx`.

**Acceptance Criteria:**
- [ ] Tables scroll horizontally when too wide for the screen
- [ ] Cell padding reduced for mobile-friendly display
- [ ] Existing table rendering tests still pass

### FOO-595: Chat page (/app/chat) has no E2E screenshots

**Priority:** Low
**Labels:** Improvement
**Description:** The free-form chat page has 5 E2E tests in `refine-chat.spec.ts` ("Free-form Chat" describe block) but none call `captureScreenshots()`. The chat page is a key feature with zero visual representation in the screenshot gallery.

**Acceptance Criteria:**
- [ ] Screenshot of initial chat state (greeting message)
- [ ] Screenshot of chat with text-only conversation
- [ ] Screenshot of chat with food analysis + MiniNutritionCard + "Log to Fitbit" button

### FOO-596: Missing E2E screenshots for secondary UI states

**Priority:** Low
**Labels:** Improvement
**Description:** Several secondary UI states have tests but no screenshot coverage: Quick Select "Recent" tab, food detail error state, and refine chat error banner.

**Acceptance Criteria:**
- [ ] Screenshot of Quick Select "Recent" tab
- [ ] Screenshot of food detail error state
- [ ] Screenshot of refine chat error banner

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] `npm install` up to date
- [ ] Tests passing (`npm test`)

## Implementation Tasks

### Task 1: Fix markdown table overflow in ChatMarkdown

**Issue:** FOO-594
**Files:**
- `src/components/__tests__/chat-markdown.test.tsx` (modify)
- `src/components/chat-markdown.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test: Render a multi-column table and verify the `<table>` element is wrapped in a container with the `overflow-x-auto` class. Also verify table cells use compact styling classes.
   - Run: `npm test -- chat-markdown`
   - Verify: New test fails because table has no overflow wrapper

2. **GREEN** — Use ReactMarkdown's `components` prop to provide a custom `table` renderer that wraps the native `<table>` in a `<div className="overflow-x-auto">`. Move table-specific Tailwind classes from the outer div to the custom renderer. Reduce cell padding from `px-2` to `px-1.5` and add `text-xs` for compact mobile rendering.
   - Run: `npm test -- chat-markdown`
   - Verify: All tests pass including new overflow test

3. **REFACTOR** — Verify all existing ChatMarkdown tests still pass. Clean up the outer div's className — table-related classes should now live on the custom renderer, not the outer wrapper.
   - Run: `npm test -- chat-markdown`

**Notes:**
- Pattern reference: ReactMarkdown `components` prop usage — see existing `img: () => null` in the component
- The table wrapper approach is preferred over CSS-only `[&_table]:overflow-x-auto` because we need a block-level wrapper div around the inline table

---

### Task 2: Add overloaded error detection helper

**Issue:** FOO-593
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests for a new `isOverloadedError()` function:
   - Returns `true` for an Anthropic `APIError` with status 529
   - Returns `true` for an error whose `.error?.type` is `'overloaded_error'`
   - Returns `false` for other error types (400, 401, 429, generic Error)
   - Run: `npm test -- claude`
   - Verify: Tests fail (function doesn't exist yet)

2. **GREEN** — Export an `isOverloadedError(error: unknown): boolean` function from `claude.ts`. Import `Anthropic` and check: (a) `error instanceof Anthropic.APIError && error.status === 529`, or (b) the error body object has `type: 'overloaded_error'`.
   - Run: `npm test -- claude`
   - Verify: Detection tests pass

**Notes:**
- The Anthropic SDK maps 529 to `InternalServerError` (status >= 500 catch-all). The `.status` property reliably carries the original HTTP status code.
- Import the `APIError` type from `@anthropic-ai/sdk` — it's re-exported at the top level: `Anthropic.APIError`

---

### Task 3: Create stream retry wrapper with SSE feedback

**Issue:** FOO-593
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests for a new `createStreamWithRetry()` async generator:
   - Test: On first success, yields text deltas and returns the final message (no retry)
   - Test: On first 529 error, yields a retry text_delta event ("momentarily busy"), delays, retries, and succeeds on second attempt
   - Test: On persistent 529 (all attempts fail), yields retry feedback then throws `ClaudeApiError` with a user-friendly overloaded message
   - Test: On non-529 error (e.g., 401), throws immediately without retry
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** — Export `createStreamWithRetry()` from `claude.ts`. Signature:
   - Accepts: stream creation params (same shape as `getClient().beta.messages.stream()` args), a logger, and max retries count (default 2)
   - Behavior: Creates a stream with `maxRetries: 0` (disable SDK retries for this call), iterates via `streamTextDeltas()`. On 529 catch: yields `{ type: "text_delta", text: "\n\n*The AI service is momentarily busy, retrying...*\n\n" }`, delays (1s first retry, 3s second), and retries. On final failure: throws `ClaudeApiError` with message "The AI service is temporarily overloaded. Please try again in a moment."
   - Returns: The `Anthropic.Message` (final message from stream)
   - Run: `npm test -- claude`
   - Verify: All retry tests pass

**Notes:**
- The existing `streamTextDeltas()` function yields text deltas and returns the final message — reuse it inside the retry loop
- `maxRetries: 0` is passed as a request option (second arg to `.stream()`) to disable SDK-level retries for this specific call, while keeping the client's default `maxRetries: 2` for any other direct API calls
- The italic markdown formatting (`*...*`) in the retry message renders nicely through the existing `ChatMarkdown` component

---

### Task 4: Apply retry wrapper to analyzeFood

**Issue:** FOO-593
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **RED** — Add test: When `analyzeFood` encounters a 529 error from the stream, it yields a retry text_delta, delays, retries the stream, and succeeds. Add another test: When `analyzeFood` encounters persistent 529, it throws with the overloaded message.
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** — Replace the direct `getClient().beta.messages.stream()` + `yield* streamTextDeltas()` pattern in `analyzeFood` (around line 915) with a call to `createStreamWithRetry()`. Pass the same params and options.
   - Run: `npm test -- claude`
   - Verify: All `analyzeFood` tests pass including new retry tests

**Notes:**
- The slow path in `analyzeFood` (data tools + tool loop) also calls `runToolLoop` which has its own stream creation — that's covered in Task 5
- The tool loop continuation uses `runToolLoop` which will get its own retry in Task 5

---

### Task 5: Apply retry wrapper to runToolLoop and conversationalRefine

**Issue:** FOO-593
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests:
   - `runToolLoop`: On 529 during a tool loop iteration, yields retry feedback and retries
   - `conversationalRefine`: On 529, yields retry feedback and retries
   - Both: On persistent 529, throw overloaded error
   - Run: `npm test -- claude`
   - Verify: Tests fail

2. **GREEN** — Replace direct stream creation in `runToolLoop` (around line 607) and `conversationalRefine` (around line 1239) with `createStreamWithRetry()`. Same pattern as Task 4.
   - Run: `npm test -- claude`
   - Verify: All tests pass

---

### Task 6: Improve error handling in SSE response for overloaded errors

**Issue:** FOO-593
**Files:**
- `src/lib/__tests__/sse.test.ts` (modify or create)
- `src/lib/sse.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests for `createSSEResponse` error handling:
   - Test: When the generator throws a `ClaudeApiError` containing "overloaded" in the message, the SSE error event has a specific user-friendly message and code `AI_OVERLOADED`
   - Test: When the generator throws a generic error, the SSE error event still has the existing generic message
   - Run: `npm test -- sse`
   - Verify: New test fails (current implementation always sends "An internal error occurred")

2. **GREEN** — In `createSSEResponse`'s catch block, detect overloaded errors: check if the error message includes "overloaded" (from the `ClaudeApiError` thrown by `createStreamWithRetry`). If so, set the error event message to the actual error message and code to `AI_OVERLOADED`. Otherwise keep the existing generic handling.
   - Run: `npm test -- sse`
   - Verify: All SSE tests pass

**Notes:**
- The client-side error handling in `food-chat.tsx` (line 362) and `food-analyzer.tsx` (line 267) already displays `event.message` from the SSE error event. So improving the server-side message automatically improves what the user sees — no client changes needed.
- Pattern: `if (err instanceof Error && err.message.includes('overloaded'))` — simple string check on the ClaudeApiError message

---

### Task 7: Add E2E screenshots for free-form chat page

**Issue:** FOO-595
**Files:**
- `e2e/tests/refine-chat.spec.ts` (modify)

**Steps:**

1. In the "Free-form Chat" describe block, add `captureScreenshots()` calls to existing tests:
   - `'shows greeting message and title header'` test: add `captureScreenshots(page, 'chat')` after verifying the greeting is visible
   - `'sends message and displays response'` test: add `captureScreenshots(page, 'chat-conversation')` after verifying the response is visible
   - `'header updates when analysis arrives from API'` test: add `captureScreenshots(page, 'chat-with-analysis')` after verifying the Log to Fitbit button is visible

2. Import `captureScreenshots` is already imported at the top of the file.

**Notes:**
- Follow the same pattern as existing screenshot tests: wait for content to be visible, then capture
- The existing tests already set up mocks and verify content — just append the screenshot call

---

### Task 8: Add E2E screenshots for secondary UI states

**Issue:** FOO-596
**Files:**
- `e2e/tests/quick-select.spec.ts` (modify)
- `e2e/tests/empty-states.spec.ts` (modify)
- `e2e/tests/refine-chat.spec.ts` (modify)

**Steps:**

1. **Quick Select Recent tab** — In `quick-select.spec.ts`, add `captureScreenshots(page, 'quick-select-recent')` at the end of the `'recent tab displays recently logged foods'` test (after verifying foods are visible).

2. **Food detail error state** — In `empty-states.spec.ts`:
   - Import `captureScreenshots` from `'../fixtures/screenshots'`
   - In the `'invalid food detail ID shows error state'` test, add `captureScreenshots(page, 'food-detail-error')` after verifying the error message is visible

3. **Refine chat error banner** — In `refine-chat.spec.ts`, add `captureScreenshots(page, 'refine-chat-error')` in the `'shows dismissible error in chat on API failure'` test, after verifying the error banner is visible and BEFORE clicking the dismiss button.

**Notes:**
- `captureScreenshots` is already imported in `quick-select.spec.ts` and `refine-chat.spec.ts`
- For `empty-states.spec.ts`, the import needs to be added

---

### Task 9: Integration & Verification

**Issues:** FOO-593, FOO-594, FOO-595, FOO-596
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. E2E tests: `npm run e2e` (verifies screenshot tasks 7-8)

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---|---|---|
| Claude API returns 529 once | Retry text shown in SSE, stream retried, succeeds | Unit test (Task 3) |
| Claude API returns 529 persistently | Retry text shown, user-friendly overloaded error after max retries | Unit test (Task 3) |
| Claude API returns 400/401/403 | Fails immediately, no retry | Unit test (Task 3) |
| Table too wide for mobile | Scrolls horizontally | Unit test (Task 1) |
| SSE generator throws overloaded error | Error event with `AI_OVERLOADED` code and friendly message | Unit test (Task 6) |

## Risks & Open Questions

- [ ] The `maxRetries: 0` per-call override may not be supported on `.stream()` beta method — verify during implementation by checking the Anthropic SDK types. If not supported, set `maxRetries: 0` on the client constructor and handle all retries manually.
- [ ] The 529 retry delay (1s, 3s) may need tuning based on real-world Anthropic overload patterns. Start conservative and adjust if needed.

## Scope Boundaries

**In Scope:**
- Overloaded error retry with SSE feedback for both analyze and chat routes
- Improved error messaging for overloaded errors
- Markdown table overflow fix for mobile
- E2E screenshot additions for chat page and secondary states

**Out of Scope:**
- Dashboard empty state screenshot (FOO-596 mentions this as lower priority — would need a separate test context without seeded meals)
- Retry for other transient errors (429, 500) — SDK handles these transparently
- Client-side changes for error display (existing code already shows `event.message`)

---

## Iteration 1

**Implemented:** 2026-02-18
**Method:** Agent team (2 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1: Fix markdown table overflow in ChatMarkdown - Added custom table/th/td renderers with overflow-x-auto wrapper and compact styling (worker-2)
- Task 2: Add overloaded error detection helper - Exported `isOverloadedError()` with status 529 and duck-type checks (worker-1)
- Task 3: Create stream retry wrapper with SSE feedback - Added `createStreamWithRetry()` async generator with exponential backoff and retry text_delta events (worker-1)
- Task 4: Apply retry wrapper to analyzeFood - Replaced direct stream creation with `createStreamWithRetry()` (worker-1)
- Task 5: Apply retry wrapper to runToolLoop and conversationalRefine - Applied retry wrapper to both functions (worker-1)
- Task 6: Improve error handling in SSE response for overloaded errors - Added `AI_OVERLOADED` code detection via error name check (worker-2)
- Task 7: Add E2E screenshots for free-form chat page - Added captureScreenshots to 3 chat tests (worker-2)
- Task 8: Add E2E screenshots for secondary UI states - Added captureScreenshots to quick-select, empty-states, and refine-chat tests (worker-2)

### Files Modified
- `src/lib/claude.ts` - Added `isOverloadedError()`, `createStreamWithRetry()`, applied retry to analyzeFood/runToolLoop/conversationalRefine
- `src/lib/__tests__/claude.test.ts` - Added 19 tests for overloaded detection and retry logic, added APIError to mock
- `src/components/chat-markdown.tsx` - Custom table/th/td renderers with overflow-x-auto wrapper and compact padding
- `src/components/__tests__/chat-markdown.test.tsx` - Added overflow wrapper and compact padding tests
- `src/lib/sse.ts` - Added overloaded error detection (name-based check) with AI_OVERLOADED code
- `src/lib/__tests__/sse.test.ts` - Added overloaded error handling test
- `e2e/tests/refine-chat.spec.ts` - Added chat, chat-conversation, chat-with-analysis, and refine-chat-error screenshots
- `e2e/tests/quick-select.spec.ts` - Added quick-select-recent screenshot
- `e2e/tests/empty-states.spec.ts` - Added food-detail-error screenshot with import
- `src/app/api/analyze-food/__tests__/route.test.ts` - Fixed vi.mock hoisting with vi.hoisted() and importOriginal pattern
- `src/app/api/chat-food/__tests__/route.test.ts` - Fixed vi.mock hoisting with vi.hoisted()

### Linear Updates
- FOO-593: Todo → In Progress → Review
- FOO-594: Todo → Review
- FOO-595: Todo → Review
- FOO-596: Todo → Review

### Pre-commit Verification
- bug-hunter: Found 3 bugs (stale eslint-disable, log off-by-one, fragile string matching), all fixed
- verifier: All 1958 tests pass, zero warnings, build clean

### Work Partition
- Worker 1: Tasks 2, 3, 4, 5 (Claude retry domain — claude.ts)
- Worker 2: Tasks 1, 6, 7, 8 (UI + SSE + E2E — chat-markdown, sse, e2e specs)

### Merge Summary
- Worker 1: committed directly to feature branch (fast-forward equivalent)
- Worker 2: merged cleanly, no conflicts
- Post-merge fixes: stale eslint-disable removed, log ordering fixed, SSE overload detection changed from instanceof to name-based check (avoids sse.ts → claude.ts import chain that pulled pg into client bundles), route test mocks fixed with vi.hoisted()

### Continuation Status
All tasks completed.

### Review Findings

Summary: 6 issue(s) found, 7 discarded (Team: security, reliability, quality reviewers)
- FIX: 6 issue(s) — Linear issues created
- DISCARDED: 7 finding(s) — false positives / not applicable

**Issues requiring fix:**
- [MEDIUM] RESOURCE: SSE false error logging on client disconnect — `controller.enqueue()` TypeError on client disconnect logged as ERROR (`src/lib/sse.ts:36-37`)
- [LOW] SECURITY: ChatMarkdown XSS — ReactMarkdown renders links without filtering `javascript:`/`data:` protocol URIs (`src/components/chat-markdown.tsx:19-32`)
- [LOW] CONVENTION: Missing `action` field in `createStreamWithRetry` warn/error logs (`src/lib/claude.ts:223,230`)
- [LOW] BUG: Misleading test description "passes all 6 tools" but asserts 5 (`src/lib/__tests__/claude.test.ts:659`)
- [LOW] BUG: Fake timer cleanup missing try/finally — 8 tests leak timers on assertion failure (`src/lib/__tests__/claude.test.ts`)
- [LOW] EDGE CASE: `truncateConversation` silently drops original first message when same role as last-4 start (`src/lib/claude.ts:527-541`)

**Discarded findings (not bugs):**
- [DISCARDED] BUG: "All chat-food E2E mocks use JSON but route returns SSE" — False positive. Client code (`food-chat.tsx:311-391`) explicitly handles both Content-Types: SSE streaming path at line 312 and JSON fallback path at line 372. The E2E mocks correctly exercise the JSON fallback.
- [DISCARDED] TYPE: `JSON.parse(json) as StreamEvent` without runtime validation (`src/lib/sse.ts:88`) — Internal trust boundary. The only producer is our own server (`formatSSEEvent`), malformed JSON already caught by try/catch at line 90.
- [DISCARDED] CONVENTION: `waitForTimeout()` fixed delays in `quick-select.spec.ts` — Pre-existing test pattern not introduced by this iteration. Tests pass reliably; this is a style preference.
- [DISCARDED] CONVENTION: Overly permissive assertion in `quick-select.spec.ts:152-157` — Pre-existing pattern handling legitimate UI variation in log-food flow.
- [DISCARDED] CONVENTION: Duplicate test in `analyze-food/route.test.ts:317-327` — Redundant but harmless; not introduced by this iteration.
- [DISCARDED] BUG: `truncateConversation` skips all truncation when `messages.length <= 5` — Logically correct: the algorithm keeps first + last 4 messages; with ≤5 messages, all are in the keep set and there's nothing to truncate.
- [DISCARDED] ASYNC: AbortSignal checked only at loop boundary in `runToolLoop` (`src/lib/claude.ts:654`) — Standard loop-boundary check pattern; signal is available at the network layer for lower-level cancellation.

### Linear Updates
- FOO-593: Review → Merge (original task completed)
- FOO-594: Review → Merge (original task completed)
- FOO-595: Review → Merge (original task completed)
- FOO-596: Review → Merge (original task completed)
- FOO-597: Created in Todo (Fix: SSE false error logging)
- FOO-598: Created in Todo (Fix: ChatMarkdown XSS link sanitization)
- FOO-599: Created in Todo (Fix: Minor code quality — log fields, test description, fake timers)
- FOO-600: Created in Todo (Fix: truncateConversation drops first message)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [FOO-597](https://linear.app/lw-claude/issue/FOO-597), [FOO-598](https://linear.app/lw-claude/issue/FOO-598), [FOO-599](https://linear.app/lw-claude/issue/FOO-599), [FOO-600](https://linear.app/lw-claude/issue/FOO-600)

### Fix 1: SSE false error logging on client disconnect
**Linear Issue:** [FOO-597](https://linear.app/lw-claude/issue/FOO-597)

1. Write test in `src/lib/__tests__/sse.test.ts` verifying that a client-disconnect TypeError is logged at warn (not error) level
2. In `src/lib/sse.ts` catch block (line 36), detect client-disconnect errors (TypeError when `controller.desiredSize === null`) and log at warn level; keep error level for genuine unexpected errors

### Fix 2: ChatMarkdown XSS — add link href sanitization
**Linear Issue:** [FOO-598](https://linear.app/lw-claude/issue/FOO-598)

1. Write test in `src/components/__tests__/chat-markdown.test.tsx` verifying that `javascript:` and `data:` protocol links are sanitized (href removed or set to `#`)
2. Add a custom `a` component override in `chat-markdown.tsx` that only allows `http:`, `https:`, and `mailto:` protocols

### Fix 3: Minor code quality fixes
**Linear Issue:** [FOO-599](https://linear.app/lw-claude/issue/FOO-599)

1. Add `{ action: "stream_retry" }` to the warn log at `src/lib/claude.ts:223` and `{ action: "stream_retry_exhausted" }` to the error log at line 230
2. Fix test description at `src/lib/__tests__/claude.test.ts:659` from "6 tools" to "5 tools"
3. Add `afterEach(() => { vi.useRealTimers(); })` to the 4 describe blocks that use fake timers: `createStreamWithRetry`, `analyzeFood overload retry`, `runToolLoop overload retry`, `conversationalRefine overload retry`

### Fix 4: truncateConversation silently drops original first message
**Linear Issue:** [FOO-600](https://linear.app/lw-claude/issue/FOO-600)

1. Write test in `src/lib/__tests__/claude.test.ts` for a 6-message conversation where first message and first of last-4 share the same role — verify the original first message content is preserved
2. In `src/lib/claude.ts`, modify the dedup logic (lines 533-541) to start deduplication at index 1 within the last-4 group only, preserving the original first message unconditionally

---

## Iteration 2

**Implemented:** 2026-02-18
**Method:** Single-agent (small batch — 4 tasks, 6 files)

### Tasks Completed This Iteration
- Fix 1: SSE false error logging on client disconnect - Narrowed TypeError detection to controller-related messages, log at warn level (FOO-597)
- Fix 2: ChatMarkdown XSS link sanitization - Added custom `a` component with case-insensitive protocol allowlist (FOO-598)
- Fix 3: Minor code quality fixes - Added `action` fields to retry logs, fixed test description "6 tools" → "5 tools", added `vi.useRealTimers()` to afterEach in 4 describe blocks (FOO-599)
- Fix 4: truncateConversation preserves original first message - Dedup now operates within last-4 group only, junction dedup guards against total context erasure (FOO-600)

### Files Modified
- `src/lib/sse.ts` - Narrowed client-disconnect detection: TypeError + message check for controller keywords
- `src/lib/__tests__/sse.test.ts` - Added 2 tests: controller TypeError → warn, non-controller TypeError → error
- `src/components/chat-markdown.tsx` - Added custom `a` component with case-insensitive protocol allowlist + rel="noopener noreferrer"
- `src/components/__tests__/chat-markdown.test.tsx` - Added 5 tests: javascript:/data: sanitization, http/https/mailto/uppercase allowed
- `src/lib/claude.ts` - Added `action` fields to retry logs, fixed truncateConversation dedup logic
- `src/lib/__tests__/claude.test.ts` - Fixed test description, added `vi.useRealTimers()` to 4 afterEach blocks, added truncation preservation test, updated existing truncation test

### Linear Updates
- FOO-597: Todo → In Progress → Review
- FOO-598: Todo → In Progress → Review
- FOO-599: Todo → In Progress → Review
- FOO-600: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 3 bugs (case-sensitive regex, broad TypeError check, edge case guard), all fixed
- verifier: All 1966 tests pass, zero warnings, build clean

### Continuation Status
All tasks completed.

### Review Findings

Files reviewed: 6
Reviewers: security, reliability, quality (agent team)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found - all implementations are correct and follow project conventions.

**Discarded findings (not bugs):**
- [DISCARDED] SECURITY: vbscript: protocol not blocked in ChatMarkdown (`src/components/chat-markdown.tsx:22`) — False positive. The regex is an allowlist (`^(https?:|mailto:)`); anything not matching (including vbscript:) gets `href=undefined`. vbscript: IS blocked.
- [DISCARDED] SECURITY: tel:/ftp: protocols not in allowlist (`src/components/chat-markdown.tsx:22`) — By design. AI-generated chat markdown has no legitimate need for tel: or ftp: links.
- [DISCARDED] SECURITY: err.message passed to client for overloaded errors (`src/lib/sse.ts:48`) — False positive. The check requires `name === "CLAUDE_API_ERROR"` (internal class with controlled messages) + `message.includes("overloaded")`. External errors cannot match all 3 conditions.
- [DISCARDED] EDGE CASE: truncateConversation same-role when dedupedLast has 1 element (`src/lib/claude.ts:543`) — Impossible in context. Anthropic API enforces alternating user/assistant roles; all 4 last messages cannot share the same role.
- [DISCARDED] EDGE CASE: client-disconnect detection relies on runtime-specific error message substrings (`src/lib/sse.ts:39-41`) — Style concern. Worst case is warn→error log level change; no functionality or data impact.
- [DISCARDED] CONVENTION: Missing `action` field in SSE log calls (`src/lib/sse.ts:43,45`) — Style-only cosmetic preference with zero correctness impact. Not explicitly enforced by CLAUDE.md.
- [DISCARDED] CONVENTION: Redundant vi.useRealTimers() calls in tests (`src/lib/__tests__/claude.test.ts:1764,1814,1839`) — Defense-in-depth pattern; inline calls guard against test throws before afterEach runs.

### Linear Updates
- FOO-597: Review → Merge
- FOO-598: Review → Merge
- FOO-599: Review → Merge
- FOO-600: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
