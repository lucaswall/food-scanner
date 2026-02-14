# Implementation Plan

**Status:** COMPLETE
**Branch:** feat/FOO-436-refinement-chat-fixes
**Issues:** FOO-436, FOO-437, FOO-438, FOO-435
**Created:** 2026-02-14
**Last Updated:** 2026-02-14

## Summary

Fix 4 bugs across the refinement chat and Lumen banner. Three issues affect the refinement chat conversation quality — stale baseline values, lost tool_use context, and incomplete unit labels — causing Claude to produce incorrect or inconsistent nutrition updates across turns. One CSS variable issue makes the Lumen banner text invisible in light mode.

## Issues

### FOO-435: Lumen banner text invisible in light mode

**Priority:** Medium | **Labels:** Bug
**Description:** The `--info-foreground` CSS variable in `:root` (light mode) is `oklch(0.985 0 0)` (near-white), identical to the dark mode value. Combined with `bg-info/10` on a white background, both `text-info-foreground` spans in `lumen-banner.tsx` are invisible. The `--warning-foreground` variable handles this correctly — dark value in light mode, light value in dark mode.

**Acceptance Criteria:**
- [ ] Lumen banner text is readable in light mode
- [ ] Lumen banner text remains readable in dark mode
- [ ] No other components using `text-info-foreground` are broken

### FOO-438: Refinement chat system prompt shows "units" for non-gram/ml unit types

**Priority:** Low | **Labels:** Bug
**Description:** In `src/lib/claude.ts` line 386, the unit label ternary only handles `unit_id === 147` (g) and `unit_id === 209` (ml). All other valid unit IDs (cups=91, oz=226, slices=311, servings=304, tbsp=349, tsp=364) fall through to the meaningless string "units". The project already has `getUnitById()` in `src/types/index.ts` that maps unit IDs to their labels.

**Acceptance Criteria:**
- [ ] System prompt shows correct unit label for all supported unit IDs (g, ml, cup, oz, tbsp, tsp, slice, serving)
- [ ] Unknown unit IDs still fall back to "units"
- [ ] Reuses existing `getUnitById()` from `src/types/index.ts` (no duplicate map)

### FOO-436: Refinement chat sends stale initial analysis on every turn

**Priority:** High | **Labels:** Bug
**Description:** In `food-chat.tsx`, the request body at line 226 always sends the original `initialAnalysis` prop. The component already computes `latestAnalysis` (line 77-80) by finding the most recent message with an analysis, but this value is only used for the "Log to Fitbit" button — never sent to the API. This causes Claude to see stale baseline values in the system prompt, potentially reverting corrections.

**Acceptance Criteria:**
- [ ] Each chat turn sends the most recent analysis (from the latest assistant message with an analysis) to the API
- [ ] First turn still sends the original `initialAnalysis` (no prior refinements exist)
- [ ] The "Log to Fitbit" button still uses the latest analysis (existing behavior, should not break)

### FOO-437: Refinement chat loses tool_use context between turns

**Priority:** High | **Labels:** Bug
**Description:** When `conversationalRefine()` converts `ConversationMessage[]` to Anthropic message format (lines 350-381), it only extracts `msg.content` (text) and ignores `msg.analysis`. This means Claude cannot see its own previous `report_nutrition` tool calls or the exact numerical values it reported. Over multiple turns, Claude loses track of the current nutritional state and produces inconsistent values. The `analysis` field IS present on `ConversationMessage` and IS sent by the client — it's just ignored during message conversion.

**Acceptance Criteria:**
- [ ] Assistant messages that have an `analysis` field include a structured summary of the nutritional values in the Anthropic conversation history
- [ ] Claude can see the exact numerical values from its previous tool calls
- [ ] The format is concise (not wasteful with tokens) but includes all key nutritional fields
- [ ] Messages without `analysis` are unaffected

## Prerequisites

- [ ] On `main` branch with clean working tree
- [ ] `npm test` passes before starting

## Implementation Tasks

