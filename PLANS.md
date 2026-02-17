# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-576-sse-fixes
**Issues:** FOO-576, FOO-577, FOO-578, FOO-579, FOO-580
**Created:** 2026-02-17
**Last Updated:** 2026-02-17

## Summary

Fix 5 issues from the SSE deep review: a High-priority bug where the analyzeFood slow path silently loses text-only responses, a High-priority performance issue where FoodChat leaks Claude API resources on unmount, and 3 Low-priority polish fixes for defensive SSE error handling, consecutive tool_start empty bubbles, and text_delta token fragments in the loading indicator.

## Issues

### FOO-576: FoodChat missing AbortController cleanup on unmount

**Priority:** High
**Labels:** Performance
**Description:** FoodChat uses `AbortSignal.timeout(120000)` but has no AbortController to cancel in-flight SSE fetches on unmount. When the user navigates away during streaming, the Claude API call continues for up to 120 seconds.

**Acceptance Criteria:**
- [ ] FoodChat creates an AbortController per `handleSend()` call (stored in a ref)
- [ ] Signal combines controller + timeout via `AbortSignal.any()`
- [ ] useEffect cleanup aborts on unmount
- [ ] SSE reader catch block handles AbortError gracefully
- [ ] Test: unmount during active SSE aborts the fetch

### FOO-577: analyzeFood slow path text-only response silently lost

**Priority:** High
**Labels:** Bug
**Description:** When `analyzeFood()` triggers the slow path (data tools), it delegates to `runToolLoop()` via `yield*`. If Claude responds with text only (no `report_nutrition`), the text_delta events are consumed as ephemeral loading indicators and no `needs_chat` event is emitted. The user sees nothing after the loading animation ends.

**Acceptance Criteria:**
- [ ] analyzeFood slow path wraps `runToolLoop()` iteration (not `yield*`) to intercept events
- [ ] Text from `text_delta` events is accumulated during the slow path
- [ ] If `done` arrives without a prior `analysis` event, `needs_chat` is yielded with accumulated text
- [ ] `runToolLoop` itself remains unchanged (conversationalRefine still uses it directly)
- [ ] Test: analyzeFood slow path with text-only tool loop response triggers `needs_chat`

### FOO-578: createSSEResponse catch block can throw on cancelled stream

**Priority:** Low
**Labels:** Bug
**Description:** In `createSSEResponse()`, if the generator throws after client disconnect, the catch block calls `controller.enqueue()` and `controller.close()` on a cancelled ReadableStream, which may throw and produce unhandled rejection warnings.

**Acceptance Criteria:**
- [ ] Catch block wraps `controller.enqueue()` and `controller.close()` in nested try/catch
- [ ] Inner catch silently ignores (stream already closed)
- [ ] Test: generator throws after stream cancel doesn't produce unhandled rejection

### FOO-579: FoodChat consecutive tool_start events create empty message bubbles

**Priority:** Low
**Labels:** Improvement
**Description:** When Claude calls multiple tools simultaneously, consecutive `tool_start` events each push a new empty assistant message, creating briefly visible empty chat bubbles.

**Acceptance Criteria:**
- [ ] tool_start handler skips pushing a new message if last assistant message is already empty (no content, not isThinking)
- [ ] Test: multiple consecutive tool_start events produce only one empty assistant message

### FOO-580: FoodAnalyzer text_delta shows token fragments in loading step

**Priority:** Low
**Labels:** Improvement
**Description:** During analysis, `text_delta` events replace `loadingStep` with individual token fragments instead of accumulating. The user sees single words flash by.

**Acceptance Criteria:**
- [ ] text_delta content is accumulated into a ref/variable during analysis SSE streaming
- [ ] The accumulated text is displayed as loadingStep
- [ ] tool_start events reset the accumulator (new thinking phase)
- [ ] Test: multiple text_delta events produce a coherent loading step message

## Prerequisites

- [ ] On `main` branch, clean working tree
- [ ] `npm test` passes
- [ ] No DB schema changes required

## Implementation Tasks

### Task 1: Guard createSSEResponse catch block against cancelled stream

