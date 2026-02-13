# Implementation Plan

**Status:** IN_PROGRESS
**Branch:** feat/FOO-370-conversational-food-chat
**Issues:** FOO-369, FOO-370, FOO-371, FOO-372, FOO-373
**Created:** 2026-02-13
**Last Updated:** 2026-02-13

## Summary

Implement conversational food analysis refinement (multi-turn chat replacing single-shot correction), fix raw SyntaxError on HTML error pages, and add over-goal visual indicators to CalorieRing and MacroBars.

## Issues

### FOO-373: Calorie ring: hide budget marker and turn text red when over goal

**Priority:** Low
**Labels:** Improvement
**Description:** When calories exceed the daily goal, the budget marker is clamped at 100% and becomes meaningless. No visual color change indicates the user has gone over their goal.

**Acceptance Criteria:**
- [ ] Budget marker is hidden when `calories >= goal`
- [ ] Calorie count text turns `text-destructive` when `calories > goal`
- [ ] Macro bar labels turn `text-destructive` when `consumed > goal`
- [ ] Existing tests updated and new tests added for destructive color behavior

### FOO-369: API fetch calls show raw SyntaxError when server returns HTML error page

**Priority:** Low
**Labels:** Bug
**Description:** Client-side `response.json()` calls throw raw `SyntaxError` when the server or Railway's reverse proxy returns an HTML error page (502/503). User sees cryptic error like `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`.

**Acceptance Criteria:**
- [ ] Safe JSON parse utility created and tested
- [ ] All client-side fetch calls in `food-analyzer.tsx` use safe parsing
- [ ] User sees a friendly error message instead of raw SyntaxError
- [ ] Auto-resubmit effect also uses safe parsing

### FOO-370: Multi-turn chat API for food analysis refinement

**Priority:** High
**Labels:** Feature
**Description:** Replace single-shot refinement with a multi-turn chat API. New `POST /api/chat-food` endpoint accepting full message history. Claude can respond with text-only (questions/confirmations) or text + `report_nutrition` tool_use (when food changes).

**Acceptance Criteria:**
- [ ] New `conversationalRefine()` function in `src/lib/claude.ts` accepting full message history
- [ ] Uses `tool_choice: { type: "auto" }` so Claude can respond conversationally
- [ ] New `POST /api/chat-food` endpoint with auth, rate limiting, validation
- [ ] System prompt includes chat behavior rules
- [ ] Images sent only on turns where user provides them
- [ ] Usage tracked as "food-chat" operation type
- [ ] `ConversationMessage` type defined in `src/types/index.ts`

### FOO-371: FoodChat component for conversational refinement

**Priority:** High
**Labels:** Feature
**Description:** New `src/components/food-chat.tsx` client component for multi-turn food analysis conversation.

**Acceptance Criteria:**
- [ ] Message list with clear user/assistant visual distinction
- [ ] Text input with send button at bottom
- [ ] Inline camera button for adding photos mid-conversation (reuse `PhotoCapture` picker)
- [ ] Pinned "Log to Fitbit" button always visible
- [ ] Close (X) button to discard conversation
- [ ] `MealTypeSelector` near the Log button
- [ ] All state is ephemeral (React state only)
- [ ] Mobile-first layout, 44px touch targets
- [ ] Uses safe JSON parse utility from FOO-369

### FOO-372: Wire FoodChat into the analysis flow

**Priority:** High
**Labels:** Feature
**Description:** Replace the post-analysis correction input in `FoodAnalyzer` with `FoodChat`. Delete old refinement code.

**Acceptance Criteria:**
- [ ] After initial analysis, show collapsed input hint instead of correction input
- [ ] Tapping hint transitions to `FoodChat` with initial analysis
- [ ] Tapping "Log" without entering chat logs immediately (unchanged)
- [ ] When chat is open: hide food matches section, hide Re-analyze button
- [ ] Post-log flow reuses existing `FoodLogConfirmation`
- [ ] Close (X) or navigation away discards chat state silently
- [ ] Delete `/api/refine-food/route.ts` and its tests
- [ ] Delete `refineAnalysis()` from `claude.ts` and its tests
- [ ] Remove old correction input, refine error display, and Re-analyze button
- [ ] Updated food-analyzer tests reflect new flow