### Task 1: Fix light mode `--info-foreground` CSS variable

**Issue:** FOO-435
**Files:**
- `src/app/globals.css` (modify)
- `src/components/__tests__/lumen-banner.test.tsx` (modify — add visibility assertion)

**TDD Steps:**

1. **RED** — Add a test in `lumen-banner.test.tsx` that renders the banner in the "no goals" state and asserts that the text elements do NOT use a near-white color class that would be invisible on a white background. This test will rely on checking the rendered class names include `text-info-foreground`, which is already the case — the real fix is the CSS variable value. Since CSS variables aren't computed in jsdom, the test should verify the banner renders the expected text content visibly (already covered by existing "shows banner when SWR returns error" test). Skip adding a new test — this is a CSS-only fix verifiable by visual inspection and the existing tests.

2. **GREEN** — In `src/app/globals.css` `:root` block (line 79), change `--info-foreground` from `oklch(0.985 0 0)` to `oklch(0.205 0 0)` (dark text for light backgrounds — same pattern as `--warning-foreground` on line 77).

3. **REFACTOR** — Verify no other components use `text-info-foreground` (already confirmed — only `lumen-banner.tsx`). Run the existing `lumen-banner.test.tsx` tests to ensure nothing breaks.

**Notes:**
- Follow the pattern of `--warning-foreground` which uses `oklch(0.205 0 0)` in light mode
- The dark mode `.dark` block (line 120) already has `--info-foreground: oklch(0.985 0 0)` which is correct (light text on dark background)
- Only `src/components/lumen-banner.tsx` lines 100 and 103 use `text-info-foreground`

### Task 2: Use `getUnitById()` for system prompt unit label

**Issue:** FOO-438
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests in the `conversationalRefine` describe block:
   - Test that the system prompt contains "cup" (not "units") when `initialAnalysis.unit_id` is 91
   - Test that the system prompt contains "oz" when `initialAnalysis.unit_id` is 226
   - Test that the system prompt falls back to "units" for an unknown unit_id (e.g., 999)
   - Run: `npm test -- claude.test`
   - Verify: Tests fail because the current code only handles 147 and 209

2. **GREEN** — In `src/lib/claude.ts`:
   - Import `getUnitById` from `@/types`
   - Replace the ternary on line 386 with a call to `getUnitById(initialAnalysis.unit_id)` — use `unit.name` if found, fall back to "units"
   - Run: `npm test -- claude.test`
   - Verify: All tests pass

3. **REFACTOR** — Remove the now-unnecessary inline ternary. The import of `getUnitById` is the only change needed.

**Notes:**
- `getUnitById()` is defined at `src/types/index.ts:40-45` and returns `{ id, name, plural }` or `undefined`
- The `name` field (e.g., "g", "cup", "oz") is suitable for the system prompt label
- Existing test at line 1345 ("includes initial analysis context in system prompt when provided") uses `validAnalysis` which has `unit_id: 147` — it will still pass since `getUnitById(147)` returns `{ name: "g" }`

### Task 3: Send latest analysis instead of stale initial analysis

**Issue:** FOO-436
**Files:**
- `src/components/food-chat.tsx` (modify)
- `src/components/__tests__/food-chat.test.tsx` (modify)

**TDD Steps:**

1. **RED** — Add a test in `food-chat.test.tsx`:
   - Render `FoodChat` with `initialAnalysis` (100 cal)
   - Send a user message and mock the API response with an updated analysis (200 cal)
   - Send a second user message
   - Assert that the second `fetch` call's request body contains `initialAnalysis` with 200 cal (the updated value from the first response), NOT 100 cal
   - Run: `npm test -- food-chat.test`
   - Verify: Test fails because `initialAnalysis` always sends the original prop value

2. **GREEN** — In `src/components/food-chat.tsx` `handleSend()`:
   - Change line 226 from `initialAnalysis,` to `initialAnalysis: latestAnalysis,`
   - This uses the already-computed `latestAnalysis` (line 77-80) which tracks the most recent analysis from messages
   - Run: `npm test -- food-chat.test`
   - Verify: Test passes

