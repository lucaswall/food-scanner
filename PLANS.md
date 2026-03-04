# Implementation Plan

**Created:** 2026-03-04
**Source:** Inline request: Fix all Sentry errors — isOverloadedError SSE mismatch, missing notes validation, double Sentry reporting
**Linear Issues:** [FOO-772](https://linear.app/lw-claude/issue/FOO-772/fix-isoverloadederror-to-match-sse-streaming-error-format), [FOO-773](https://linear.app/lw-claude/issue/FOO-773/default-notes-to-empty-string-in-validatefoodanalysis-instead-of), [FOO-774](https://linear.app/lw-claude/issue/FOO-774/fix-double-sentry-reporting-in-claude-api-error-catch-blocks), [FOO-775](https://linear.app/lw-claude/issue/FOO-775/re-enable-sdk-retries-and-set-sensible-timeout-for-claude-api-client)
**Sentry Issues:** FOOD-SCANNER-3, FOOD-SCANNER-4, FOOD-SCANNER-5, FOOD-SCANNER-6, FOOD-SCANNER-7, FOOD-SCANNER-8
**Branch:** fix/sentry-claude-api-errors

## Context Gathered

### Codebase Analysis

- **`src/lib/claude.ts:214-227`** — `isOverloadedError()`: two checks — `error.status === 529` and `error.error.type === "overloaded_error"`. Neither matches SSE streaming errors where the structure is `error.error = { type: "error", error: { type: "overloaded_error" } }`.
- **`src/lib/claude.ts:239-271`** — `createStreamWithRetry()`: retry logic works, but never fires for SSE errors because `isOverloadedError` returns false. Also passes `maxRetries: 0` at line 251 which disables ALL SDK-level retries (timeouts, HTTP 529, connection errors) as collateral.
- **`src/lib/claude.ts:17-27`** — Anthropic client configured with `timeout: 60000` (60s) and `maxRetries: 2`. The 60s timeout caused FOOD-SCANNER-4 (staging timeout with zero retries). SDK default is 600s (10 min).
- **SDK retry architecture** — SDK retries handle HTTP-level failures (timeout, 529 status response, connection errors). Our custom retry handles SSE-level overloaded errors (mid-stream). These operate on different layers and don't conflict — the "double-retry" fear in the comment at line 236-237 was unfounded.
- **`src/lib/claude.ts:378-379`** — `validateFoodAnalysis` throws on missing `notes`. Compare to line 398 where `description` defaults to `""`.
- **`src/lib/claude.ts:1049-1061`** — Tool loop catch: `l.error()` + `throw ClaudeApiError` = double Sentry event.
- **`src/lib/claude.ts:1312-1324`** — analyzeFood catch: same double-reporting pattern.
- **`src/lib/sse.ts:44-51`** — SSE error handler checks `err.message.includes("overloaded")` for `AI_OVERLOADED` code — this still works because the message contains the JSON string.
- **`src/lib/__tests__/claude.test.ts`** — Existing tests for `isOverloadedError` (8 tests), `createStreamWithRetry` (4 tests), `analyzeFood` overload retry (2 tests), `runToolLoop` overload retry (2 tests). All use `new APIError(529, "Overloaded")` — none test the SSE error format.
- **`node_modules/@anthropic-ai/sdk/src/core/streaming.ts:82-83`** — SDK throws `new APIError(undefined, safeJSON(sse.data), undefined, response.headers)` for SSE errors — status is `undefined`, body is the parsed JSON.
- **`node_modules/@anthropic-ai/sdk/src/core/error.ts:56-57`** — `APIError.generate()` returns `APIConnectionError` when status is falsy, but `streaming.ts` calls `new APIError()` directly, preserving the `APIError` type.
- **Mock structure** — `src/lib/__tests__/claude.test.ts:142-151`: `MockAPIError(status, message, error?)` sets `this.status`, `this.error`. SSE tests need `new APIError(undefined, jsonString, sseBody)` to set `this.error` to the nested SSE structure.

### MCP Context

- **MCPs used:** Sentry (issue search, event details, tag values), Linear (issue creation)
- **Sentry findings:**
  - 23 error events in last 7 days (19 production, 4 staging)
  - 8 issue groups; 5 are unresolved and actionable
  - FOOD-SCANNER-3/5 and FOOD-SCANNER-6/7 share trace IDs — confirmed double-reporting
  - FOOD-SCANNER-8: 3 events in 2 minutes — same user session retrying after notes validation error

## Tasks

### Task 1: Fix isOverloadedError to match SSE streaming error format
**Linear Issue:** [FOO-772](https://linear.app/lw-claude/issue/FOO-772/fix-isoverloadederror-to-match-sse-streaming-error-format)
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**Steps:**
1. Write tests in `src/lib/__tests__/claude.test.ts` in the existing `isOverloadedError` describe block:
   - Test: returns true for `APIError` with `status: undefined` and `error: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }` — this is the exact SSE format from Sentry
   - Test: returns true for `APIError` with `status: undefined` and `error: { type: "error", error: { type: "overloaded_error", message: "Overloaded" }, request_id: "req_..." }` — with request_id field
   - Test: returns false for `APIError` with `status: undefined` and `error: { type: "error", error: { type: "invalid_request_error" } }` — other nested error types should not match
   - Use the existing `getMockAPIErrorCtor()` helper, passing the SSE body as the third `error` argument to set `this.error`
2. Run verifier with pattern `isOverloadedError` (expect fail — new tests)
3. Add a third check in `isOverloadedError` (`src/lib/claude.ts:214-227`): after the existing Check 2, check one level deeper — if `body` has an `error` property that is an object with `type === "overloaded_error"`, return true. Keep existing checks unchanged.
4. Run verifier with pattern `isOverloadedError` (expect pass)

**Sentry closure:** Commit message must include `Fixes FOOD-SCANNER-3`, `Fixes FOOD-SCANNER-5`, `Fixes FOOD-SCANNER-6`, `Fixes FOOD-SCANNER-7`.

**Notes:**
- The existing `createStreamWithRetry` tests use `new APIError(529, ...)` which exercises Check 1. These must still pass.
- After this fix, SSE overloaded errors will trigger retries (1s + 3s delays) and show "*The AI service is momentarily busy, retrying...*" to the user.

### Task 2: Default notes to empty string in validateFoodAnalysis
**Linear Issue:** [FOO-773](https://linear.app/lw-claude/issue/FOO-773/default-notes-to-empty-string-in-validatefoodanalysis-instead-of)
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**Steps:**
1. Write tests in `src/lib/__tests__/claude.test.ts` in the existing `validateFoodAnalysis` describe block:
   - Test: when `notes` is missing/undefined, result has `notes: ""` (not throw)
   - Test: when `notes` is null, result has `notes: ""` (not throw)
   - Test: when `notes` is a valid string, result has that string (existing behavior)
   - Verify existing test for valid notes string still passes
2. Run verifier with pattern `validateFoodAnalysis` (expect fail — new tests for missing/null notes)
3. In `src/lib/claude.ts:378-379`, replace the throw with a default: `const notes = typeof data.notes === "string" ? data.notes : "";` — matching the pattern used for `description` at line 398. Update `result.notes` at line 513 to use the local `notes` variable instead of `data.notes as string`.
4. Run verifier with pattern `validateFoodAnalysis` (expect pass)

**Sentry closure:** Commit message must include `Fixes FOOD-SCANNER-8`.

### Task 3: Fix double Sentry reporting in catch blocks
**Linear Issue:** [FOO-774](https://linear.app/lw-claude/issue/FOO-774/fix-double-sentry-reporting-in-claude-api-error-catch-blocks)
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**Steps:**
1. Write tests in `src/lib/__tests__/claude.test.ts`:
   - Test in `runToolLoop` describe: when a non-ClaudeApiError is thrown (e.g., generic Error), verify `l.warn` is called (not `l.error`) and ClaudeApiError is still thrown
   - Test in `analyzeFood` describe (or `conversationalRefine` which uses the same catch path): when a non-ClaudeApiError is thrown, verify `l.warn` is called (not `l.error`) and ClaudeApiError is still thrown
   - Follow existing test patterns that use `makeTestLogger()` and check `log.warn`/`log.error` calls
2. Run verifier with test pattern (expect fail — tests expect `l.warn` but code uses `l.error`)
3. In `src/lib/claude.ts:1054`, change `l.error(` to `l.warn(` — keep the same log message and payload
4. In `src/lib/claude.ts:1317`, change `l.error(` to `l.warn(` — keep the same log message and payload
5. Run verifier with test pattern (expect pass)

**Notes:**
- The thrown `ClaudeApiError` still propagates to `sse.ts:45` where `logger.error({ err }, "SSE generator threw an unexpected error")` logs it — this is the single Sentry event per failure.
- The downgraded logs become `warn` level which Sentry typically doesn't capture as events.

### Task 4: Re-enable SDK retries and set sensible timeout
**Linear Issue:** [FOO-775](https://linear.app/lw-claude/issue/FOO-775/re-enable-sdk-retries-and-set-sensible-timeout-for-claude-api-client)
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**Steps:**
1. Write tests in `src/lib/__tests__/claude.test.ts`:
   - Test in `createStreamWithRetry` describe: verify the stream call does NOT pass `maxRetries: 0` in request options (i.e., SDK retries are not disabled). Check the second argument to `mockStream` does not contain `maxRetries: 0`. Existing test at line 2738-2746 asserts `maxRetries: 0` — update it to assert `maxRetries` is NOT overridden.
   - Test: verify the Anthropic client is constructed with `timeout: 120000` (check `mockConstructorArgs` is called with `timeout: 120000`)
2. Run verifier with pattern `createStreamWithRetry` (expect fail — tests expect no `maxRetries: 0` but code still has it)
3. In `src/lib/claude.ts:251`, remove `maxRetries: 0` from the request options — change `{ ...(requestOptions ?? {}), maxRetries: 0 }` to `requestOptions ?? {}`. SDK-level retries (timeout, HTTP 529, connection errors) will now work. Our custom retry only handles SSE-level overloaded errors — no conflict.
4. In `src/lib/claude.ts:21`, change `timeout: 60000` to `timeout: 120000` — 120 seconds gives headroom for streaming with web search without excessive user wait.
5. Update the `createStreamWithRetry` JSDoc comment (lines 231-238) to remove the `maxRetries: 0` explanation and document the two-layer retry architecture: SDK handles HTTP-level failures, our code handles SSE-level overloaded errors.
6. Run verifier with pattern `createStreamWithRetry` (expect pass)

**Sentry closure:** Commit message must include `Fixes FOOD-SCANNER-4`.

**Notes:**
- SDK `maxRetries: 2` means up to 3 total attempts for timeouts/HTTP 529 — with exponential backoff managed by the SDK.
- Our custom retry (2 retries with 1s + 3s delays) handles SSE overloaded errors that happen mid-stream. These are a different error path — the HTTP connection succeeded but the SSE event stream contains an error.
- The two retry layers don't conflict: SDK retries fire before the stream starts (HTTP level), our retries fire after the stream starts (SSE level).

### Task 5: Full verification
**Steps:**
1. Run `verifier` (no args) — all tests + lint + build
2. Verify zero warnings

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix all 6 actionable Sentry errors (23 events in last 7 days) — SSE overloaded errors bypassing retry, missing notes validation, double Sentry reporting, and disabled SDK retries causing unretried timeouts.
**Linear Issues:** FOO-772, FOO-773, FOO-774, FOO-775
**Approach:** Task 1 adds a third check in `isOverloadedError` for the nested SSE error structure. Task 2 defaults `notes` to `""` like `description`. Task 3 downgrades `l.error` to `l.warn` in catch blocks. Task 4 removes `maxRetries: 0` override to re-enable SDK retries for timeouts/HTTP 529 and increases timeout from 60s to 120s. All commits include `Fixes FOOD-SCANNER-N` references for auto-closure.
**Scope:** 5 tasks, 2 files, ~10 new tests
**Key Decisions:** Two-layer retry architecture — SDK handles HTTP-level failures (timeout, 529 status), our custom retry handles SSE-level overloaded errors mid-stream. No conflict between layers.
**Risks:** None — all changes are defensive improvements with full backward compatibility.