## Prerequisites

- [ ] On `main` branch, clean working tree
- [ ] All existing tests pass
- [ ] Linear MCP connected

## Implementation Tasks

### Task 1: CalorieRing over-goal visual indicators

**Issue:** FOO-373
**Files:**
- `src/components/__tests__/calorie-ring.test.tsx` (modify)
- `src/components/calorie-ring.tsx` (modify)
- `src/components/__tests__/macro-bars.test.tsx` (modify)
- `src/components/macro-bars.tsx` (modify)

**TDD Steps:**

1. **RED** — Add tests to `calorie-ring.test.tsx`:
   - Test: budget marker is NOT rendered when `calories >= goal` (e.g., `calories={2000} goal={2000} budget={500}`)
   - Test: budget marker IS still rendered when `calories < goal` (existing behavior preserved)
   - Test: calorie count text has `text-destructive` class when `calories > goal`
   - Test: calorie count text does NOT have `text-destructive` when `calories <= goal`
   - Test: calorie count text does NOT have `text-destructive` when `calories === goal` (at goal is not over)
   - Run: `npm test -- calorie-ring`
   - Verify: new tests fail

2. **GREEN** — Modify `calorie-ring.tsx`:
   - Compute `const isOverGoal = goal > 0 && calories > goal`
   - Conditionally hide the budget marker: only render when `budgetPosition !== null && !isOverGoal` (where `isOverGoal` means `calories >= goal` for the marker — hide at exactly goal too since marker is meaningless)
   - Apply `text-destructive` to the calorie count `<span>` when `isOverGoal`
   - Run: `npm test -- calorie-ring`
   - Verify: all tests pass

3. **RED** — Add tests to `macro-bars.test.tsx`:
   - Test: label text has `text-destructive` class when consumed exceeds goal (e.g., `proteinG={150} proteinGoal={100}`)
   - Test: label text does NOT have `text-destructive` when consumed is within goal
   - Test: label text does NOT have `text-destructive` when no goal is set
   - Run: `npm test -- macro-bars`
   - Verify: new tests fail

4. **GREEN** — Modify `macro-bars.tsx`:
   - Add `isOverGoal` boolean to `calculateMacroData` return value: `true` when `hasGoal && consumed > goal`
   - Apply `text-destructive` to the label `<span>` when `isOverGoal` is true (replacing `text-muted-foreground`)
   - Run: `npm test -- macro-bars`
   - Verify: all tests pass

**Notes:**
- The budget marker hide condition should be `calories >= goal` (at exactly 100%, marker sits at the same position as the full ring, which is confusing)
- The text destructive condition should be `calories > goal` (strictly over, not at-goal)
- Reference: existing calorie-ring budget marker tests at `src/components/__tests__/calorie-ring.test.tsx:106-183`
- Reference: existing macro-bars goal tests at `src/components/__tests__/macro-bars.test.tsx:96-236`

---

### Task 2: Safe JSON parse utility for fetch calls

**Issue:** FOO-369
**Files:**
- `src/lib/__tests__/safe-json.test.ts` (create)
- `src/lib/safe-json.ts` (create)

**TDD Steps:**

1. **RED** — Create `src/lib/__tests__/safe-json.test.ts`:
   - Test: `safeResponseJson(response)` returns parsed JSON when response has valid JSON body
   - Test: returns `{ success: false, error: { code: "INTERNAL_ERROR", message: "Server returned an unexpected response. Please try again." } }` when body is HTML (starts with `<!DOCTYPE` or `<html`)
   - Test: returns the same fallback error response when `JSON.parse()` throws for any other non-JSON content
   - Test: returns parsed JSON even when `content-type` header is missing (some proxies strip headers)
   - Run: `npm test -- safe-json`
   - Verify: tests fail

