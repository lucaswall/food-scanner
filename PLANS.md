# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-379-chat-refinement-bugs
**Issues:** FOO-379, FOO-380
**Created:** 2026-02-13
**Last Updated:** 2026-02-13

## Summary

Fix two related bugs in the chat refinement flow: (1) the nutrition confirmation card shows stale data after logging from chat, and (2) the camera re-opens automatically when navigating back from chat to the analysis screen.

## Issues

### FOO-379: Nutrition card shows stale food name after chat refinement

**Priority:** High
**Labels:** Bug
**Description:** After refining a food item via chat (e.g., "Heineken 0.0" → "Mixed drink: beer and gin"), the confirmation nutrition card still displays the original food name. The Fitbit log and history page correctly show the refined name because the API receives the correct data — only the client-side display is stale.

**Root Cause:** `FoodAnalyzer` passes its original `analysis` state to `FoodLogConfirmation` (line 410-411). `FoodChat` correctly derives `latestAnalysis` from chat messages and sends it to `/api/log-food`, but only passes the `FoodLogResponse` back via `onLogged` — never the refined analysis.

**Acceptance Criteria:**
- [ ] After chat refinement + logging, confirmation card shows the refined food name and nutrition
- [ ] `FoodLogConfirmation` receives the analysis that was actually sent to `/api/log-food`
- [ ] History page and confirmation card show consistent data

### FOO-380: Camera re-opens automatically after closing chat refinement

**Priority:** High
**Labels:** Bug
**Description:** After entering chat refinement and pressing back, the camera opens automatically instead of returning to the analysis screen with the original analysis and log/refine options.

**Root Cause:** Home CTA navigates to `/app/analyze?autoCapture=true`. `PhotoCapture`'s `useEffect` (line 62-66) clicks the camera input whenever `autoCapture` is true. When chat closes, `PhotoCapture` remounts and the URL param is still set, triggering the camera again.

**Acceptance Criteria:**
- [ ] Camera auto-opens only once — on initial navigation from Home CTA
- [ ] Closing chat returns to analysis screen showing the original (pre-chat) analysis
- [ ] User can log the original analysis or enter chat refinement again (starting fresh)
- [ ] No camera prompt appears when returning from chat

## Prerequisites

- [ ] On `main` branch with clean working tree

## Implementation Tasks

### Task 1: Test — auto-capture should not re-trigger after photos taken (FOO-380)

**Issue:** FOO-380
**Files:**
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update the `PhotoCapture` mock (line 44-61) to also capture the `autoCapture` prop and expose it as a `data-auto-capture` attribute on the container div.

2. **RED** — Add a new `describe("autoCapture guard")` block with these tests:
   - "passes autoCapture to PhotoCapture on initial render" — render `<FoodAnalyzer autoCapture />`, assert `data-auto-capture="true"` on the photo-capture element.
   - "does not pass autoCapture after photos are taken and analysis exists" — render with `autoCapture`, simulate photo add + analyze (mock fetch returns analysis), then assert `data-auto-capture="false"`.
   - "does not pass autoCapture after returning from chat" — render with `autoCapture`, simulate photo add + analyze, open chat via refine button, close chat via close button, then assert `data-auto-capture="false"` on the re-rendered PhotoCapture.

3. Run: `npm test -- food-analyzer`
4. Verify: All three new tests fail (PhotoCapture always gets `autoCapture` prop as-is).

### Task 2: Implement — guard auto-capture in FoodAnalyzer (FOO-380)

**Issue:** FOO-380
**Files:**
- `src/components/food-analyzer.tsx` (modify)

**TDD Steps:**

1. **GREEN** — Add a `useRef(false)` in `FoodAnalyzer` to track whether auto-capture has already been used. In `handlePhotosChange`, when `files.length > 0`, set the ref to `true`. Pass `autoCapture={autoCapture && !ref.current}` to `PhotoCapture` (line 445).

2. Run: `npm test -- food-analyzer`
3. Verify: All three new tests from Task 1 pass, plus all existing tests still pass.

