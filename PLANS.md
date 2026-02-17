# Fix Plan: Chat model hallucinates food registration without calling report_nutrition

**Issue:** FOO-555
**Date:** 2026-02-16
**Status:** COMPLETE
**Branch:** fix/FOO-555-chat-hallucinated-registration

## Investigation

### Bug Report
In the chat-food conversation, when user says "Si es barra, pero ahora comí dos" (referring to CRUDDA Brownie from yesterday's log), Claude responds "Perfecto, registré 2 barras CRUDDA Brownie" — claiming it registered the food. But `hasAnalysis=false` in every response. The `report_nutrition` tool was never called. Claude also asked "which meal type?" even though `report_nutrition` has no meal_type parameter. When user explicitly said "Registra las barras", Claude insisted they were "already registered."

### Classification
- **Type:** Integration (AI prompt/behavior issue)
- **Severity:** High (food logging is the core feature — users lose trust when the model lies about registering)
- **Affected Area:** `CHAT_SYSTEM_PROMPT` in `src/lib/claude.ts` and `ANALYSIS_SYSTEM_PROMPT`

### Root Cause Analysis
The `CHAT_SYSTEM_PROMPT` (lines 31-61 of `src/lib/claude.ts`) lacks critical guardrails:

1. **No instruction that "registering" requires calling `report_nutrition`.** Line 45 says "When the user describes or shows food, analyze it and call report_nutrition" — but after a `search_food_log` lookup + user reference ("es barra, comí dos"), the model doesn't treat this as "describing food." It thinks the lookup itself was enough.

2. **No prohibition against claiming registration without tool use.** The model can say "registré" in text without any mechanism verifying `report_nutrition` was called.

3. **No instruction about meal types.** The model asked "which meal type?" before logging, but `report_nutrition` has no `meal_type` parameter (line 68-146). Meal assignment happens in the frontend UI. This unnecessary question blocked the tool call entirely.

4. **Ambiguous "re-log from history" flow.** When user references food from a history lookup and says they want to log it, the system prompt doesn't cover this case. Line 45 only mentions "describes or shows food" — referencing a past entry doesn't clearly match either trigger.

#### Evidence
- **File:** `src/lib/claude.ts:31-61` — `CHAT_SYSTEM_PROMPT` missing guardrails
- **File:** `src/lib/claude.ts:68-146` — `REPORT_NUTRITION_TOOL` has no `meal_type` parameter
- **File:** `src/lib/claude.ts:332-346` — `ANALYSIS_SYSTEM_PROMPT` has the same gap (less likely to trigger since analyze-food transitions to chat, but should be consistent)
- **Logs:** Staging deployment 2026-02-17 ~00:46-00:47 UTC, requestIds: `96faf10c`, `e6ef804f`, `7a9060c5`, `dc5c5480`, `670cf2ae`
- **Conversation:** 5 messages, all returned `hasAnalysis=false` / `blockTypes=["text"]` — zero `report_nutrition` calls

### Impact
- Users think food is logged when it isn't — data loss
- Trust broken when repeated "register" commands are ignored
- Core food logging workflow broken for the "re-log from history" use case

## Fix Plan (TDD Approach)

### Step 1: Add tests for system prompt guardrails

**File:** `src/lib/__tests__/claude.test.ts` (modify)
**Pattern:** Follow the existing `CHAT_SYSTEM_PROMPT web search guidance` describe block (line 3334)

**Tests:**
1. `CHAT_SYSTEM_PROMPT` contains instruction that `report_nutrition` must be called to actually register/log food (assert prompt matches a pattern about never claiming registration without calling the tool)
2. `CHAT_SYSTEM_PROMPT` contains instruction not to ask about meal types (assert prompt mentions meal type is handled by the UI / not a parameter of report_nutrition)
3. `CHAT_SYSTEM_PROMPT` contains instruction for re-logging food from history (assert prompt mentions that when user references past food and wants to log it, call report_nutrition)
4. `ANALYSIS_SYSTEM_PROMPT` — same test for the registration guardrail (export it or test via the `analyzeFood` function's system prompt construction)

### Step 2: Update CHAT_SYSTEM_PROMPT with guardrails

**File:** `src/lib/claude.ts` (modify — lines 31-61)

**Behavior:**
Add three new rules to the `CHAT_SYSTEM_PROMPT` "Follow these rules:" section:

1. **Registration integrity rule:** Add a rule after line 45 that explicitly states: food is ONLY registered/logged when `report_nutrition` is called. Never say food is "registered", "logged", or "recorded" in text without having called `report_nutrition` in that turn. If `report_nutrition` hasn't been called, the food has NOT been logged.

2. **Re-log from history rule:** Add a rule that when the user references food from their history (via `search_food_log` results) and indicates they want to log it again (e.g., "comí eso", "registra eso", "quiero lo mismo"), immediately call `report_nutrition` with the nutritional data from the history lookup. Do not ask for confirmation — the user's intent is clear.

3. **No meal type questions rule:** Add a rule that `report_nutrition` does not accept a meal type parameter — meal assignment is handled by the user in the app UI. Never ask which meal type before calling `report_nutrition`. Just call the tool and let the user assign the meal type afterward.

### Step 3: Update ANALYSIS_SYSTEM_PROMPT with consistent guardrails

**File:** `src/lib/claude.ts` (modify — lines 332-346)

**Behavior:**
Add the same registration integrity rule to `ANALYSIS_SYSTEM_PROMPT`. The re-log and meal-type rules are less critical here since this prompt is for initial analysis, but the registration integrity rule should be universal.

### Step 4: Verify

- [ ] All new tests pass
- [ ] All existing tests pass (especially the existing CHAT_SYSTEM_PROMPT tests)
- [ ] TypeScript compiles without errors
- [ ] Lint passes
- [ ] Build succeeds

## Notes
- This is a prompt engineering fix — no code logic changes needed, only system prompt text
- The `report_nutrition` tool and `runToolLoop()` code path work correctly (confirmed by many other conversations). The model simply chose not to call the tool.
- The `ANALYSIS_SYSTEM_PROMPT` has a similar gap but is less likely to trigger because `analyzeFood` transitions to chat mode for ambiguous requests. Still worth fixing for consistency.
- Testing prompt content via string matching is the established pattern in this codebase (see `CHAT_SYSTEM_PROMPT web search guidance` tests at line 3334)

---

## Iteration 1

**Implemented:** 2026-02-16
**Method:** Single-agent (fly solo)

### Tasks Completed This Iteration
- Step 1: Add tests for system prompt guardrails — 4 new tests for registration integrity, meal type, re-log from history, and ANALYSIS_SYSTEM_PROMPT
- Step 2: Update CHAT_SYSTEM_PROMPT with guardrails — 3 new rules added (registration integrity, re-log from history, no meal type questions)
- Step 3: Update ANALYSIS_SYSTEM_PROMPT with consistent guardrails — registration integrity rule added, exported for testing
- Step 4: Verify — all tests pass, lint clean, build succeeds

### Files Modified
- `src/lib/claude.ts` — Added 3 guardrail rules to CHAT_SYSTEM_PROMPT, 1 to ANALYSIS_SYSTEM_PROMPT, exported ANALYSIS_SYSTEM_PROMPT
- `src/lib/__tests__/claude.test.ts` — Added 4 new tests for prompt guardrail content

### Linear Updates
- FOO-555: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed — no bugs found
- verifier: All 1841 tests pass, zero warnings

### Review Findings

Files reviewed: 2
Reviewers: single-agent (security, reliability, quality checks)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found - all implementations are correct and follow project conventions.

### Linear Updates
- FOO-555: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully. All Linear issues moved to Merge.
