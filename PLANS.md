# Implementation Plan

**Created:** 2026-03-09
**Source:** Bug report: Claude API returns invalid confidence/keywords despite strict:true — coerce non-critical fields instead of throwing
**Linear Issues:** [FOO-862](https://linear.app/lw-claude/issue/FOO-862/bug-coerce-non-critical-fields-in-validatefoodanalysis-instead-of)
**Sentry Issues:** [FOOD-SCANNER-J](https://lucas-wall.sentry.io/issues/FOOD-SCANNER-J), [FOOD-SCANNER-H](https://lucas-wall.sentry.io/issues/FOOD-SCANNER-H)
**Branch:** fix/FOO-862-coerce-non-critical-validation

## Context Gathered

### Codebase Analysis
- **Related files:** `src/lib/claude.ts` (validateFoodAnalysis at line 380, tool loop catch at 1020-1031, fast path at 1294), `src/lib/__tests__/claude.test.ts` (existing throw tests at lines 543 and 564, notes coercion tests at 3339), `src/types/index.ts` (FoodAnalysis interface at line 55)
- **Existing patterns:** PR #111 established the coercion pattern for `notes` — changed from `throw if not string` to `default to ""` with no warning log. The `description` field at line 431 also uses the same coerce-to-empty-string pattern.
- **Test conventions:** Colocated tests in `src/lib/__tests__/claude.test.ts`. Each validation behavior has its own `describe` block with individual `it` cases. Tests use dynamic `import("@/lib/claude")` after mocking.

### MCP Context
- **MCPs used:** Sentry (issue search and details), Linear (issue creation)
- **Findings:** FOOD-SCANNER-J (invalid confidence) and FOOD-SCANNER-H (invalid keywords) — both from the same trace `ee145d9e...`, same user session on Chrome/Android, production release `47806e3`. Both were caught by the tool loop's try/catch at `claude.ts:1026-1031` and logged as warnings. The tool loop discarded both analyses and continued iterating, likely exhausting the 5-iteration limit.

### Investigation

**Bug report:** Claude API returns invalid `confidence` and `keywords` values in `report_nutrition` tool calls despite `strict: true` schema enforcement, causing `validateFoodAnalysis` to throw and discard otherwise-valid food analyses.

**Classification:** Integration Bug / Medium / Claude API validation (`src/lib/claude.ts`)

**Root cause:** The Anthropic API's `strict: true` constrained decoding guarantees schema conformance only when the response completes normally (`stop_reason: "tool_use"` or `"end_turn"`). When truncated at `max_tokens` (2048), partial JSON may violate the schema. The `report_nutrition` tool has 9 union-typed parameters (within the 16 limit), so the union limit is not the cause. This is a rare edge case — 1 occurrence total — but when it hits, the user gets no analysis because `validateFoodAnalysis` throws for fields that could safely be coerced.

**Evidence:**
- `src/lib/claude.ts:408-411` — confidence validation throws instead of coercing
- `src/lib/claude.ts:415-428` — keywords validation throws instead of coercing
- `src/lib/claude.ts:413` — `notes` already coerces (PR #111 precedent)
- `src/lib/claude.ts:431` — `description` already coerces (same pattern)
- `src/lib/claude.ts:1020-1031` — tool loop catches the throw and discards the analysis
- `src/lib/claude.ts:1148-1153` — after max iterations with no valid analysis, yields error to user
- `src/lib/__tests__/claude.test.ts:543` — test expects throw for invalid confidence (needs update)
- `src/lib/__tests__/claude.test.ts:564` — test expects throw for invalid keywords (needs update)

**Impact:** When Claude returns invalid confidence/keywords (rare API edge case), the user gets "Maximum tool iterations exceeded" error instead of a usable food analysis. The nutritional data may be perfectly valid — only the metadata fields are malformed.

## Tasks

### Task 1: Coerce `confidence` to "medium" when invalid
**Linear Issue:** [FOO-862](https://linear.app/lw-claude/issue/FOO-862/bug-coerce-non-critical-fields-in-validatefoodanalysis-instead-of)
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**
1. Update the existing test at line 543 (`"throws CLAUDE_API_ERROR when confidence is invalid"`) — rename to `"coerces invalid confidence to medium"` and change assertion from expecting a throw to expecting a successful result with `confidence: "medium"`
2. Add new tests in a `validateFoodAnalysis — confidence coercion` describe block:
   - `confidence: undefined` → coerces to `"medium"`
   - `confidence: "VERY_HIGH"` → coerces to `"medium"`
   - `confidence: 123` (non-string) → coerces to `"medium"`
   - `confidence: "high"` → keeps `"high"` (existing behavior preserved)
3. Run verifier with pattern `"confidence"` (expect fail — tests assert coercion but code still throws)
4. In `validateFoodAnalysis` at line 408-411: replace the throw with coercion — if confidence is not in the valid set, log a warning with `logger.warn({ action: "validation_coerce_confidence", received: data.confidence }, "coerced invalid confidence to medium")` and set confidence to `"medium"`
5. Run verifier with pattern `"confidence"` (expect pass)

**Notes:**
- Follow the exact pattern of `notes` coercion at line 413 — silent default, but add a warning log since confidence affects the UI indicator
- The `logger` import already exists in `claude.ts`

### Task 2: Coerce `keywords` when invalid
**Linear Issue:** [FOO-862](https://linear.app/lw-claude/issue/FOO-862/bug-coerce-non-critical-fields-in-validatefoodanalysis-instead-of)
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/claude.ts` (modify)

**Steps:**
1. Update the existing test at line 564 (`"throws CLAUDE_API_ERROR when keywords is not an array"`) — rename to `"coerces string keywords to array"` and change assertion from expecting a throw to expecting a successful result with `keywords: ["empanada"]`
2. Add new tests in a `validateFoodAnalysis — keywords coercion` describe block:
   - `keywords: "empanada"` (string) → coerces to `["empanada"]`
   - `keywords: "  Empanada  "` (string with whitespace/caps) → coerces to `["empanada"]` (normalizeKeywords applies)
   - `keywords: null` → derives from `food_name` by splitting on spaces, lowercasing, taking first 3 words
   - `keywords: undefined` → derives from `food_name`
   - `keywords: 123` (non-string, non-array) → derives from `food_name`
   - `keywords: []` (empty array) → derives from `food_name`
   - `keywords: [123, true]` (array of non-strings) → filters to strings only, falls back to `food_name` if none remain
   - `keywords: ["cerveza", "sin-alcohol"]` → keeps as-is (existing behavior preserved)
3. Run verifier with pattern `"keywords"` (expect fail)
4. In `validateFoodAnalysis` at lines 415-428: replace the throws with coercion logic:
   - If `data.keywords` is a string → wrap in array: `[data.keywords]`
   - If `data.keywords` is an array → filter to string elements only
   - If result is empty or `data.keywords` is missing/non-iterable → derive from `food_name`: split on whitespace, lowercase, take first 3 tokens, filter empty
   - Pass result through existing `normalizeKeywords()` at line 425
   - If `normalizeKeywords()` returns empty → use `[food_name.split(/\s+/)[0].toLowerCase()]` as absolute fallback (guaranteed non-empty since `food_name` is validated non-empty above)
   - Log warning: `logger.warn({ action: "validation_coerce_keywords", received: typeof data.keywords, foodName: data.food_name }, "coerced invalid keywords from food_name")`
5. Run verifier with pattern `"keywords"` (expect pass)

**Notes:**
- The `normalizeKeywords` function at line 366 already handles trimming, lowercasing, deduplication, and capping at 5 — reuse it for all coercion paths
- The `food_name` is guaranteed to be a non-empty string (validated at line 386) so deriving keywords from it is always safe

### Task 3: Resolve Sentry issues
**Linear Issue:** [FOO-862](https://linear.app/lw-claude/issue/FOO-862/bug-coerce-non-critical-fields-in-validatefoodanalysis-instead-of)

**Steps:**
1. After the fix is released to production, resolve FOOD-SCANNER-J and FOOD-SCANNER-H in Sentry
2. Include `Fixes FOOD-SCANNER-J` and `Fixes FOOD-SCANNER-H` in the commit message to auto-resolve on merge

**Notes:**
- This is a post-release task — the Sentry issues will auto-resolve if the commit message contains the fix references

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Coerce non-critical fields (`confidence`, `keywords`) in `validateFoodAnalysis` instead of throwing, so rare Claude API schema violations don't discard otherwise-valid food analyses.
**Linear Issues:** FOO-862
**Approach:** Follow the precedent set by PR #111 (`notes` coercion) — replace throws with safe defaults + warning logs. `confidence` defaults to `"medium"`, `keywords` coerces from string or derives from `food_name`. Critical nutritional fields keep strict validation. Update 2 existing tests and add coercion test suites. Include Sentry fix references in commit message.
**Scope:** 3 tasks, 2 files, ~10 tests
**Key Decisions:** Coerce over throw for non-critical metadata fields (confidence is a UI indicator, keywords are for search matching). Critical nutritional fields (`food_name`, `calories`, macros) remain strict — no regression risk there.
**Risks:** None identified. Pattern is proven (PR #111), downstream consumers accept coerced values, and the change is backward-compatible.

---

## Iteration 1

**Implemented:** 2026-03-09
**Method:** Single-agent (1 work unit, effort score 4)

### Tasks Completed This Iteration
- Task 1: Coerce `confidence` to "medium" when invalid — replaced throw with coercion + warning log, updated existing throw test to expect coercion, added 4 coercion tests
- Task 2: Coerce `keywords` when invalid — replaced throws with coercion logic (string wrap, array filter, food_name derivation), updated existing throw test to expect coercion, added 8 coercion tests
- Task 3: Sentry resolution — post-release task, commit message includes fix references

### Files Modified
- `src/lib/claude.ts` — replaced confidence throw with coercion to "medium" + warn log; replaced keywords throws with coercion logic (string→array, filter non-strings, derive from food_name) + warn log
- `src/lib/__tests__/claude.test.ts` — updated 2 existing throw tests to expect coercion; added "confidence coercion" describe block (4 tests) and "keywords coercion" describe block (8 tests)
- `src/app/api/chat-food/__tests__/route.test.ts` — updated "returns 400 when initialAnalysis has invalid confidence" test to expect 200 (coercion instead of rejection)

### Linear Updates
- FOO-862: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Passed — no bugs found
- verifier: All 2666 tests pass, zero lint warnings, build clean

### Continuation Status
All tasks completed.