**Notes:**
- Use a ref (not state) because we don't need a re-render when the flag changes — it's read on the next render cycle when chat closes or photos change.
- Do NOT modify `PhotoCapture` itself — the fix belongs in the parent that decides whether to pass the prop.

### Task 3: Test — onLogged should pass refined analysis from chat (FOO-379)

**Issue:** FOO-379
**Files:**
- `src/components/__tests__/food-analyzer.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Update the `FoodChat` mock (line 173-200) to:
   - Accept an `onLogged` callback that takes `(response: FoodLogResponse, analysis: FoodAnalysis)` (two arguments).
   - The "Log from Chat" button should call `onLogged` with both a mock response AND a refined analysis object (different `food_name` from the initial, e.g., `"Mixed drink: beer and gin"`).

2. **RED** — Update the `FoodLogConfirmation` mock (line 158-171) to display the `foodName` prop so we can assert on it.

3. **RED** — Add a test in the `"conversational food chat"` describe block:
   - "shows refined food name on confirmation card after logging from chat" — render `<FoodAnalyzer />`, add photo, analyze, open chat, click "Log from Chat", then assert the confirmation displays the refined food name (not the original "Empanada de carne").

4. Run: `npm test -- food-analyzer`
5. Verify: New test fails because `FoodAnalyzer` ignores the second argument from `onLogged`.

### Task 4: Implement — bubble refined analysis through onLogged callback (FOO-379)

**Issue:** FOO-379
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)

**TDD Steps:**

1. **GREEN** — In `FoodChatProps` (line 35), change `onLogged` signature from `(response: FoodLogResponse) => void` to `(response: FoodLogResponse, analysis: FoodAnalysis) => void`.

2. **GREEN** — In `FoodChat.handleLog` (line 289), change `onLogged(result.data)` to `onLogged(result.data, latestAnalysis)`.

3. **GREEN** — In `FoodAnalyzer` (line 427), change `onLogged={setLogResponse}` to a handler that updates both `analysis` and `logResponse`:
   - Set analysis to the refined analysis first
   - Then set logResponse to the response
   - This ensures `FoodLogConfirmation` receives the refined analysis via the `analysis` state variable (line 411).

4. Run: `npm test -- food-analyzer`
5. Verify: New test from Task 3 passes, plus all existing tests still pass.

### Task 5: Update FoodChat tests for new onLogged signature (FOO-379)

**Issue:** FOO-379
**Files:**
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **GREEN** — Update the `defaultProps.onLogged` mock and assertions:
   - Tests that check `onLogged` was called should now verify it was called with two arguments: the response AND `latestAnalysis`.
   - Update "clicking Log to Fitbit calls /api/log-food" (line 337-360) to verify `onLogged` receives both the response and the initial analysis (since no chat refinement happened, `latestAnalysis` equals `initialAnalysis`).
   - Update "when assistant response includes analysis, that analysis is used by Log button" (line 279-335) to verify `onLogged` receives the refined analysis (the updated one with 640 calories), not the initial one.

2. Run: `npm test -- food-chat`
3. Verify: All FoodChat tests pass.

### Task 6: Integration & Verification

**Issue:** FOO-379, FOO-380
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Build check: `npm run build`

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Chat logging fails (API error) | Error shown in chat, no analysis update | Existing test |
| Chat logging succeeds but analysis is somehow null | Falls back to initial analysis | Defensive — `latestAnalysis` always has a value (falls back to `initialAnalysis`) |
| autoCapture prop with no URL param | Same as before — no camera trigger | Existing test |

## Risks & Open Questions

- [ ] None identified — both fixes are small, localized changes with clear test coverage.

## Scope Boundaries

**In Scope:**
- Fix stale analysis on confirmation card after chat logging (FOO-379)
- Fix camera re-opening after returning from chat (FOO-380)
- Update tests for both fixes

**Out of Scope:**
- Changing the `/api/log-food` response to echo back the analysis (alternative approach, not needed)
- Clearing the `?autoCapture` URL parameter (ref-based approach is simpler)
- Any changes to `PhotoCapture` component itself