**Issue:** FOO-578
**Files:**
- `src/lib/sse.ts` (modify)
- `src/lib/__tests__/sse.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add test in `src/lib/__tests__/sse.test.ts` under the "error handling" describe block:
   - Test: "does not throw when generator errors after stream is cancelled"
   - Create an async generator that throws an Error
   - Create a `createSSEResponse()` from it
   - Get the reader from the response body, then call `reader.cancel()` to simulate client disconnect
   - Consume the reader to trigger the generator iteration — the catch block should not produce unhandled rejections
   - Run: `npm test -- sse`
   - Verify: Test fails (currently no guard)

2. **GREEN** — Modify `src/lib/sse.ts` `createSSEResponse()`:
   - In the catch block (lines 36-45), wrap `controller.enqueue()` and `controller.close()` in a nested `try { ... } catch { /* stream already closed */ }`
   - Run: `npm test -- sse`
   - Verify: Test passes

3. **REFACTOR** — No refactoring needed; this is a single defensive wrapper.

**Notes:**
- The fix is a 3-line change. The existing error-handling tests in sse.test.ts (lines 220-264) validate the happy path; the new test validates the cancel-then-error edge case.

### Task 2: Emit needs_chat for text-only responses in analyzeFood slow path

**Issue:** FOO-577
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add test in `src/lib/__tests__/claude.test.ts` in the analyzeFood describe block:
   - Test: "slow path: yields needs_chat when tool loop ends with text only (no analysis)"
   - Mock first stream: data tool call (like `makeDataToolStream("search_food_log", ...)`)
   - Mock `executeTool` to return search results
   - Mock second stream: text-only response via `makeTextStream("I found both sizes. Which do you want?")` — this simulates Claude responding with text after using data tools, without calling `report_nutrition`
   - Collect events from `analyzeFood()`
   - Assert: events contain `{ type: "needs_chat", message: "I found both sizes. Which do you want?" }`
   - Assert: events contain `{ type: "done" }`
   - Assert: events do NOT contain `{ type: "analysis", ... }`
   - Run: `npm test -- claude`
   - Verify: Test fails (currently `needs_chat` is not emitted on slow path)

2. **GREEN** — Modify `src/lib/claude.ts` `analyzeFood()` slow path (around line 1001):
   - Replace `yield* runToolLoop(...)` with a manual iteration loop over `runToolLoop()`
   - Accumulate text from `text_delta` events into a local string variable
   - Track whether an `analysis` event was seen (boolean flag)
   - For all events except `done`, yield them through (pass-through)
   - When `done` is encountered: if no `analysis` was seen and accumulated text is non-empty, yield `{ type: "needs_chat", message: accumulatedText }` before yielding `done`
   - Run: `npm test -- claude`
   - Verify: Test passes

3. **REFACTOR** — Verify the existing slow path test ("slow path: yields tool_start and eventually analysis when data tools used" at line 361) still passes — it should, since the analysis case is unaffected.

**Notes:**
- `runToolLoop` must NOT be modified — it's also used by `conversationalRefine` where text-only end_turn is normal behavior.
- The `text_delta` events are still yielded to the client (food-analyzer shows them as loading indicators). The accumulated text is only used if no analysis arrives.
- Reference pattern: fast path text-only handling at claude.ts:1027-1043 — the slow path wrapper should produce the same outcome.
- The existing test at line 395 (`makeTextStream("Based on your log...")`) currently doesn't assert `needs_chat` — after this fix it should be updated to verify `needs_chat` is emitted there too.

### Task 3: Add AbortController cleanup to FoodChat on unmount

**Issue:** FOO-576
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test in `src/components/__tests__/food-chat.test.tsx`:
   - Test: "aborts in-flight SSE request on unmount"
   - Spy on `AbortController.prototype.abort`
   - Render FoodChat with SSE props, trigger a send to start streaming
   - `unmount()` the component
   - Assert: `abort()` was called
   - Restore the spy
   - Run: `npm test -- food-chat`
   - Verify: Test fails (no AbortController in food-chat currently)
   - Reference: `src/components/__tests__/food-analyzer.test.tsx:2182-2210` — same pattern

2. **GREEN** — Modify `src/components/food-chat.tsx`:
   - Add an `abortControllerRef = useRef<AbortController | null>(null)` (follow food-analyzer.tsx:118 pattern)
   - In `handleSend()` (around line 289): create a new `AbortController`, store in ref, use `AbortSignal.any([controller.signal, AbortSignal.timeout(120000)])` as the fetch signal
   - Add/modify the unmount useEffect (line 138-145) to also abort the controller: `abortControllerRef.current?.abort()`
   - In the SSE reader catch block: handle `AbortError` by silently returning (don't call `revertOnError`)
   - Run: `npm test -- food-chat`
   - Verify: Test passes

3. **REFACTOR** — Verify the timeout test ("shows friendly error when SSE stream times out", if it exists) still passes with the combined signal.

**Notes:**
- Reference implementation: `src/components/food-analyzer.tsx:118,162-164,534-543` — FoodAnalyzer already has the correct pattern.
- `AbortSignal.any()` is available in modern browsers and Node.js 20+. The project targets modern browsers (PWA).
- The existing unmount useEffect at food-chat.tsx:138-145 clears `compressionWarningTimeoutRef` — add the abort call to the same cleanup function.

### Task 4: Prevent empty bubbles from consecutive tool_start events in FoodChat

**Issue:** FOO-579
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test in `src/components/__tests__/food-chat.test.tsx`:
   - Test: "consecutive tool_start events produce only one empty assistant message"
   - Mock SSE response with: `[text_delta("Hello"), tool_start("search_food_log"), tool_start("get_nutrition_summary"), text_delta("Here's what I found"), done]`
   - Render and send a message
   - Assert: exactly 1 thinking message (the "Hello" one gets isThinking flag)
   - Assert: the final assistant message contains "Here's what I found"
   - Assert: no empty visible message bubbles (no assistant messages with empty content that aren't the final streaming one)
   - Run: `npm test -- food-chat`
   - Verify: Test fails (currently 2 empty messages are pushed)

2. **GREEN** — Modify `src/components/food-chat.tsx` tool_start handler (line 341-351):
   - Add an early return condition: if the last assistant message is already empty AND not isThinking, skip pushing a new message (the existing empty message will serve as the placeholder)
   - The existing logic (set isThinking on last message if it has content, then push new) remains for when there IS prior text
   - Run: `npm test -- food-chat`
   - Verify: Test passes

3. **REFACTOR** — Verify the existing test "multiple tool loops create separate thinking bubbles" (line 1682) still passes — it has text between tool_start events so shouldn't be affected.

**Notes:**
- The fix is a 2-3 line guard clause. Reference the existing tool_start handler structure at food-chat.tsx:341-351.
- The existing test at line 1682 uses `[text_delta, tool_start, text_delta, tool_start, text_delta, done]` with text between each tool_start — this pattern should be unaffected since the guard only skips when the last message is empty.

### Task 5: Accumulate text_delta into coherent loading step in FoodAnalyzer

**Issue:** FOO-580
**Files:**
- `src/components/food-analyzer.tsx` (modify)
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test in `src/components/__tests__/food-analyzer.test.tsx`:
   - Test: "accumulates text_delta events into coherent loading step during analysis"
   - Mock SSE response with: `[text_delta("Let me "), text_delta("analyze "), text_delta("this food"), tool_start("search_food_log"), analysis({...}), done]`
   - Render FoodAnalyzer with a test image, trigger analysis
   - After text_delta events: assert the loading step shows "Let me analyze this food" (accumulated)
   - After tool_start: assert the loading step switches to the tool description (accumulator resets)
   - Run: `npm test -- food-analyzer`
   - Verify: Test fails (currently shows only "this food")

2. **GREEN** — Modify `src/components/food-analyzer.tsx`:
   - Add a `textDeltaBufferRef = useRef("")` to accumulate text_delta content across SSE events
   - In the SSE event loop, text_delta handler (line 213-214): append `event.text` to `textDeltaBufferRef.current`, then `setLoadingStep(textDeltaBufferRef.current)`
   - In tool_start handler (line 215-216): reset `textDeltaBufferRef.current = ""`
   - Reset the buffer at the start of `handleAnalyze` (before the SSE loop) to avoid stale state
   - Run: `npm test -- food-analyzer`
   - Verify: Test passes

3. **REFACTOR** — Verify existing tests still pass, particularly any test that checks loadingStep text.

**Notes:**
- The ref pattern is used because we're inside an async function (the SSE reader loop). A useState would cause unnecessary re-renders on each token; a ref accumulates silently and only triggers a single `setLoadingStep` per token.
- Reference: `src/components/food-chat.tsx:327-333` — chat correctly accumulates with `last.content + event.text`, demonstrating the expected pattern.

### Task 6: Integration & Verification

**Issue:** FOO-576, FOO-577, FOO-578, FOO-579, FOO-580
**Files:**
- Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`
5. Manual verification notes:
   - [ ] SSE streaming for food analysis still works (text_delta → tool_start → analysis flow)
   - [ ] Chat mode transitions work (needs_chat from both fast and slow paths)
   - [ ] Navigating away during active stream cancels properly
   - [ ] Multiple tool calls in chat don't show empty bubbles

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Client disconnects during SSE | Server catch block handles gracefully | Task 1 (sse.test.ts) |
| Slow path text-only response | Emits needs_chat, transitions to chat | Task 2 (claude.test.ts) |
| Unmount during active chat SSE | Aborts fetch, no resource leak | Task 3 (food-chat.test.tsx) |
| AbortError in SSE reader | Silently handled, no error toast | Task 3 (food-chat.test.tsx) |

## Risks & Open Questions

- [ ] `AbortSignal.any()` browser support: Modern browsers support it. Verify in tsconfig/target that it's available. If not, fall back to manual signal combining.

## Scope Boundaries

**In Scope:**
- Guard createSSEResponse catch block against cancelled stream
- Emit needs_chat for text-only responses in analyzeFood slow path
- Add AbortController cleanup to FoodChat
- Prevent empty bubbles from consecutive tool_start events
- Accumulate text_delta into coherent loading step

**Out of Scope:**
- Refactoring the SSE streaming architecture
- Adding retry/reconnection logic to SSE consumers
- Changing the StreamEvent type union
- Server-side abort propagation (already works correctly)