3. **REFACTOR** — No refactoring needed — the change is minimal and `latestAnalysis` already exists.

**Notes:**
- `latestAnalysis` at line 77-80 walks the messages array in reverse to find the most recent `analysis` field, falling back to `initialAnalysis`
- On the first turn (before any refinement), `latestAnalysis === initialAnalysis` so behavior is unchanged
- The "Log to Fitbit" button already uses `latestAnalysis` (line 289) — this is existing correct behavior
- Existing tests that mock a single turn with `initialAnalysis` should still pass because `latestAnalysis` equals `initialAnalysis` before any responses

### Task 4: Include analysis context in conversation history

**Issue:** FOO-437
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**TDD Steps:**

1. **RED** — Add tests in the `conversationalRefine` describe block:
   - Test: when an assistant message has an `analysis` field, the corresponding Anthropic message's text content includes a structured summary with the nutritional values (food name, amount, unit, calories, macros)
   - Test: when an assistant message has NO `analysis` field, the Anthropic message only contains the original text content
   - Test: verify the summary format includes key fields (food_name, amount, calories, protein_g, carbs_g, fat_g) so Claude can reference exact values
   - Run: `npm test -- claude.test`
   - Verify: Tests fail because the current code ignores the `analysis` field

2. **GREEN** — In `src/lib/claude.ts` `conversationalRefine()`, in the message mapping (line 350-381):
   - After adding the text content block (line 372-375), check if `msg.analysis` exists
   - If it does, append a second text block with a structured summary, e.g.: `[Current values: {food_name}, {amount}{unitLabel}, {calories} cal, P:{protein_g}g C:{carbs_g}g F:{fat_g}g Fiber:{fiber_g}g Na:{sodium_mg}mg | Conf: {confidence}]`
   - Use `getUnitById` (already imported in Task 2) for the unit label
   - Run: `npm test -- claude.test`
   - Verify: Tests pass

3. **REFACTOR** — Consider extracting the summary formatting to a small helper function if the inline code is long. Keep the format compact to minimize token usage.

**Notes:**
- The `ConversationMessage` type (`src/types/index.ts:384-388`) already includes `analysis?: FoodAnalysis`
- The client sends `analysis` on assistant messages — see `food-chat.tsx` lines 259-263
- The API route (`chat-food/route.ts`) doesn't validate/strip `analysis` — it passes through via the `ConversationMessage[]` cast at line 66
- Use bracket notation `[Current values: ...]` to clearly delineate the injected context from Claude's natural text
- Only add the summary to assistant messages that have an `analysis` — user messages never have analysis
- Include Tier 1 nutrients (saturated_fat_g, trans_fat_g, sugars_g, calories_from_fat) only if they're not null, to keep the summary compact

### Task 5: Integration & Verification

**Issue:** FOO-435, FOO-436, FOO-437, FOO-438
**Files:** Various files from previous tasks

**Steps:**

1. Run full test suite: `npm test`
2. Run linter: `npm run lint`
3. Run type checker: `npm run typecheck`
4. Run build: `npm run build`
5. Manual verification:
   - [ ] Confirm `globals.css` `:root` has `--info-foreground: oklch(0.205 0 0)`
   - [ ] Confirm `claude.ts` uses `getUnitById()` for unit labels
   - [ ] Confirm `food-chat.tsx` sends `latestAnalysis` not `initialAnalysis`
   - [ ] Confirm `conversationalRefine()` includes analysis summaries in assistant messages

## MCP Usage During Implementation

| MCP Server | Tool | Purpose |
|------------|------|---------|
| Linear | `update_issue` | Move issues to "In Progress" when starting, "Done" when complete |

## Error Handling