2. **GREEN** — Create `src/lib/safe-json.ts`:
   - Export `async function safeResponseJson(response: Response): Promise<unknown>` — reads `response.text()`, then `JSON.parse()`, catching SyntaxError and returning the fallback error shape
   - The fallback shape must match the `ApiErrorResponse` type from `src/types/index.ts` so callers can treat it like any other error response
   - Run: `npm test -- safe-json`
   - Verify: all tests pass

**Notes:**
- Pattern reference: `src/lib/swr.ts` already does `.json().catch(() => ({}))` — this utility does a more robust version
- The utility must return an object matching `ApiErrorResponse` shape so existing error handling code in `food-analyzer.tsx` (`result.error?.message`) works unchanged

---

### Task 3: Apply safe JSON parsing to FoodAnalyzer

**Issue:** FOO-369
**Files:**
- `src/components/__tests__/food-analyzer.test.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)

**TDD Steps:**

1. **RED** — Add test to `food-analyzer.test.tsx`:
   - Test: when analyze-food fetch returns HTML (mock `response.json()` to throw SyntaxError or mock text body as HTML), the error shown to user is the friendly message, not raw SyntaxError
   - Test: same for log-food fetch returning HTML
   - Run: `npm test -- food-analyzer`
   - Verify: new tests fail (currently shows raw SyntaxError)

2. **GREEN** — Modify `food-analyzer.tsx`:
   - Import `safeResponseJson` from `@/lib/safe-json`
   - Replace all `await response.json()` calls with `await safeResponseJson(response)` for:
     - `handleAnalyze` (line ~145)
     - `handleLogToFitbit` (line ~264)
     - `handleUseExisting` (line ~332)
     - Auto-resubmit effect (line ~415)
   - Do NOT change the `handleRefine` call (line ~205) — it will be deleted by FOO-372
   - Do NOT change the `/api/find-matches` calls — they already silently ignore errors
   - Run: `npm test -- food-analyzer`
   - Verify: all tests pass

**Notes:**
- The auto-resubmit effect at line ~415 also uses `.then((r) => r.json())` — this should use `safeResponseJson` too
- Reference: `src/components/food-analyzer.tsx:140-177` (handleAnalyze), `:240-298` (handleLogToFitbit), `:300-367` (handleUseExisting), `:410-431` (resubmit effect)

---

### Task 4: ConversationMessage type and chat system prompt

**Issue:** FOO-370
**Files:**
- `src/types/index.ts` (modify)
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **Add `ConversationMessage` type** to `src/types/index.ts`:
   - Define `ConversationMessage` interface with `role: 'user' | 'assistant'`, `content: string`, and optional `analysis?: FoodAnalysis` (the latest analysis when assistant responded with tool_use)
   - Define `ChatFoodRequest` interface with `messages: ConversationMessage[]` and optional `images?: string[]` (base64 strings for new photos on this turn)
   - Define `ChatFoodResponse` interface with `message: string` (assistant's text response) and optional `analysis?: FoodAnalysis` (present when Claude used report_nutrition tool)

2. **Add `CHAT_SYSTEM_PROMPT`** constant to `src/lib/claude.ts`:
   - Extends the existing `SYSTEM_PROMPT` with chat behavior rules
   - Rules: always confirm changes with updated summary, don't repeat unchanged info, new photos add to meal, corrections override previous values, ask clarifying questions when ambiguous
   - This is a constant — no test needed, it will be tested through the `conversationalRefine` function

**Notes:**
- The `ConversationMessage` type is the client-side representation. The API route will convert these to Anthropic SDK message format
- Keep types minimal — no DB persistence for chat conversations
- Reference: `src/types/index.ts` for existing type patterns

---

### Task 5: conversationalRefine function

**Issue:** FOO-370
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**TDD Steps:**

1. **RED** — Add `describe("conversationalRefine")` block to `src/lib/__tests__/claude.test.ts`:
   - Test: accepts message history array and returns `{ message: string, analysis?: FoodAnalysis }`
   - Test: when Claude responds with text only (no tool_use), returns `{ message: "text" }` with no analysis
   - Test: when Claude responds with text + tool_use, returns `{ message: "text", analysis: validatedFoodAnalysis }`
   - Test: uses `tool_choice: { type: "auto" }` (not forced)
   - Test: uses `CHAT_SYSTEM_PROMPT` (the extended prompt)
   - Test: uses `max_tokens: 2048`
   - Test: images are included only when provided (first message or new photos)
   - Test: records usage as "food-chat" operation type
   - Test: throws CLAUDE_API_ERROR on API failure
   - Run: `npm test -- claude`
   - Verify: new tests fail

2. **GREEN** — Add `conversationalRefine()` to `src/lib/claude.ts`:
   - Signature: `async function conversationalRefine(messages: ConversationMessage[], images: ImageInput[], userId?: string): Promise<{ message: string; analysis?: FoodAnalysis }>`
   - Convert `ConversationMessage[]` to Anthropic SDK messages format: each entry becomes `{ role, content: [{ type: "text", text }] }`. Images are prepended to the first user message or to any user message that includes new photos
   - Call `getClient().messages.create()` with `tool_choice: { type: "auto" }`, `max_tokens: 2048`, `CHAT_SYSTEM_PROMPT`
   - Parse response: extract text blocks into `message` string. If a `tool_use` block is present, validate via `validateFoodAnalysis()` and include as `analysis`
   - Record usage as "food-chat"
   - Run: `npm test -- claude`
   - Verify: all tests pass

**Notes:**
- `tool_choice: "auto"` allows Claude to respond with just text (for questions/confirmations) or text + tool (when nutritional info changes)
- The function must handle the case where Claude returns ONLY a text block (no tool_use) — this is expected for conversational responses like "Got it, anything else?"
- Reference: `src/lib/claude.ts:226-315` (analyzeFood pattern to follow)
- Export `CHAT_SYSTEM_PROMPT` from claude.ts only for testing purposes (test verifies it's used in the API call)

---

### Task 6: POST /api/chat-food endpoint

**Issue:** FOO-370
**Files:**
- `src/app/api/chat-food/__tests__/route.test.ts` (create)
- `src/app/api/chat-food/route.ts` (create)

**TDD Steps:**

1. **RED** — Create `src/app/api/chat-food/__tests__/route.test.ts`:
   - Test: returns 401 when no session
   - Test: returns 401 when session is invalid
   - Test: returns 429 when rate limit exceeded
   - Test: returns 400 when messages array is missing or empty
   - Test: returns 400 when messages contain invalid shape
   - Test: returns success with assistant message when Claude returns text-only response
   - Test: returns success with assistant message AND analysis when Claude returns text + tool_use
   - Test: passes images to Claude when provided in request
   - Test: returns 500 on Claude API error
   - Run: `npm test -- chat-food`
   - Verify: tests fail

2. **GREEN** — Create `src/app/api/chat-food/route.ts`:
   - Follow the same auth + rate-limit + validation pattern as `src/app/api/analyze-food/route.ts`
   - Accept JSON body: `{ messages: ConversationMessage[], images?: base64[] }` — note this is JSON, not FormData (images are base64 strings since they're already compressed client-side)
   - Validate messages array: non-empty, each message has role and content
   - Call `conversationalRefine()` with the messages and any images
   - Return `successResponse({ message, analysis })` — `ChatFoodResponse` shape
   - Rate limit key: `chat-food:${session.userId}`
   - Run: `npm test -- chat-food`
   - Verify: all tests pass

**Notes:**
- This endpoint uses JSON instead of FormData because images in the chat are already compressed client-side and sent as base64 strings (they were compressed during the initial analysis and stored in React state)
- Reference: `src/app/api/analyze-food/route.ts` for auth + rate-limit pattern
- Reference: `src/app/api/refine-food/route.ts` for validation pattern (will be deleted later but useful reference during implementation)

---

### Task 7: FoodChat component

**Issue:** FOO-371
**Files:**
- `src/components/__tests__/food-chat.test.tsx` (create)
- `src/components/food-chat.tsx` (create)

**TDD Steps:**

1. **RED** — Create `src/components/__tests__/food-chat.test.tsx`:
   - Test: renders initial assistant message from the initial analysis (summary text)
   - Test: renders text input with send button at bottom
   - Test: renders "Log to Fitbit" button always visible
   - Test: renders close (X) button
   - Test: renders MealTypeSelector
   - Test: typing and sending a message calls `POST /api/chat-food` with message history
   - Test: assistant response is displayed in message list
   - Test: when assistant response includes analysis, that analysis is used by Log button
   - Test: clicking Log to Fitbit calls `/api/log-food` with the latest analysis
   - Test: clicking close (X) calls onClose callback
   - Test: shows loading indicator while waiting for chat response
   - Test: shows error message on chat API failure (using safe JSON parse)
   - Test: send button is disabled when input is empty or while loading
   - Mock `PhotoCapture`, `MealTypeSelector`, `FoodLogConfirmation` as in food-analyzer tests
   - Run: `npm test -- food-chat`
   - Verify: tests fail

2. **GREEN** — Create `src/components/food-chat.tsx`:
   - Props interface: `{ initialAnalysis: FoodAnalysis, compressedImages: Blob[], onClose: () => void, onLogged: (response: FoodLogResponse) => void }`
   - State: `messages: ConversationMessage[]` (initialized with assistant message summarizing initial analysis), `input: string`, `loading: boolean`, `error: string | null`, `mealTypeId: number`
   - The latest `analysis` is extracted from messages: find the last message that has an `analysis` field, falling back to `initialAnalysis`
   - `handleSend`: append user message to state, call `POST /api/chat-food` with full message history (and images on first turn or when new photos added), append assistant response
   - `handleLog`: call `POST /api/log-food` with the latest analysis (same pattern as `handleLogToFitbit` in food-analyzer)
   - Layout: scrollable message list (top), input bar with camera button and send button (bottom), pinned Log + MealTypeSelector area
   - Mobile-first: full-width, touch targets 44px
   - Use `safeResponseJson` from `@/lib/safe-json` for all fetch calls
   - Run: `npm test -- food-chat`
   - Verify: all tests pass

3. **REFACTOR** — Extract initial assistant message generation:
   - The initial assistant message text should summarize the food analysis in a natural way (e.g., "I analyzed your food as Empanada de carne (320 cal). Anything you'd like to correct?")
   - This can be a simple template string — no need for a separate function

**Notes:**
- `PhotoCapture` is reused for the inline camera button in the input bar — import the existing component but configure it for inline use (photo picker only, not full capture flow)
- Message list should auto-scroll to bottom on new messages
- Reference: `src/components/food-analyzer.tsx` for the logging flow pattern (optimistic UI, pending submission, etc.)
- Reference: `src/components/meal-type-selector.tsx` for the MealTypeSelector usage pattern
- The `onLogged` callback lets the parent component (`FoodAnalyzer`) handle the post-log confirmation flow

---

### Task 8: Wire FoodChat into FoodAnalyzer

**Issue:** FOO-372
**Files:**
- `src/components/__tests__/food-analyzer.test.tsx` (modify)
- `src/components/food-analyzer.tsx` (modify)

**TDD Steps:**

1. **RED** — Update tests in `food-analyzer.test.tsx`:
   - Remove/update tests that reference the correction input, refine error display, and Re-analyze button
   - Add test: after analysis, a chat input hint is shown ("Add details or correct something...")
   - Add test: tapping the hint renders `FoodChat` component
   - Add test: tapping "Log to Fitbit" without entering chat logs immediately (existing quick-log path unchanged)
   - Add test: when FoodChat is open, food matches section is hidden
   - Add test: when FoodChat's onClose is called, returns to the post-analysis view
   - Add test: when FoodChat's onLogged is called, shows `FoodLogConfirmation`
   - Add mock for `FoodChat` component (same pattern as other component mocks)
   - Run: `npm test -- food-analyzer`
   - Verify: updated tests fail

2. **GREEN** — Modify `food-analyzer.tsx`:
   - Add `chatOpen: boolean` state
   - Remove `correction`, `refining`, `refineError` state and `handleRefine` function
   - Replace the correction input + Re-analyze button section with: a tappable hint row ("Add details or correct something...") that sets `chatOpen = true`
   - When `chatOpen === true`: render `<FoodChat>` passing `initialAnalysis`, `compressedImages`, `onClose` (sets `chatOpen = false`), `onLogged` (sets `logResponse` to show confirmation)
   - When `chatOpen === true`: hide the food matches section, the hint row, and the Log/MealTypeSelector area (FoodChat has its own Log button)
   - When `chatOpen === false`: show the hint row, Log button, MealTypeSelector, and food matches as before
   - Run: `npm test -- food-analyzer`
   - Verify: all tests pass

**Notes:**
- The FoodChat component handles its own logging flow internally and calls `onLogged(response)` when done — the parent just needs to switch to the confirmation view
- The `compressedImages` are already stored in state from the initial analysis — pass them to FoodChat for the first chat turn
- Reference: `src/components/food-analyzer.tsx:534-631` for the current post-analysis controls section being replaced

---

### Task 9: Delete old refinement code

**Issue:** FOO-372
**Files:**
- `src/app/api/refine-food/route.ts` (delete)
- `src/app/api/refine-food/__tests__/route.test.ts` (delete)
- `src/lib/claude.ts` (modify — remove `refineAnalysis`)
- `src/lib/__tests__/claude.test.ts` (modify — remove `refineAnalysis` tests)

**Steps:**

1. Delete `src/app/api/refine-food/route.ts`
2. Delete `src/app/api/refine-food/__tests__/route.test.ts`
3. Remove `refineAnalysis()` function and its export from `src/lib/claude.ts`
4. Remove the entire `describe("refineAnalysis")` block from `src/lib/__tests__/claude.test.ts`
5. Remove any remaining imports of `refineAnalysis` across the codebase (grep to confirm)
6. Run: `npm test`
7. Verify: all tests pass, no unused imports

**Notes:**
- `analyzeFood()` in claude.ts remains unchanged (forced tool_use for initial analysis)
- The `SYSTEM_PROMPT` constant remains (used by `analyzeFood`); `CHAT_SYSTEM_PROMPT` is the new one for chat
- After deletion, confirm no other files reference `/api/refine-food` or `refineAnalysis`

---

### Task 10: Integration & Verification

**Issues:** FOO-369, FOO-370, FOO-371, FOO-372, FOO-373
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run build: `npm run build`
5. Verify zero warnings
6. Grep for dead references:
   - `refineAnalysis` should not appear anywhere except git history
   - `/api/refine-food` should not appear anywhere except git history
   - `handleRefine` should not appear in food-analyzer.tsx
7. Manual verification checklist:
   - [ ] CalorieRing shows red text when over goal
   - [ ] CalorieRing hides budget marker when at/over goal
   - [ ] MacroBars shows red labels when macro exceeds goal
   - [ ] HTML error page from proxy shows friendly error message
   - [ ] Initial analysis flow works unchanged (photo → analyze → result)
   - [ ] Quick log (tap Log without chatting) works unchanged
   - [ ] Chat input hint appears after analysis
   - [ ] Tapping hint opens FoodChat
   - [ ] Sending a message shows assistant response
   - [ ] Assistant can respond with just text (question/confirmation)
   - [ ] Assistant can respond with updated analysis
   - [ ] Log button in chat uses the latest analysis
   - [ ] Close button discards chat and returns to analysis view
   - [ ] New photos can be added mid-chat

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Server returns HTML error page | User sees "Server returned an unexpected response. Please try again." | Unit test (safe-json) + component test |
| Claude returns text-only (no tool_use) | Chat shows assistant message, no analysis update | Unit test (conversationalRefine) + route test |
| Claude API failure during chat | Chat shows error message, user can retry | Unit test + route test |
| Network failure during chat | Chat shows friendly error via safe-json | Component test |
| Rate limit exceeded on chat | 429 response shown as error | Route test |

## Risks & Open Questions

- [ ] FoodChat input bar with camera button — the existing `PhotoCapture` component is designed as a standalone capture flow, not an inline picker. May need to extract a simpler photo picker or use a separate button that opens the system file picker directly. The implementer should assess whether `PhotoCapture` can be configured for inline use or if a minimal wrapper is needed.
- [ ] Chat message history size — with many turns, the Anthropic API payload could grow large. Consider capping at ~20 messages or implementing a sliding window. This can be deferred to a follow-up issue if not a problem in practice.

## Scope Boundaries

**In Scope:**
- Safe JSON parse utility
- Multi-turn chat API endpoint
- FoodChat component with send, log, close, and camera
- Wiring FoodChat into FoodAnalyzer
- Deleting old single-shot refinement code
- CalorieRing + MacroBars over-goal visual indicators

**Out of Scope:**
- Chat message persistence (all ephemeral — explicitly stated in FOO-371)
- Meal splitting / Claude suggesting multiple food entries (ROADMAP.md feature, not in these issues)
- Contextual memory / querying past food logs (ROADMAP.md feature, not in these issues)
- Editing previously logged food entries via chat (ROADMAP.md feature, not in these issues)
- Service worker / offline support

---

## Iteration 1

**Implemented:** 2026-02-13
**Method:** Agent team (4 workers)

### Tasks Completed This Iteration
- Task 1: CalorieRing over-goal visual indicators (worker-1) — FOO-373
- Task 2: Safe JSON parse utility for fetch calls (worker-3) — FOO-369
- Task 3: Apply safe JSON parsing to FoodAnalyzer (worker-3) — FOO-369
- Task 4: ConversationMessage type and chat system prompt (worker-2) — FOO-370
- Task 5: conversationalRefine function (worker-2) — FOO-370
- Task 6: POST /api/chat-food endpoint (worker-2) — FOO-370
- Task 7: FoodChat component (worker-4) — FOO-371
- Task 8: Wire FoodChat into FoodAnalyzer (worker-3) — FOO-372
- Task 9: Delete old refinement code (worker-2) — FOO-372
- Task 10: Integration & Verification (lead) — all issues

### Files Modified
- `src/components/calorie-ring.tsx` — Budget marker hidden when at/over goal, text-destructive when over
- `src/components/__tests__/calorie-ring.test.tsx` — Added over-goal tests
- `src/components/macro-bars.tsx` — Labels turn text-destructive when macro exceeds goal
- `src/components/__tests__/macro-bars.test.tsx` — Added over-goal tests
- `src/lib/safe-json.ts` — Created safe JSON parse utility
- `src/lib/__tests__/safe-json.test.ts` — Created tests for safe-json
- `src/components/food-analyzer.tsx` — Replaced correction UI with FoodChat wiring, safe JSON parsing
- `src/components/__tests__/food-analyzer.test.tsx` — Updated for chat flow, safe JSON mocks
- `src/components/__tests__/food-analyzer-reconnect.test.tsx` — Updated mocks for safe JSON
- `src/components/__tests__/food-analyzer-reprompt.test.tsx` — Deleted (old correction UI)
- `src/types/index.ts` — Added ConversationMessage, ChatFoodResponse types
- `src/lib/claude.ts` — Added conversationalRefine(), CHAT_SYSTEM_PROMPT; deleted refineAnalysis()
- `src/lib/__tests__/claude.test.ts` — Added conversationalRefine tests; deleted refineAnalysis tests
- `src/app/api/chat-food/route.ts` — Created chat endpoint with auth, rate limiting, validation
- `src/app/api/chat-food/__tests__/route.test.ts` — Created chat endpoint tests
- `src/components/food-chat.tsx` — Created FoodChat component
- `src/components/__tests__/food-chat.test.tsx` — Created FoodChat tests
- `src/app/api/refine-food/route.ts` — Deleted
- `src/app/api/refine-food/__tests__/route.test.ts` — Deleted

### Linear Updates
- FOO-369: Todo → In Progress → Review
- FOO-370: Todo → In Progress → Review
- FOO-371: Todo → In Progress → Review
- FOO-372: Todo → In Progress → Review
- FOO-373: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 7 bugs (2 HIGH, 3 MEDIUM, 2 LOW), 4 critical bugs fixed before proceeding
- verifier: All 1594 tests pass, zero TS errors, zero lint warnings, clean build

### Work Partition
- Worker 1: Task 1 (calorie-ring, macro-bars files)
- Worker 2: Tasks 4, 5, 6, 9 (types, claude.ts, chat-food API, refine-food deletion)
- Worker 3: Tasks 2, 3, 8 (safe-json, food-analyzer files)
- Worker 4: Task 7 (food-chat component)

### Continuation Status
All tasks completed.

### Review Findings

Summary: 4 issue(s) found (Team: security, reliability, quality reviewers)
- HIGH: 2
- MEDIUM: 2 (documented only)

**Issues requiring fix:**
- [HIGH] SECURITY: Missing input array size limits in `/api/chat-food` (`src/app/api/chat-food/route.ts:37-78`) — messages and images arrays have no maximum size, enabling memory exhaustion or excessive API costs via a single malicious request
- [HIGH] SECURITY: Missing base64 image validation in `/api/chat-food` (`src/app/api/chat-food/route.ts:68-77`) — images accepted without validating base64 format, decoded size (MAX_IMAGE_SIZE), or total payload size

**Documented (no fix needed):**
- [MEDIUM] SECURITY: Missing message content length validation (`src/app/api/chat-food/route.ts:55-57`) — no per-message character limit; mitigated by auth (single-user app) + rate limiting + Claude API token limits
- [MEDIUM] CONVENTION: Dead state variable `logging` in food-analyzer (`src/components/food-analyzer.tsx:42`) — `useState(false)` with no setter, always false, referenced in multiple conditions with no effect; component uses `logResponse` for optimistic UI instead

### Linear Updates
- FOO-369: Review → Merge
- FOO-370: Review → Merge
- FOO-371: Review → Merge
- FOO-372: Review → Merge
- FOO-373: Review → Merge
- FOO-374: Created in Todo (Fix: input validation limits on chat-food endpoint)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [FOO-374](https://linear.app/lw-claude/issue/FOO-374/add-input-validation-limits-to-post-apichat-food-endpoint)

### Fix 1: Add input validation limits to POST /api/chat-food endpoint
**Linear Issue:** [FOO-374](https://linear.app/lw-claude/issue/FOO-374/add-input-validation-limits-to-post-apichat-food-endpoint)

1. Add tests to `src/app/api/chat-food/__tests__/route.test.ts`:
   - Test: returns 400 when messages array exceeds max size (e.g., 20 messages)
   - Test: returns 400 when images array exceeds MAX_IMAGES (9)
   - Test: returns 400 when base64 image string is not valid base64
   - Test: returns 400 when decoded image exceeds MAX_IMAGE_SIZE (10MB)
2. Modify `src/app/api/chat-food/route.ts`:
   - Import `MAX_IMAGES`, `MAX_IMAGE_SIZE` from `@/lib/image-validation`
   - Add `MAX_MESSAGES = 20` constant
   - Validate `messages.length <= MAX_MESSAGES`
   - Validate `images.length <= MAX_IMAGES` (when images provided)
   - Validate each image string is valid base64 format
   - Validate decoded image size <= MAX_IMAGE_SIZE

---

## Iteration 2

**Implemented:** 2026-02-13
**Method:** Single-agent (worker unresponsive, lead implemented directly)

### Tasks Completed This Iteration
- Fix 1: Add input validation limits to POST /api/chat-food endpoint (FOO-374)

### Files Modified
- `src/app/api/chat-food/route.ts` — Added MAX_MESSAGES (20), MAX_IMAGES, MAX_IMAGE_SIZE imports; messages array length validation; images count validation; base64 format validation; decoded image size validation
- `src/app/api/chat-food/__tests__/route.test.ts` — Added 6 tests: max messages exceeded, max images exceeded, invalid base64, oversized image, boundary tests for exactly MAX_MESSAGES and MAX_IMAGES

### Linear Updates
- FOO-374: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 1 HIGH (regex empty match — fixed), 2 MEDIUM (documented only)
- verifier: All 1598 tests pass, zero TS errors, zero lint warnings, clean build

### Continuation Status
All fix plan tasks completed.
