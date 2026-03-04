# Implementation Plan

**Created:** 2026-03-04
**Source:** Inline request: Migrate Claude API from beta to GA, fix container forwarding, close Sentry issues, full beta cleanup
**Linear Issues:** [FOO-802](https://linear.app/lw-claude/issue/FOO-802/migrate-createstreamwithretry-from-beta-to-ga-endpoint), [FOO-803](https://linear.app/lw-claude/issue/FOO-803/remove-betas-parameter-from-all-api-call-sites), [FOO-804](https://linear.app/lw-claude/issue/FOO-804/add-container-forwarding-in-tool-loop-and-entry-points), [FOO-805](https://linear.app/lw-claude/issue/FOO-805/resolve-sentry-issues-food-scanner-5-6-3)
**Sentry Issues:** [FOOD-SCANNER-5](https://lucas-wall.sentry.io/issues/FOOD-SCANNER-5) (container_id, 22 events), [FOOD-SCANNER-6](https://lucas-wall.sentry.io/issues/FOOD-SCANNER-6) (union type limit, 9 events)
**Branch:** refactor/beta-to-ga-migration

## Context Gathered

### Codebase Analysis

- **Related files:**
  - `src/lib/claude.ts` — Core Claude API integration. Contains ALL beta traces: `BETA_HEADER` constant (line 86), `getClient().beta.messages.stream()` call (line 276), `Parameters<Anthropic["beta"]["messages"]["stream"]>[0]` type (line 267), `Anthropic.Beta.Messages.BetaMessage` type (line 712), and `betas: [BETA_HEADER]` in 3 call sites (lines 847, 1164, 1507)
  - `src/lib/__tests__/claude.test.ts` — Tests with beta mock structure: `beta: { messages: { stream: mockStream } }` (lines 158-162), beta header assertions (lines 787, 1253, 1965), and beta params in test fixtures (line 2863)
  - `src/lib/chat-tools.ts` — Data tool definitions. NO strict:true (correctly removed). No beta references.
  - `src/lib/lumen.ts` — Lumen goals tool. Has `strict: true` (kept). No beta references.
  - `package.json` — `@anthropic-ai/sdk: "^0.75.0"`
- **Existing patterns:**
  - `createStreamWithRetry` is the single entry point for all Claude API streaming calls — all 3 call sites go through it
  - `streamTextDeltas` extracts text deltas and returns `finalMessage()` — return type is `Anthropic.Message`
  - `runToolLoop` iterates calling `createStreamWithRetry` in a while loop — natural place for container state
  - `analyzeFood` calls `createStreamWithRetry` once for initial response, then delegates to `runToolLoop`
  - `conversationalRefine` follows the same pattern as `analyzeFood`
- **Test conventions:**
  - Mock Anthropic SDK via `vi.mock("@anthropic-ai/sdk")` at top of test file
  - `MockAnthropic` class has `beta.messages.stream` property — must change to `messages.stream`
  - `mockStream` function returns objects with `[Symbol.asyncIterator]` and `finalMessage()`
  - Tests assert on `mockStream.mock.calls[0][0]` to verify API call parameters

### MCP Context

- **MCPs used:** Sentry (issue investigation), Linear (issue management)
- **Sentry findings:**
  - FOOD-SCANNER-5 (container_id error): 22 events, ignored, **still active** (last seen 22 min ago). Root cause: API returns `container` in response when code execution is used (auto-injected by web search dynamic filtering), but the code never extracts or forwards it in subsequent requests.
  - FOOD-SCANNER-6 (union type limit): 9 events, unresolved. Root cause: `strict: true` was temporarily re-added to data tools by FOO-784, then reverted by commit `37281ed`. Recent events are from staging before revert deployed. Already fixed in code — needs to be resolved in Sentry.
  - FOOD-SCANNER-3 (tool loop error): 3 events, ignored. Related to container_id — will be fixed by container forwarding.
  - FOOD-SCANNER-7 (Claude API error): 6 events, ignored. Generic error wrapper, already handled.
  - FOOD-SCANNER-8 (missing notes): 3 events, resolved. Already resolved.
  - FOOD-SCANNER-9 (Load failed): 2 events, ignored. Client network error, not actionable.
  - FOOD-SCANNER-4 (timeout): 1 event, ignored. Transient, not actionable.
  - FOOD-SCANNER-1, FOOD-SCANNER-2 (nutrition goals): 1 event each, ignored. Transient, not actionable.
- **API research findings:**
  - `web_search_20260209` is fully GA as of Feb 17, 2026 — no beta header needed
  - Code execution is auto-injected by the API when web search needs dynamic filtering — not a separate tool
  - All features used by food-scanner (web search, `pause_turn`, `server_tool_use`, `web_search_tool_result`) are in GA `ContentBlock` union
  - `model_context_window_exceeded` stop reason works at runtime on GA endpoint (Sonnet 4.5+), even though SDK `StopReason` type doesn't include it — existing `as string` cast is correct
  - GA `client.messages.stream()` returns `Anthropic.Message` (not `BetaMessage`) — fixes the type mismatch
  - `container` field: response includes `container: { id: "..." }` when code execution is used; subsequent requests must pass `container: containerId`
- **Linear findings:** Todo queue is empty. No conflicts with existing planned work.

## Tasks

### Task 1: Migrate createStreamWithRetry from beta to GA endpoint
**Linear Issue:** [FOO-802](https://linear.app/lw-claude/issue/FOO-802/migrate-createstreamwithretry-from-beta-to-ga-endpoint)
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**
1. Write test in `src/lib/__tests__/claude.test.ts` for `createStreamWithRetry`: verify that `mockStream` is called via the GA path (not `beta.messages.stream`). Assert that the call parameters do NOT contain a `betas` field.
2. Run `npx vitest run "claude.test"` — expect fail (currently calls `beta.messages.stream` with `betas` header).
3. In `src/lib/claude.ts`:
   - Delete `const BETA_HEADER = "code-execution-web-tools-2026-02-09"` (line 86).
   - Change `createStreamWithRetry` param type from `Parameters<Anthropic["beta"]["messages"]["stream"]>[0]` to `Parameters<Anthropic["messages"]["stream"]>[0]` (line 267).
   - Change `getClient().beta.messages.stream(streamParams, requestOptions ?? {})` to `getClient().messages.stream(streamParams, requestOptions ?? {})` (line 276).
   - In `streamTextDeltas` (line 712), remove `Anthropic.Beta.Messages.BetaMessage` from the `finalMessage()` return type union — it should be just `Promise<Anthropic.Message>`.
4. In `src/lib/__tests__/claude.test.ts`:
   - Change `MockAnthropic` class from `beta = { messages: { stream: mockStream } }` to `messages = { stream: mockStream }` (lines 158-162).
5. Run `npx vitest run "claude.test"` — expect pass.

**Notes:**
- This task changes the single entry point (`createStreamWithRetry`) that all 3 call sites use, so the beta→GA switch propagates automatically.
- The mock structure change in step 4 will cause all existing tests to route through the GA mock — no per-test changes needed for the mock wiring.
- `WEB_SEARCH_TOOL` definition (lines 88-91) stays unchanged — it's already a GA tool type.

### Task 2: Remove betas parameter from all API call sites
**Linear Issue:** [FOO-803](https://linear.app/lw-claude/issue/FOO-803/remove-betas-parameter-from-all-api-call-sites)
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**
1. Write tests in `src/lib/__tests__/claude.test.ts`: for `analyzeFood`, `runToolLoop`, and `conversationalRefine`, assert that the stream call parameters do NOT contain a `betas` field. Update the existing "includes web_search tool with beta header" test (line 776) — rename to "includes web_search tool without beta header" and change assertion from `expect(call.betas).toContain(...)` to `expect(call.betas).toBeUndefined()` or `expect(call).not.toHaveProperty("betas")`.
2. Run `npx vitest run "claude.test"` — expect fail (3 call sites still pass `betas`).
3. In `src/lib/claude.ts`, remove `betas: [BETA_HEADER]` from:
   - `runToolLoop` stream params (line 847)
   - `analyzeFood` stream params (line 1164)
   - `conversationalRefine` stream params (line 1507)
4. In `src/lib/__tests__/claude.test.ts`:
   - Remove all `expect(call.betas).toContain("code-execution-web-tools-2026-02-09")` assertions (lines 787, 1253, 1965).
   - Remove `betas: [...]` from `minimalStreamParams` test fixture (line 2863).
5. Run `npx vitest run "claude.test"` — expect pass.

**Notes:**
- Task 1 deletes `BETA_HEADER` constant, so removing references to it in Task 2 is required for compilation.
- Tasks 1 and 2 must be done by the same worker or in sequence — they share file edits in both `claude.ts` and `claude.test.ts`.

### Task 3: Add container forwarding in tool loop and entry points
**Linear Issue:** [FOO-804](https://linear.app/lw-claude/issue/FOO-804/add-container-forwarding-in-tool-loop-and-entry-points)
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**
1. Write tests in `src/lib/__tests__/claude.test.ts`:
   - Test for `runToolLoop`: mock a multi-iteration tool loop where the first response includes `container: { id: "ctr_abc123" }`. Assert that the second `createStreamWithRetry` call includes `container: "ctr_abc123"` in its params.
   - Test for `analyzeFood`: mock initial response with `container: { id: "ctr_xyz" }` and `stop_reason: "pause_turn"` (triggering tool loop). Assert the tool loop call includes `container: "ctr_xyz"`.
   - Test for `conversationalRefine`: same pattern as `analyzeFood`.
   - Test: when response does NOT include `container`, subsequent calls should NOT include `container` param.
2. Run `npx vitest run "claude.test"` — expect fail.
3. In `src/lib/claude.ts`:
   - In `runToolLoop` (around line 820): add `let containerId: string | undefined;` to the loop state variables. After each `createStreamWithRetry` call (line 844), extract container: `if ((response as Record<string, unknown>).container) { containerId = ((response as Record<string, unknown>).container as { id: string }).id; }`. In the stream params object, add `...(containerId && { container: containerId })`.
   - In `analyzeFood` (around line 1161): after the initial `createStreamWithRetry` call, extract `containerId` from response using the same pattern. Pass it to `runToolLoop` — add an optional `containerId` parameter to `runToolLoop`'s signature and include it in the first iteration's stream params.
   - In `conversationalRefine` (around line 1504): same pattern as `analyzeFood`.
4. Run `npx vitest run "claude.test"` — expect pass.

**Notes:**
- The `container` field is at the top level of the `Message` response, but the SDK's `Anthropic.Message` type may not include it yet (SDK 0.75.0). Use `as Record<string, unknown>` cast to access it safely. This is the same pattern used elsewhere in the codebase for accessing runtime-available fields not yet in SDK types (e.g., `model_context_window_exceeded`).
- Container forwarding fixes FOOD-SCANNER-5 (22 events) and FOOD-SCANNER-3 (3 events).
- The `containerId` must persist across iterations within `runToolLoop` — a single `let` variable in the loop scope handles this.

### Task 4: Resolve Sentry issues
**Linear Issue:** [FOO-805](https://linear.app/lw-claude/issue/FOO-805/resolve-sentry-issues-food-scanner-5-6-3)
**Files:** None (Sentry MCP operations only)

**Steps:**
1. Resolve FOOD-SCANNER-6 (union type limit) — already fixed in code (strict mode removed), staging events are stale.
2. Resolve FOOD-SCANNER-5 (container_id) — will be fixed by Task 3 container forwarding. Resolve after code ships.
3. Resolve FOOD-SCANNER-3 (tool loop error) — related to container_id, will be fixed by Task 3.
4. No action on FOOD-SCANNER-7, 8, 9, 4, 2, 1 — already resolved/ignored, transient errors.

**Notes:**
- FOOD-SCANNER-6 can be resolved immediately since the fix is already deployed. FOOD-SCANNER-5 and FOOD-SCANNER-3 should be resolved after the container forwarding code ships.
- This task has no test steps — it's Sentry state management only.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Migrate Claude API integration from beta to GA endpoint, add container forwarding to fix active production errors, and resolve all Sentry issues.
**Linear Issues:** FOO-802, FOO-803, FOO-804, FOO-805
**Approach:** Remove all beta API traces from `claude.ts` (constant, method call, types, params) and tests (mock structure, assertions, fixtures). Add container ID extraction and forwarding in the tool loop and both entry points (`analyzeFood`, `conversationalRefine`). Resolve Sentry issues that are either already fixed or will be fixed by these changes.
**Scope:** 4 tasks, 2 files modified, ~12 tests
**Key Decisions:**
- SDK upgrade (0.75.0 → latest) deferred — not required for beta→GA migration, and avoids coupling unrelated changes.
- `model_context_window_exceeded` `as string` cast kept — GA `StopReason` type doesn't include it, but it works at runtime. Already handled by previous plan (FOO-782).
- `container` accessed via `as Record<string, unknown>` cast since SDK 0.75.0 types may not include the field.
- Tasks 1 and 2 should be done by the same worker (shared file edits).
**Risks:**
- Container field shape may differ from documented `{ id: string }` — tests should verify the extraction is resilient.
- GA `Parameters<Anthropic["messages"]["stream"]>[0]` type may not accept all fields that beta type did (e.g., `betas` field removal must happen before type change, or compilation fails).
