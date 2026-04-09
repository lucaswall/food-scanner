# Implementation Plan

**Created:** 2026-04-09
**Source:** Backlog: FOO-931, FOO-932, FOO-934, FOO-937, FOO-942, FOO-943
**Linear Issues:** [FOO-931](https://linear.app/lw-claude/issue/FOO-931), [FOO-932](https://linear.app/lw-claude/issue/FOO-932), [FOO-934](https://linear.app/lw-claude/issue/FOO-934), [FOO-937](https://linear.app/lw-claude/issue/FOO-937), [FOO-942](https://linear.app/lw-claude/issue/FOO-942), [FOO-943](https://linear.app/lw-claude/issue/FOO-943)
**Branch:** fix/code-audit-fixes

## Context Gathered

### Codebase Analysis
- **Related files:**
  - `src/lib/__tests__/claude.test.ts` — test file with contradictory strict:true assertions at lines 2895-2903
  - `src/lib/__tests__/chat-tools.test.ts` — correct non-strict assertions at lines 111, 138, 152
  - `src/lib/rate-limit.ts` — 47-line module, in-memory Map with cleanup only on size threshold
  - `src/app/api/log-food/route.ts:295` — fire-and-forget `updateCustomFoodMetadata` call
  - `src/lib/claude.ts:14` — `CLAUDE_MODEL = "claude-sonnet-4-6"` alias
  - `src/lib/sse.ts:44,46` — warn/error log calls missing `action` field
  - `src/app/api/saved-analyses/route.ts:38-55` — partial FoodAnalysis validation
  - `src/lib/saved-analyses.ts` — retrieves with `row.foodAnalysis as unknown as FoodAnalysis`
- **Existing patterns:**
  - Rate limiter: simple Map store, no external dependencies
  - Logging: all server-side modules use pino `logger` with `{ action: "xxx" }` structured fields
  - API validation: inline type guards (e.g., `isValidPostRequest` in api-keys/route.ts)
  - Test conventions: colocated `__tests__/` directories, Vitest, `vi.mock` for db/logger
- **Test conventions:**
  - `npx vitest run "pattern"` for targeted test runs
  - Tests import directly from source modules
  - `afterEach(() => { vi.resetModules(); })` pattern used in claude.test.ts

### MCP Context
- **MCPs used:** Linear (issue tracking)
- **Findings:** No existing Backlog issues — fresh audit. 8 of 14 audit issues canceled during triage.

### Triage Results

**Planned:** FOO-931, FOO-932, FOO-934, FOO-937, FOO-942, FOO-943

**Canceled:**
- FOO-933 — Single-user app; API key mgmt only accessible to authorized user
- FOO-935 — No transaction; single INSERT...RETURNING with defensive guard
- FOO-936 — MAX_MESSAGES=30 IS enforced (atLimit check at food-chat.tsx:162)
- FOO-938 — API key validation is SQL-based (WHERE keyHash=?), not JS ===
- FOO-939 — Single-user app; one-time-use OAuth state tokens
- FOO-940 — Single-user app; user configures own Fitbit credentials
- FOO-941 — No console.log found in current codebase
- FOO-944 — Wrong file cited; invalidateFoodCaches not in daily-dashboard.tsx

## Scope Boundaries

**In Scope:** 6 surgical fixes from code audit findings. All are small, independent changes.

**Out of Scope:** The 8 canceled issues listed above. Also out of scope: npm audit dependency vulnerabilities (serialize-javascript, rollup) — these are transitive dev dependencies and should be addressed via `npm audit fix` separately.

## Tasks

### Task 1: Remove contradictory strict:true test assertions
**Linear Issue:** [FOO-931](https://linear.app/lw-claude/issue/FOO-931)
**Effort:** S
**Files:**
- `src/lib/__tests__/claude.test.ts` (modify)

**Steps:**
1. **RED**: The test at lines 2895-2903 currently asserts `SEARCH_FOOD_LOG_TOOL.strict`, `GET_NUTRITION_SUMMARY_TOOL.strict`, and `GET_FASTING_INFO_TOOL.strict` are all `true`. These tools intentionally omit `strict` to stay under the 16 union-typed parameter API limit. Run `npx vitest run "claude.test"` — the test at line 2900-2902 should currently be failing (or is passing because the tools happen to have strict — verify which).
2. **GREEN**: Remove the three assertions for `SEARCH_FOOD_LOG_TOOL.strict`, `GET_NUTRITION_SUMMARY_TOOL.strict`, and `GET_FASTING_INFO_TOOL.strict` from the "all tool definitions have strict: true" test (lines 2900-2902). Keep the `REPORT_NUTRITION_TOOL.strict` assertion (line 2899) — that tool correctly has `strict: true`. If the test block becomes trivially duplicative of the earlier "has strict: true" test for REPORT_NUTRITION_TOOL at line 2754-2756, remove the entire describe block at lines 2892-2904 to avoid duplication.
3. **VERIFY**: Run `npx vitest run "claude.test"` — all tests pass. Run `npx vitest run "chat-tools.test"` — the correct non-strict assertions at lines 111, 138, 152 still pass.

**Notes:**
- The correct behavior is already asserted in `chat-tools.test.ts` — this task only removes the contradictory assertions.
- This has caused production incidents twice before (PR #90 and PR #113).

---

### Task 2: Fix rate limiter unbounded memory growth
**Linear Issue:** [FOO-932](https://linear.app/lw-claude/issue/FOO-932)
**Effort:** M
**Files:**
- `src/lib/rate-limit.ts` (modify)
- `src/lib/__tests__/rate-limit.test.ts` (create)

**Steps:**
1. **RED**: Create `src/lib/__tests__/rate-limit.test.ts`. Write tests for:
   - Basic rate limiting works (allow up to maxRequests, deny after)
   - Expired entries are cleaned up when cleanup runs
   - **Edge case**: When store reaches MAX_STORE_SIZE and all entries are still active (not expired), new entries beyond the cap should still be handled — either by evicting oldest entries or by enforcing a hard cap that rejects/overwrites
   - **Edge case**: Under low traffic, expired entries should eventually be cleaned up (not accumulate indefinitely)
   - Run `npx vitest run "rate-limit"` — new tests fail (no test file exists yet for rate-limit.ts).
2. **GREEN**: Modify `src/lib/rate-limit.ts`:
   - Add periodic cleanup: every N calls to `checkRateLimit` (e.g., every 100 calls), run `cleanExpiredEntries` regardless of store size
   - Add hard cap enforcement: after cleanup, if `store.size` still exceeds `MAX_STORE_SIZE`, evict oldest entries (by `resetAt` timestamp) until under the cap
   - The cleanup counter can be a module-level variable incremented on each `checkRateLimit` call
3. **REFACTOR**: Ensure `cleanExpiredEntries` is efficient — the current loop iteration is O(n) which is acceptable for MAX_STORE_SIZE=1000.
4. **VERIFY**: Run `npx vitest run "rate-limit"` — all tests pass.

**Notes:**
- Keep it simple — no external dependencies, no LRU library. A periodic sweep + hard cap is sufficient for this single-user app.
- Follow the existing module structure: no classes, just exported functions and module-level state.

---

### Task 3: Add timeout to fire-and-forget updateCustomFoodMetadata
**Linear Issue:** [FOO-934](https://linear.app/lw-claude/issue/FOO-934)
**Effort:** S
**Files:**
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/log-food/__tests__/route.test.ts` (modify — if exists; otherwise skip test for this surgical fix)

**Steps:**
1. **RED**: Write a test (or verify existing test coverage) that the fire-and-forget `updateCustomFoodMetadata` call at line 295 has a timeout. If no test file exists for this route, the change is small enough (wrapping in `Promise.race`) that manual verification is acceptable.
2. **GREEN**: At line 295 of `log-food/route.ts`, wrap the fire-and-forget call in `Promise.race` with a timeout of 5000ms. Replace:
   ```
   updateCustomFoodMetadata(...).catch(...)
   ```
   with a `Promise.race` between the metadata update and a timeout that resolves after 5s. Log a warning on timeout via the existing `log` logger with `{ action: "update_custom_food_metadata_timeout" }`.
3. **VERIFY**: Run `npx vitest run "log-food"` if test file exists, otherwise `npm run typecheck` to verify no type errors.

**Notes:**
- This is a non-blocking "nice-to-have" metadata update — the food log entry is already saved. Timeout is a safety net, not a correctness requirement.
- 5000ms is generous; the DB call should complete in <100ms under normal conditions.

---

### Task 4: Pin Claude model to snapshot ID
**Linear Issue:** [FOO-937](https://linear.app/lw-claude/issue/FOO-937)
**Effort:** S
**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)

**Steps:**
1. **RED**: Check if any existing test asserts the exact value of `CLAUDE_MODEL`. If yes, update the expected value. If no test exists for this constant, add one in `claude.test.ts` that asserts `CLAUDE_MODEL` matches the pattern of a pinned snapshot ID (contains a date suffix like `YYYYMMDD`).
2. **GREEN**: At `src/lib/claude.ts:14`, change `"claude-sonnet-4-6"` to the current pinned snapshot ID. The latest Sonnet 4.6 snapshot is `"claude-sonnet-4-6-20250514"`. Add a brief comment documenting the pin date.
3. **VERIFY**: Run `npx vitest run "claude.test"` — all tests pass.

**Notes:**
- Compare with `src/lib/lumen.ts:116` which correctly pins to `"claude-haiku-4-5-20251001"` as a pattern reference.
- The pinned ID prevents behavioral drift in food analysis when Anthropic updates the alias target.

---

### Task 5: Add action field to SSE log statements
**Linear Issue:** [FOO-942](https://linear.app/lw-claude/issue/FOO-942)
**Effort:** S
**Files:**
- `src/lib/sse.ts` (modify)

**Steps:**
1. **RED**: No existing test for SSE log formatting. The change is trivial (adding a field to a structured log call), so no new test needed.
2. **GREEN**: At `src/lib/sse.ts:44`, change `logger.warn({ err }, "SSE client disconnected during streaming")` to `logger.warn({ action: "sse_client_disconnect", err }, "SSE client disconnected during streaming")`. At line 46, change `logger.error({ err }, "SSE generator threw an unexpected error")` to `logger.error({ action: "sse_stream_error", err }, "SSE generator threw an unexpected error")`.
3. **VERIFY**: Run `npm run typecheck` — no type errors.

**Notes:**
- Convention requires every log statement to include `action` for searchability and filtering.
- Follow the `{ action: "snake_case_name" }` pattern used throughout the codebase (e.g., `src/lib/api-auth.ts`).

---

### Task 6: Complete saved analysis body validation
**Linear Issue:** [FOO-943](https://linear.app/lw-claude/issue/FOO-943)
**Effort:** S
**Files:**
- `src/app/api/saved-analyses/route.ts` (modify)
- `src/lib/__tests__/saved-analyses.test.ts` (modify)

**Steps:**
1. **RED**: Add tests in `src/lib/__tests__/saved-analyses.test.ts` (or create `src/app/api/saved-analyses/__tests__/route.test.ts` if better colocated) for:
   - POST with missing `unit_id` field returns 400
   - POST with missing `fiber_g` field returns 400
   - POST with valid complete FoodAnalysis succeeds
   - Run `npx vitest run "saved-analyses"` — new validation tests fail.
2. **GREEN**: At `src/app/api/saved-analyses/route.ts:40-48`, expand the validation to also check `unit_id` (number), `fiber_g` (number), and `sodium_mg` (number). These are the fields used in downstream rendering (nutrition cards, food detail page). Leave optional fields (`saturated_fat_g`, `trans_fat_g`, `sugars_g`, `calories_from_fat`, `keywords`, `confidence`, `description`) as not required — they have safe defaults or are nullable in the UI.
3. **VERIFY**: Run `npx vitest run "saved-analyses"` — all tests pass.

**Notes:**
- Follow the existing inline validation pattern at lines 40-48 (simple typeof checks, no validation library).
- The FoodAnalysis type is defined in `src/types/index.ts` — check which fields are required vs optional there.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — Review changes for bugs
2. Run `verifier` agent — Verify all tests pass and zero warnings

---

## Plan Summary

**Objective:** Fix 6 code audit findings — contradictory test, rate limiter memory leak, fire-and-forget timeout, model alias pinning, logging convention, and input validation.
**Linear Issues:** FOO-931, FOO-932, FOO-934, FOO-937, FOO-942, FOO-943
**Approach:** All 6 fixes are small, independent surgical changes. Task 1 fixes a dangerous contradictory test that has caused two prior production incidents. Task 2 adds periodic cleanup and hard cap to the rate limiter. Tasks 3-6 are minor improvements to reliability, convention compliance, and input validation.
**Scope:** 6 tasks, ~8 files, ~4 new/modified tests
**Key Decisions:**
- Rate limiter fix uses periodic sweep + hard cap (no LRU library) — sufficient for single-user app
- Saved analysis validation adds 3 required numeric fields (unit_id, fiber_g, sodium_mg) — optional fields remain optional
- Claude model pinned to `claude-sonnet-4-6-20250514` (latest available snapshot)
**Risks:**
- Task 4 (model pin): verify the exact snapshot ID `claude-sonnet-4-6-20250514` is valid before deploying — check Anthropic docs if unsure