| Error Scenario | Expected Behavior | Test Coverage |
|---------------|-------------------|---------------|
| Unknown unit_id in system prompt | Falls back to "units" string | Unit test (Task 2) |
| No analysis on assistant message | Text-only content, no summary appended | Unit test (Task 4) |
| First chat turn (no prior refinement) | `latestAnalysis` equals `initialAnalysis`, same behavior as before | Unit test (Task 3) |

## Risks & Open Questions

- [ ] The analysis summary injected into assistant messages uses tokens. Format should be compact (single line, abbreviated labels) to minimize overhead. Estimated ~30 tokens per summary vs. ~2000 token context window.
- [ ] The `analysis` field on `ConversationMessage` passes through the API route without explicit validation (line 66 is a type cast). This is acceptable since it's our own client sending the data and the field is optional.

## Scope Boundaries

**In Scope:**
- Fix `--info-foreground` CSS variable in light mode
- Fix unit label in refinement system prompt
- Send latest analysis to API on each chat turn
- Include analysis context in conversation history for Claude

**Out of Scope:**
- Reconstructing full tool_use/tool_result Anthropic API pairs (Option B from FOO-437 — too complex, Option A achieves the same goal)
- Adding Tier 1 nutrients to the system prompt baseline (system prompt already shows core macros; Tier 1 can be added later if needed)
- Refactoring the conversation message format or API contract

---

## Iteration 1

**Implemented:** 2026-02-14
**Method:** Single-agent (no team requested)

### Tasks Completed This Iteration
- Task 1: Fix light mode `--info-foreground` CSS variable (FOO-435) - Changed `:root` `--info-foreground` from near-white to dark text color
- Task 2: Use `getUnitById()` for system prompt unit label (FOO-438) - Replaced hardcoded ternary with `getUnitLabel()` call
- Task 3: Send latest analysis instead of stale initial analysis (FOO-436) - Changed `initialAnalysis` to `latestAnalysis` in request body
- Task 4: Include analysis context in conversation history (FOO-437) - Appended structured `[Current values: ...]` summary to assistant messages with analysis
- Task 5: Integration & Verification - Full test suite, lint, typecheck, build all pass

### Files Modified
- `src/app/globals.css` - Fixed `--info-foreground` in `:root` from `oklch(0.985 0 0)` to `oklch(0.205 0 0)`
- `src/lib/claude.ts` - Imported `getUnitLabel`, used it for system prompt amount label and analysis summary; added structured analysis summary injection in `conversationalRefine()`
- `src/components/food-chat.tsx` - Changed `initialAnalysis` to `latestAnalysis` in chat request body
- `src/lib/__tests__/claude.test.ts` - Added 6 tests: unit label (cup, oz, unknown fallback), analysis summary (with/without analysis, key fields)
- `src/components/__tests__/food-chat.test.tsx` - Added 1 test: second turn sends updated analysis not stale initial

### Linear Updates
- FOO-435: Todo → In Progress → Review
- FOO-436: Todo → In Progress → Review
- FOO-437: Todo → In Progress → Review
- FOO-438: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 2 medium bugs (inconsistent unit formatting), fixed before proceeding
- verifier: All 1675 tests pass, zero warnings

### Review Findings

Summary: 0 critical/high issues found (Team: security, reliability, quality reviewers)
- CRITICAL: 0
- HIGH: 0
- MEDIUM: 0
- LOW: 1

**Documented (no fix needed):**
- [LOW] ASYNC: FileReader event handlers in `blobsToBase64` (`src/components/food-chat.tsx:184-198`) are not explicitly cleaned up on unmount. Short-lived operation (<1s), unlikely to cause issues in practice.

### Linear Updates
- FOO-435: Review → Merge
- FOO-436: Review → Merge
- FOO-437: Review → Merge
- FOO-438: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Skipped Findings Summary

Findings documented but not fixed across all review iterations:

| Severity | Category | File | Finding | Rationale |
|----------|----------|------|---------|-----------|
| LOW | ASYNC | `src/components/food-chat.tsx:184-198` | FileReader handlers not cleaned up on unmount | Short-lived operation (<1s), standard React pattern |

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
