# Implementation Plan

**Created:** 2026-06-01
**Source:** Inline request: "fix everything" — remediate all actionable findings from the deep multi-agent review of the Fitbit→Google Health cutover merge (`f386f9e`, base `546d7b5`)
**Linear Issues:** [FOO-1117](https://linear.app/lw-claude/issue/FOO-1117), [FOO-1118](https://linear.app/lw-claude/issue/FOO-1118), [FOO-1119](https://linear.app/lw-claude/issue/FOO-1119), [FOO-1120](https://linear.app/lw-claude/issue/FOO-1120), [FOO-1121](https://linear.app/lw-claude/issue/FOO-1121), [FOO-1122](https://linear.app/lw-claude/issue/FOO-1122), [FOO-1123](https://linear.app/lw-claude/issue/FOO-1123), [FOO-1124](https://linear.app/lw-claude/issue/FOO-1124), [FOO-1125](https://linear.app/lw-claude/issue/FOO-1125), [FOO-1126](https://linear.app/lw-claude/issue/FOO-1126), [FOO-1127](https://linear.app/lw-claude/issue/FOO-1127), [FOO-1128](https://linear.app/lw-claude/issue/FOO-1128), [FOO-1129](https://linear.app/lw-claude/issue/FOO-1129), [FOO-1130](https://linear.app/lw-claude/issue/FOO-1130), [FOO-1131](https://linear.app/lw-claude/issue/FOO-1131), [FOO-1132](https://linear.app/lw-claude/issue/FOO-1132), [FOO-1133](https://linear.app/lw-claude/issue/FOO-1133), [FOO-1134](https://linear.app/lw-claude/issue/FOO-1134), [FOO-1135](https://linear.app/lw-claude/issue/FOO-1135)
**Branch:** fix/google-health-migration-review-fixes

## Context Gathered

### Codebase Analysis
- **Source of findings:** 9-dimension, 131-agent adversarially-verified review of merge `546d7b5..f386f9e` + independent verification of the Google Health v4 contract against Google's official reference docs.
- **Baseline (current `main`):** typecheck ✅ · lint ✅ · `npm test` 3453 pass (193 files) ✅ · `npm run build` ✅. **This green is NOT evidence of Health-path correctness**: staging runs `HEALTH_DRY_RUN=true` and every test mocks `fetch`, so the live Google Health write/read contract has never executed.
- **What is verified CORRECT (do not touch):** host/version/paths (`health.googleapis.com/v4`, `users/me/dataTypes/{type}/dataPoints`, `:batchDelete`, `:dailyRollUp`), kebab data-type ids, NutritionLog body field names, OAuth scope strings (`nutrition.writeonly` + `*.readonly`), `GET users/me/profile`, AES-256-GCM token encryption at rest, the Claude/Anthropic refactor (behavior-preserving, SDK types match — only the slow-path tool_result gap in FOO-1133), and the ~95%-complete rename. The double-cast pattern and `LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT` are ACCEPTED patterns per CLAUDE.md.
- **Key files in scope:** `src/lib/google-health.ts`, `src/lib/google-health-rate-limit.ts`, `src/lib/auth.ts`, `src/lib/session.ts`, `src/lib/health-tokens.ts`, `src/lib/health-connection.ts`, `src/lib/health-error-response.ts`, `src/lib/daily-goals.ts`, `src/lib/food-log.ts`, `src/lib/claude.ts`, `src/app/api/log-food/route.ts`, `src/app/api/edit-food/route.ts`, `src/app/api/auth/google/callback/route.ts`, `src/app/api/auth/google-health/route.ts`, `src/app/api/find-matches/route.ts`, `src/app/api/shared-food/[token]/route.ts`, `src/app/api/daily-goals-settings/route.ts`, `src/components/health-connect-guard.tsx`, `src/components/daily-goals-card.tsx`, `src/components/health-profile-card.tsx`, `src/db/schema.ts`, `drizzle/0027_google_health_migration.sql`, `MIGRATIONS.md`.
- **Test conventions:** colocated `__tests__/`; Vitest; `npx vitest run "pattern"` for TDD. Integration suites use real Postgres (`*.integration.test.ts`, `vitest.integration.config.ts`).

### MCP Context
- **MCPs used:** Linear (`list_teams`, `list_issue_labels`, `list_issue_statuses`, `save_issue`). Team "Food Scanner". All 19 issues created in **Todo**.
- **Findings:** Pre-existing related blocker **FOO-1115** (Google Health endpoint/contract live-validation) is the umbrella for every "Live-validation note" below — the staging smoke test resolves them collectively.

## Tasks

> **Severity legend:** 🔴 BLOCKER (must fix before production cutover) · 🟠 should-fix · 🟡 nice-to-have.
> **TDD for every task:** write/extend the test first → run `npx vitest run "<pattern>"` (expect fail) → implement → run again (expect pass). Workers run targeted vitest directly; full `verifier` + E2E are lead-only.

### Task 1: 🔴 Correct migration 0027 unit_id conversion (USING clause) + boot guard
**Linear Issue:** [FOO-1117](https://linear.app/lw-claude/issue/FOO-1117)
**Files:**
- `drizzle/` corrected manual migration for the `unit_id` column conversions (modify/override 0027 per the established manual-migration pattern)
- `src/db/` migration runner / connection path (modify — add boot guard)
- `src/db/__tests__/*.test.ts` and a colocated test for the legacy map + boot guard (create/modify)
- `MIGRATIONS.md` (modify)

**Steps:**
1. Write a unit test asserting `LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT` maps every historically-written id to a valid `ServingUnit` and defaults unknown ids to a safe unit.
2. Write a test for the boot guard: "0027 journaled + `unit_id` still `integer`" → fast-fail; "converted to `text`" → pass.
3. Run vitest (expect fail).
4. Replace the two bare `ALTER COLUMN unit_id SET DATA TYPE text` with `ALTER COLUMN unit_id TYPE text USING (CASE … END)` mapping legacy numeric ids → `ServingUnit` strings, for `custom_foods` and `food_log_entries`. Use the manual-migration + `__drizzle_migrations` journal-insert pattern (do NOT hand-write a Drizzle snapshot; do NOT run `drizzle-kit generate` for this data transform).
5. Add the startup guard that refuses to boot (FATAL log) if 0027 is journaled but `unit_id` is still integer.
6. Run vitest (expect pass).

**Notes:**
- **Migration note:** Production `custom_foods.unit_id` + `food_log_entries.unit_id` integer→text for both users' full history. The corrected SQL must be applied by `push-to-production` (runbook already references the override). Validate against a prod DB backup before promotion.
- **Do first** — Task 2 reuses the legacy map. Lead-owned (manual migration / journal), per the "generated files are lead-only" rule.

### Task 2: 🔴 Remap legacy numeric unit_id in saved_analyses JSONB + coerce at read boundaries
**Linear Issue:** [FOO-1118](https://linear.app/lw-claude/issue/FOO-1118)
**Files:**
- The Task 1 manual migration (extend with a `jsonb_set` remap)
- `src/app/api/shared-food/[token]/route.ts` (modify), `src/lib/saved-analyses.ts` + retrieval path (modify)
- colocated `__tests__` for shared-food + saved-analyses (modify)

**Steps:**
1. Write tests: shared-food and saved-analyses read paths return a valid `ServingUnit` string when the stored JSONB `unit_id` is legacy-numeric; `find-matches`/`log-food` accept a remapped saved analysis (no 400).
2. Run vitest (expect fail).
3. Extend the migration to `jsonb_set` the `food_analysis.unit_id` for `saved_analyses` rows whose value is numeric, using the same legacy map.
4. Add defensive `coerceServingUnit` at the read boundaries that surface stored unit_id to clients.
5. Run vitest (expect pass).

**Notes:**
- **Migration note:** Production `saved_analyses.food_analysis` JSONB. Depends on Task 1's map. Log in `MIGRATIONS.md`.

### Task 3: 🔴 Fix getGoogleHealthIdentity to read `healthUserId`
**Linear Issue:** [FOO-1119](https://linear.app/lw-claude/issue/FOO-1119)
**Files:** `src/lib/auth.ts` (modify), `src/lib/__tests__/auth.test.ts` (modify)
**Steps:**
1. Add a contract test parsing the real `{ name, legacyUserId, healthUserId }` shape → expect the function returns `healthUserId`; a response missing `healthUserId` throws the typed error. Update existing `{userId}` mocks to the real shape.
2. Run vitest (expect fail).
3. Change the parse to read `data.healthUserId` (keep `legacyUserId` available for mapping); preserve the existing OAuth timeout + `sanitizeErrorBody`.
4. Run vitest (expect pass).

**Notes:**
- **External API:** keep `OAUTH_TIMEOUT_MS` + AbortController; sanitize errors (never log tokens). Verified vs Google's `users.getIdentity` reference.

### Task 4: 🔴 Correct nutrition write/edit/delete mechanics (PATCH + server id + fail-loud delete)
**Linear Issue:** [FOO-1120](https://linear.app/lw-claude/issue/FOO-1120)
**Files:** `src/lib/google-health.ts` (modify), `src/lib/__tests__/google-health.test.ts` (modify)
**Steps:**
1. Update/extend tests to assert: write is `PATCH …/users/me/dataTypes/nutrition-log/dataPoints/{id}` (id in path); the stored `healthLogId` is taken from the parsed response, NOT the local UUID; a user-initiated delete 404 throws while a cleanup/compensation delete 404 resolves.
2. Run vitest (expect fail).
3. Change `createNutritionLog` from POST-to-collection to `PATCH …/dataPoints/{id}` (keep the `{name, nutritionLog}` DataPoint envelope). Parse the response/Operation to capture the server-confirmed dataPoint id and return THAT as `healthLogId`.
4. Split `deleteNutritionLogs` (or add a `mode`) so user-initiated deletes treat 404 as a hard error and cleanup/compensation deletes stay idempotent.
5. Run vitest (expect pass).

**Notes:**
- **External API:** keep `"critical"` criticality, `REQUEST_TIMEOUT_MS`/`DEADLINE_MS`, error sanitization.
- **Live-validation note (release gate, FOO-1115):** confirm on staging with `HEALTH_DRY_RUN=false` — create→read-back→edit→delete→confirm-gone; verify whether a client id is honored vs server-assigned, sync vs Operation, the `MealType` enum values, `serving`/`interval` shapes, and sodium NutrientQuantity unit (grams vs mg).
- Coordinates with Task 13 (compensation) and Task 5 (dry-run).

### Task 5: 🔴 Dry-run persists null healthLogId (no unique-index collision)
**Linear Issue:** [FOO-1121](https://linear.app/lw-claude/issue/FOO-1121)
**Files:** `src/lib/google-health.ts` (modify), `src/app/api/log-food/route.ts` (modify), `src/app/api/edit-food/route.ts` (modify), colocated `__tests__` (modify)
**Steps:**
1. Write a test: two successive dry-run logs for the SAME user both succeed and both persist `health_log_id = null`; the non-dry-run path stores the server id.
2. Run vitest (expect fail).
3. Make the dry-run create return `{ healthLogId: null }` (widen the return type) OR map the dry-run result to null before insert; ensure compensation/delete skip when null.
4. Run vitest (expect pass).

**Notes:**
- **DB write:** respects the partial unique index `food_log_entries_user_health_log_uniq`. Unblocks staging QA / the smoke test in Task 4.

### Task 6: 🟠 Fix dailyRollUp range (start/end + exclusive end → next day)
**Linear Issue:** [FOO-1122](https://linear.app/lw-claude/issue/FOO-1122)
**Files:** `src/lib/google-health.ts` (modify), `src/lib/__tests__/google-health.test.ts` (modify)
**Steps:**
1. Test: request body uses `range.start`/`range.end` with `end` strictly the next civil day, `windowSizeDays: 1`; a populated rollup yields summed `caloriesOut`; empty → `{ caloriesOut: null }` (no throw).
2. Run vitest (expect fail).
3. Send `{ range: { start: civilDate(date), end: civilDate(date+1) }, windowSizeDays: 1 }`. Keep `"optional"` criticality.
4. Run vitest (expect pass).

**Notes:**
- **Live-validation note (FOO-1115):** confirm the `TotalCaloriesRollupValue` leaf field (`kcalSum`) and exact `CivilDateTime` shape live. Coordinates with Task 18 (timezone).

### Task 7: 🟠 getHealthProfile tolerates missing height
**Linear Issue:** [FOO-1123](https://linear.app/lw-claude/issue/FOO-1123)
**Files:** `src/lib/google-health.ts` (modify), `src/types/index.ts` (modify), `src/lib/daily-goals.ts` (modify if needed), colocated `__tests__` (modify)
**Steps:**
1. Test: `getHealthProfile` returns `{ ageYears, sex, heightCm: null }` (no throw) when height is empty/404; the goals layer degrades gracefully with null height (fallback height).
2. Run vitest (expect fail).
3. Make `heightCm` optional in `HealthProfile`; return null instead of throwing; add a stored/default-height fallback in the goals/macro path (mirror the `sex→NA` tolerance).
4. Run vitest (expect pass).

**Notes:** UI "height unavailable" state handled in Task 16.

### Task 8: 🟠 Branch HEALTH errors by status (4xx vs 5xx)
**Linear Issue:** [FOO-1124](https://linear.app/lw-claude/issue/FOO-1124)
**Files:** `src/lib/google-health.ts` (modify), `src/lib/health-error-response.ts` (modify), colocated `__tests__` (modify)
**Steps:**
1. Test: a mocked 400 upstream surfaces a 400-class typed `ErrorCode` to the client; a 500 upstream → 502; both sanitized.
2. Run vitest (expect fail).
3. Carry the HTTP status into the thrown error (or add `HEALTH_BAD_REQUEST`); map 4xx-origin → 400-class, 5xx-origin → 502 in `health-error-response.ts`.
4. Run vitest (expect pass).

**Notes:**
- **Error responses:** use `api-response.ts` + `ErrorCode`; never leak raw upstream body. Do early — clarifies the smoke test in Task 4.

### Task 9: 🟠 Rate-limit breaker detects 403 RESOURCE_EXHAUSTED + evicts stale cooldowns
**Linear Issue:** [FOO-1125](https://linear.app/lw-claude/issue/FOO-1125)
**Files:** `src/lib/google-health-rate-limit.ts` (modify), `src/lib/google-health.ts` (modify — 403 mapping), colocated `__tests__` (modify)
**Steps:**
1. Test: a 403 RESOURCE_EXHAUSTED records a cooldown and blocks the next `optional` call; a 403 *scope* error still maps to `HEALTH_SCOPE_MISSING`; expired entries are evicted from the Map.
2. Run vitest (expect fail).
3. Record cooldown for both 429 and 403 RESOURCE_EXHAUSTED (inspect status + parsed error body); ensure quota-403 ≠ scope-403 mapping; add single-pass eviction in `getRateLimitSnapshot`.
4. Run vitest (expect pass).

**Notes:** **Live-validation note (FOO-1115):** confirm Google's real quota-error shape on staging.

### Task 10: 🟠 Enforce granted scopes on write routes
**Linear Issue:** [FOO-1126](https://linear.app/lw-claude/issue/FOO-1126)
**Files:** `src/lib/session.ts` (modify), `src/lib/health-connection.ts` (reuse), write route handlers (modify), colocated `__tests__` (modify)
**Steps:**
1. Test: a session with health tokens but missing `nutrition.writeonly` is rejected by the write-route gate with the typed scope error (clean 4xx); a fully-scoped session passes.
2. Run vitest (expect fail).
3. Make `validateSession({requireHealth})` on write routes require `checkHealthConnection` status `healthy` (or reject partial grants at the callback). Return `HEALTH_SCOPE_MISSING` from the gate, not deep in the write.
4. Run vitest (expect pass).

**Notes:**
- **Auth:** keep `getSession()` + `validateSession()` convention. **Depends on Task 11 (FOO-1127)** so a legitimately omitted scope isn't misread as missing. *(The Linear description's "depends on FOO-1124" is a typo — the real dependency is FOO-1127.)*

### Task 11: 🟠 Treat omitted OAuth `scope` as all-granted
**Linear Issue:** [FOO-1127](https://linear.app/lw-claude/issue/FOO-1127)
**Files:** `src/app/api/auth/google/callback/route.ts` (modify), `src/lib/health-tokens.ts` (modify), `src/lib/health-connection.ts` (modify), colocated `__tests__` (modify)
**Steps:**
1. Test: a token response WITHOUT `scope` yields a `healthy` `checkHealthConnection` (not `scope_mismatch`); a genuinely partial scope still reports mismatch.
2. Run vitest (expect fail).
3. Treat omitted `scope` as all requested `GOOGLE_HEALTH_SCOPES` granted (store the requested set, or a sentinel `checkHealthConnection` reads as complete); or require `scope` at exchange.
4. Run vitest (expect pass).

### Task 12: 🟠 Bind health-connect tokens to the initiating user
**Linear Issue:** [FOO-1128](https://linear.app/lw-claude/issue/FOO-1128)
**Files:** `src/app/api/auth/google-health/route.ts` (modify), `src/app/api/auth/google/callback/route.ts` (modify), colocated `__tests__` (modify)
**Steps:**
1. Test: a callback whose cookie user differs from the state user is rejected; the happy path binds to the initiating user; a nonce mismatch is rejected.
2. Run vitest (expect fail).
3. Add `userId` to the OAuth `state` at initiation; at the callback assert `getSessionById(cookieSessionId).userId === parsedState.userId` and validate the nonce vs stored `oauthState` before binding tokens.
4. Run vitest (expect pass).

**Notes:** Security — shared-device (Lucas + Mariana) token misbinding.

### Task 13: 🟠 Consistent edit-food compensation contract + CRITICAL logging + nested-failure tests
**Linear Issue:** [FOO-1129](https://linear.app/lw-claude/issue/FOO-1129)
**Files:** `src/app/api/edit-food/route.ts` (modify), `src/app/api/edit-food/__tests__/route.test.ts` (modify)
**Steps:**
1. Tests: (a) delete-ok + create-fail + recreate-fail → `PARTIAL_ERROR` + CRITICAL log (both fast & regular paths); (b) delete-fail during compensation → `PARTIAL_ERROR`. Unit-test `buildAnalysisFromEntry`.
2. Run vitest (expect fail).
3. Return `PARTIAL_ERROR` consistently on compensation failure; log CRITICAL with old+new healthLogIds; don't leave a stale id that future deletes silently swallow (coordinate with Task 4's fail-loud delete).
4. Run vitest (expect pass).

**Notes:**
- **DB write / multi-step:** ensure DB row and Health state can't diverge silently; surface typed `PARTIAL_ERROR` via `api-response.ts`.

### Task 14: 🟠 Environment↔HEALTH_DRY_RUN boot invariant
**Linear Issue:** [FOO-1130](https://linear.app/lw-claude/issue/FOO-1130)
**Files:** `src/lib/env.ts` and/or `instrumentation.ts` (modify), `src/lib/google-health.ts` (reuse `isHealthDryRun`), colocated `__tests__` (modify), `.env.sample` + `MIGRATIONS.md` (modify)
**Steps:**
1. Test: guard fast-fails for staging `APP_URL` + unset/typo'd flag; passes for staging + `"true"`; passes for production + explicit `"false"`; rejects unrecognized values.
2. Run vitest (expect fail).
3. Add the boot guard (staging APP_URL ⇒ require `HEALTH_DRY_RUN==="true"`; production ⇒ require explicit `"true"`/`"false"`); log the resolved health mode at startup; add to env docs.
4. Run vitest (expect pass).

**Notes:** Security/data-safety. **Migration note:** coordinate with `push-to-production` (sets the var via Railway CLI).

### Task 15: 🟠 Require sex + activity level before save; goals_not_set hint; document post-migration step
**Linear Issue:** [FOO-1131](https://linear.app/lw-claude/issue/FOO-1131)
**Files:** `src/components/daily-goals-card.tsx` (modify), `src/app/api/daily-goals-settings/route.ts` (modify), `src/lib/daily-goals.ts` (modify — hint), colocated `__tests__` (modify), `MIGRATIONS.md` (modify)
**Steps:**
1. Tests: Save disabled when `sex===null` OR `activityLevel===null`; the settings route 400s on null required fields; the goals response carries an actionable hint.
2. Run vitest (expect fail).
3. Client guard + accessible validation message; server typed-400 rejection; `goals_not_set` hint.
4. Run vitest (expect pass).

**Notes:**
- **Client mutation / user-triggered action:** disable Save during `saving` AND when required fields null; toast on invalid submit. Multi-user: never hardcode sex — per-user.
- **Migration note:** both users must set sex once post-cutover (document prominently).

### Task 16: 🟠 Health components render error/timeout states (no blank pages)
**Linear Issue:** [FOO-1132](https://linear.app/lw-claude/issue/FOO-1132)
**Files:** `src/components/health-connect-guard.tsx`, `src/components/daily-goals-card.tsx`, `src/components/health-profile-card.tsx` (modify), colocated `__tests__` (modify)
**Steps:**
1. Component tests: an error state + retry render when the SWR/fetch errors (no blank page); a timeout shows a distinct message; missing height renders gracefully.
2. Run vitest (expect fail).
3. Destructure & handle `error` in each component (pattern: `health-profile-card.tsx:71-85` / `about-section`); distinguish `DOMException`/`TimeoutError`; render "height unavailable" consistent with Task 7.
4. Run vitest (expect pass).

**Notes:**
- **Client data fetching:** `useSWR` only (no raw `useState`+`fetch`); keep loading skeletons; 44px touch targets; accessible error text.

### Task 17: 🟡 Claude slow-path report_nutrition tool_result pairing
**Linear Issue:** [FOO-1133](https://linear.app/lw-claude/issue/FOO-1133)
**Files:** `src/lib/claude.ts` (modify), `src/lib/__tests__/claude.test.ts` (modify)
**Steps:**
1. Test: a first slow-path response containing `report_nutrition` + a data tool produces a next request where every `tool_use` has a matching `tool_result`, and the analysis is captured as `pendingAnalysis` (follow `runToolLoop` test patterns).
2. Run vitest (expect fail).
3. In `analyzeFood`/`conversationalRefine`, push a synthetic `tool_result` per `report_nutrition` block (mirror `runToolLoop`) and capture the analysis. Keep model id / max_tokens / tool_choice / retry / abort unchanged.
4. Run vitest (expect pass).

### Task 18: 🟡 Align meal-write timezone with activity rollup query
**Linear Issue:** [FOO-1134](https://linear.app/lw-claude/issue/FOO-1134)
**Files:** `src/lib/google-health.ts` (modify), `src/lib/__tests__/google-health.test.ts` (modify)
**Steps:**
1. Test: a 23:30 meal at −03:00 — the write instant and the rollup query agree on the civil day (round-trip date-boundary test).
2. Run vitest (expect fail).
3. Carry the user's zone offset into the rollup window (and/or normalize the write instant to the query's civil-date basis). Coordinate with Task 6.
4. Run vitest (expect pass).

**Notes:** **Live-validation note (FOO-1115):** confirm Google's civil-date interpretation on staging.

### Task 19: 🟡 Migration tech-debt sweep (stale mocks, comments, integration coverage)
**Linear Issue:** [FOO-1135](https://linear.app/lw-claude/issue/FOO-1135)
**Files:** `src/app/api/search-foods/__tests__/route.test.ts`, `src/lib/__tests__/swr.test.ts`, `src/components/__tests__/*.tsx`, `src/lib/google-health.ts`, `src/lib/http.ts`, `src/lib/users.ts`, `src/lib/health-connection.ts`, `src/lib/google-health-rate-limit.ts`, `src/lib/__tests__/food-log.integration.test.ts`, `src/app/api/log-food/route.ts` (modify)
**Steps:**
1. Add a `healthLogId` create→persist→retrieve→delete round-trip to the food-log integration test (write test first; expect fail until wired).
2. Rename stale `fitbitConnected`→`healthConnected` and `FITBIT_*`→`HEALTH_*` in mocks/descriptions; renamed mocks must still pass and now match the real session/error shapes.
3. Downgrade over-confident "confirmed against discovery doc" comments to "inferred — pending live validation (FOO-1115)"; update stale `fitbit.ts` comment refs; comment `DEFAULT_COOLDOWN_MS` rationale; document the inactive in-memory idempotency path.
4. Run vitest (expect pass) + keep all gates green.

**Notes:** Do NOT touch the accepted double-cast pattern or `LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT`. No behavior change beyond the renames + added test.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — review all changes for bugs.
2. Run `verifier` agent (no args) — unit tests + lint + build, zero warnings.
3. Run `verifier "e2e"` agent — E2E suite (UI/route/migration changes are significant).
4. **Release gate (manual, FOO-1115 / blocks `push-to-production`):** on staging with `HEALTH_DRY_RUN=false`, run one real Google Health round-trip with a real account — connect → log → read back → edit → delete → confirm gone — and reconcile the live response shapes against the "Live-validation note" tasks (4, 6, 9, 18). Do NOT promote to production until this passes.

---

## Plan Summary

**Objective:** Remediate every actionable finding from the deep review of the Fitbit→Google Health cutover so the migration is correct and safe to ship — the merge currently passes all CI but the live Health write/read contract is wrong/unverified and migration 0027 would crash production.

**Linear Issues:** FOO-1117, FOO-1118, FOO-1119, FOO-1120, FOO-1121, FOO-1122, FOO-1123, FOO-1124, FOO-1125, FOO-1126, FOO-1127, FOO-1128, FOO-1129, FOO-1130, FOO-1131, FOO-1132, FOO-1133, FOO-1134, FOO-1135

**Approach:** TDD across 19 tasks grouped as: data-migration integrity (1–2), Google Health API contract (3–9), auth/session hardening (10–12), route/compensation + deploy safety (13–14), macro-engine gating + UI states (15–16), and Claude/timezone/tech-debt (17–19). Each task encodes the corrected contract in tests-with-mocks; items that genuinely require the live API are implemented to the documented contract and flagged with a "Live-validation note" gated on a staging smoke test (FOO-1115).

**Scope:** 19 tasks · ~30 source/test files · adds contract/regression tests for getIdentity, the PATCH write path, dry-run null id, dailyRollUp range, scope handling, compensation, the boot invariant, and a healthLogId integration round-trip.

**Key Decisions:**
- BLOCKERS (Tasks 1–5) must land before any production cutover; 6–16 are should-fix; 17–19 nice-to-have.
- Migration tasks (1, 2) and the corrected SQL/journal are **lead-owned** (manual migration; never hand-write Drizzle snapshots).
- Task 10 depends on Task 11; Tasks 4/5/13 are interdependent (write/dry-run/compensation); Task 16 depends on Task 7.
- Live-only uncertainties (exact create semantics, MealType enums, kcalSum field, quota-error shape, civil-date interpretation, sodium unit) are NOT guessed further — they're gated on the staging smoke test (FOO-1115).

**Risks:**
- **Production migration:** 0027 must be applied via the corrected manual SQL or production won't start; validate against a backup first.
- **Live contract:** the nutrition write/edit/delete mechanics (Task 4) can only be fully confirmed against the real API — the staging smoke test is a hard release gate.
- **Data semantics:** legacy numeric `unit_id` mapping (Tasks 1–2) must cover all historical values or some historical foods mislabel/400.
- **Post-cutover:** both users must set biological sex once or the macro engine stays blocked (Task 15).

---

## Iteration 1

**Implemented:** 2026-06-01
**Method:** Single-agent (phase-gated; google-health.ts is shared across 8 tasks + Tasks 1–2 are lead-owned manual migrations, so the work collapses to ~1 dominant unit → parallel workers would have spent more time in merge conflicts than they'd save)

### Tasks Completed This Iteration
- **Task 1 (FOO-1117):** Migration 0027 `unit_id` integer→text now carries the `USING (CASE … END)` legacy-id backfill (baked into the committed file — correct for populated tables, not just empty CI DBs); added `assertUnitIdConverted` boot guard in `src/db/migrate.ts` that FATAL-fails the boot if 0027 is applied but `unit_id` is still integer (or a column is missing). MIGRATIONS.md runbook item 1 marked RESOLVED.
- **Task 2 (FOO-1118):** Extended 0027 with a `jsonb_set` remap of `saved_analyses.food_analysis.unit_id` for JSON-numeric rows; added defensive `coerceServingUnit` at the read boundaries (`getSavedAnalysis`, `GET /api/shared-food/[token]`). MIGRATIONS.md runbook item 2 marked RESOLVED.
- **Task 3 (FOO-1119):** `getGoogleHealthIdentity` now reads `healthUserId` (real v4 `{name, legacyUserId, healthUserId}` shape) instead of the non-existent `userId`; throws the typed error when `healthUserId` is missing.
- **Task 4 (FOO-1120):** `createNutritionLog` switched from POST-to-collection to `PATCH …/dataPoints/{id}`; the stored `healthLogId` now comes from the parsed server response (`parsePatchedDataPointId` — handles DataPoint name, Operation-wrapped name, and falls back to the PATCHed id). `deleteNutritionLogs` gained a `mode: "user" | "cleanup"` (default cleanup/idempotent; `"user"` throws a distinct `HEALTH_LOG_NOT_FOUND` on 404). `food-history` DELETE uses `"user"` mode but catches the drift and still removes the local row (never strands the user — bug-hunter HIGH fix).
- **Task 5 (FOO-1121):** dry-run `createNutritionLog` returns `{ healthLogId: null }` (return type widened to `string | null`) so the partial unique index never collides; log-food/edit-food coalesce. (Both callers already guard create behind `!isDryRun`; this hardens the source.)
- **Task 6 (FOO-1122):** `getHealthActivitySummary` dailyRollUp body fixed to `{ range: { start, end:nextDay }, windowSizeDays: 1 }` (closed-open civil interval; was a zero-length `{startTime,endTime}` window).
- **Task 7 (FOO-1123):** `HealthProfile.heightCm`/`HealthProfileData.heightCm` are now `number | null`; `getHealthProfile` returns `null` (no throw) when the user has no height dataPoint; `daily-goals` applies a population-neutral `FALLBACK_HEIGHT_CM = 170` with a warning log; component guards added to `health-profile-card` + `daily-goals-card` (full "height unavailable" UI is Task 16).

### Tasks Remaining
- **Task 8 (FOO-1124):** Branch HEALTH errors by status (4xx→specific, 5xx→502).
- **Task 9 (FOO-1125):** Rate-limit breaker detects 403 RESOURCE_EXHAUSTED + evicts stale cooldowns.
- **Task 10 (FOO-1126):** Enforce granted scopes on write routes (depends on Task 11).
- **Task 11 (FOO-1127):** Treat omitted OAuth `scope` as all-granted.
- **Task 12 (FOO-1128):** Bind health-connect tokens to the initiating user.
- **Task 13 (FOO-1129):** Consistent edit-food compensation contract + CRITICAL logging + nested-failure tests (coordinates with Task 4's fail-loud delete).
- **Task 14 (FOO-1130):** Environment↔HEALTH_DRY_RUN boot invariant.
- **Task 15 (FOO-1131):** Require sex + activity level before save; `goals_not_set` hint.
- **Task 16 (FOO-1132):** Health components render error/timeout states (depends on Task 7 — height-unavailable UI).
- **Task 17 (FOO-1133):** Claude slow-path `report_nutrition` tool_result pairing.
- **Task 18 (FOO-1134):** Align meal-write timezone with activity rollup query (coordinates with Task 6).
- **Task 19 (FOO-1135):** Migration tech-debt sweep (stale mocks, comments, integration coverage) — includes downgrading now-stale "POST/Operation" comments in MIGRATIONS.md Phase-3 + the createNutritionLog doc that Task 4 superseded.

### Files Modified
- `drizzle/0027_google_health_migration.sql` — USING(CASE) backfill on both `unit_id` columns + `saved_analyses` jsonb_set remap
- `src/db/migrate.ts` — `assertUnitIdConverted` boot guard (integer + missing-column checks)
- `src/db/__tests__/migrate.test.ts` — boot-guard tests
- `src/types/index.ts` — `HealthProfile`/`HealthProfileData` `heightCm: number | null`; legacy-map invariant test (in `src/types/__tests__/index.test.ts`)
- `src/lib/saved-analyses.ts` + `__tests__` — coerce unit_id at `getSavedAnalysis`
- `src/app/api/shared-food/[token]/route.ts` + `__tests__` — coerce unit_id
- `src/lib/auth.ts` + `__tests__` — read `healthUserId`
- `src/lib/google-health.ts` + `__tests__` — PATCH write + server-id parse, delete `mode`, dailyRollUp range, nullable height, `addDays`/`civilDateTime` helpers
- `src/app/api/food-history/[id]/route.ts` + `__tests__` — user-delete drift handling
- `src/app/api/log-food/route.ts` + `__tests__`, `src/app/api/edit-food/route.ts` — dry-run null healthLogId coalescing
- `src/lib/daily-goals.ts` + `__tests__` — `FALLBACK_HEIGHT_CM` for null height
- `src/components/health-profile-card.tsx`, `src/components/daily-goals-card.tsx` — null-height guards
- `MIGRATIONS.md` — runbook items 1 & 2 marked RESOLVED

### Linear Updates
- FOO-1117, FOO-1118, FOO-1119, FOO-1120, FOO-1121, FOO-1122, FOO-1123: Todo → In Progress → Review

### Pre-commit Verification
- **bug-hunter:** Found 3 bugs (1 HIGH, 2 MEDIUM) + 1 withdrawn false positive. All fixed:
  - HIGH — `mode:"user"` 404 made entries permanently undeletable (throw→502, local row stranded). Fixed: distinct `HEALTH_LOG_NOT_FOUND` error + route catches it, logs CRITICAL drift, and still deletes the local row.
  - MEDIUM — boot guard passed silently when a `unit_id` column was absent. Fixed: missing-column check.
  - MEDIUM — `civilDateTime` produced a `NaN` body on a malformed date. Fixed: fail-fast validation.
- **verifier:** 3,469 tests pass (193 files), lint clean, build clean — zero warnings.

### Continuation Status
Point budget reached at a clean phase boundary (BLOCKERS 1–5 + the two contiguous google-health read fixes 6–7). Tasks 8–19 remain — the next invocation resumes at Task 8 (FOO-1124).
**Release gate unchanged:** the FOO-1115 staging smoke test (`HEALTH_DRY_RUN=false`, real round-trip) is still required before `push-to-production`.

### Review Findings (reviewed jointly with Iteration 2)
Iterations 1 and 2 were reviewed together in a single plan-review session (they share `google-health.ts`, `edit-food`, `types/index.ts`, `daily-goals`, `shared-food`, and the health components). The consolidated findings — including one that traces to Iteration 1 files (shared-food Cache-Control) — are documented under **Iteration 2 → Review Findings** below. All FOO-1117..1123 issues moved Review → Merge.

<!-- REVIEW COMPLETE -->

---

## Iteration 2

**Implemented:** 2026-06-02
**Method:** Agent team (4 workers, worktree-isolated)

### Tasks Completed This Iteration
- **Task 8 (FOO-1124):** Branch HEALTH errors by status — added `HEALTH_BAD_REQUEST` ErrorCode; all non-ok Google Health responses now throw 4xx→`HEALTH_BAD_REQUEST` (→400) vs 5xx→`HEALTH_API_ERROR` (→502) across `createNutritionLog`/`deleteNutritionLogs`/`getHealthProfile`/`getHealthLatestWeightKg`/`getHealthActivitySummary`/`getHealthHeightCm`; sanitization preserved. (worker-1)
- **Task 9 (FOO-1125):** Rate-limit breaker — `recordResourceExhaustedCooldown()` records a cooldown for 403 RESOURCE_EXHAUSTED (distinguished from scope-403, which still maps to `HEALTH_SCOPE_MISSING`); single-pass stale-entry eviction in `getRateLimitSnapshot`. (worker-1)
- **Task 18 (FOO-1134):** Meal-write timezone aligned with rollup — `civilDateTime()` accepts an optional `zoneOffset` (→ `utcOffset` duration); `getHealthActivitySummary` carries the zone so a 23:30 meal at −03:00 agrees with the rollup civil day. (worker-1)
- **Task 19 (FOO-1135):** Tech-debt sweep — `healthLogId` create→persist→retrieve→delete round-trip added to `food-log.integration.test.ts` (skipIf no Postgres); stale `fitbitConnected`→`healthConnected`, `FITBIT_*`→`HEALTH_*` renames in mocks; "confirmed"→"inferred — pending live validation (FOO-1115)" comment downgrades; `DEFAULT_COOLDOWN_MS` rationale + inactive idempotency-path docs. (worker-1)
- **Task 11 (FOO-1127):** Omitted OAuth `scope` treated as RFC 6749 all-granted — `checkHealthConnection` returns `healthy` for null scope; genuinely-partial scope still reports mismatch. (worker-2)
- **Task 10 (FOO-1126):** Write-route scope gate — `FullSession.healthScopeComplete?`; `getSession` uses `checkHealthConnection` (single DB read); `validateSession({requireHealth})` returns `HEALTH_SCOPE_MISSING` (403) when tokens exist but scopes are incomplete. (worker-2)
- **Task 12 (FOO-1128):** Token-user binding — `userId` embedded in the OAuth `state`; callback rejects (400 `VALIDATION_ERROR`) when state userId ≠ cookie-session userId; nonce validated. (worker-2)
- **Task 13 (FOO-1129):** Edit-food compensation — fast & regular paths return `PARTIAL_ERROR` consistently on compensation failure; CRITICAL log with old (and new) healthLogIds; `buildAnalysisFromEntry` exported + unit-tested; user vs cleanup delete modes. (worker-3)
- **Task 14 (FOO-1130):** `HEALTH_DRY_RUN` boot invariant — `validateHealthDryRunEnv()` in `env.ts` (staging requires `"true"`; production requires explicit `"true"`/`"false"`; typos rejected); wired into `instrumentation.ts`; `.env.sample` + `MIGRATIONS.md` updated. (worker-3)
- **Task 17 (FOO-1133):** Claude slow-path tool_result pairing — `analyzeFood`/`conversationalRefine` push a synthetic `tool_result` per `report_nutrition` block and capture it as `pendingAnalysis`, so the next `runToolLoop` request has no unanswered `tool_use` (no Anthropic 400). (worker-3)
- **Task 15 (FOO-1131):** Require sex + activity before save — Save disabled when `sex===null` OR `activityLevel===null` + accessible validation message; settings route 400s on null required fields; `goals_not_set` hint (`NutritionGoals.hint?`); MIGRATIONS.md post-cutover note. (worker-4)
- **Task 16 (FOO-1132):** Health components error/timeout states — `health-connect-guard` renders an error/retry state (no blank page) on session error; `health-profile-card` distinguishes `TimeoutError` + renders accessible "height unavailable"; `daily-goals-card` handles the profile `error`. (worker-4)

### Files Modified
- `src/lib/google-health.ts` — error branching, 403 RESOURCE_EXHAUSTED mapping, `civilDateTime(zoneOffset)`, rollup zone; comment downgrades
- `src/lib/health-error-response.ts` + `__tests__` — `HEALTH_BAD_REQUEST`→400
- `src/lib/google-health-rate-limit.ts` + `__tests__` — `recordResourceExhaustedCooldown`, stale eviction, `DEFAULT_COOLDOWN_MS` doc
- `src/types/index.ts` — `HEALTH_BAD_REQUEST` ErrorCode, `FullSession.healthScopeComplete?`, `NutritionGoals.hint?`
- `src/lib/health-connection.ts` + `__tests__` — null scope = all granted; comment refresh
- `src/lib/session.ts` + `__tests__` — `checkHealthConnection`-based scope gate, `HEALTH_SCOPE_MISSING`
- `src/app/api/auth/google-health/route.ts` + `__tests__`, `src/app/api/auth/google/callback/route.ts` + `__tests__` — userId in state, cross-user rejection, nonce
- `src/app/api/edit-food/route.ts` + `__tests__` — consistent `PARTIAL_ERROR` (both paths), CRITICAL logging, `buildAnalysisFromEntry`
- `src/lib/env.ts` + `__tests__`, `src/instrumentation.ts` — `validateHealthDryRunEnv` boot guard
- `src/lib/claude.ts` + `__tests__` — slow-path synthetic `tool_result` + `pendingAnalysis`
- `src/components/daily-goals-card.tsx`, `health-connect-guard.tsx`, `health-profile-card.tsx` + `__tests__` — required-field gating + error/timeout states
- `src/app/api/daily-goals-settings/route.ts` + `__tests__` — 400 on null sex/activityLevel
- `src/lib/daily-goals.ts` — `goals_not_set` hint
- `src/lib/http.ts`, `src/lib/users.ts`, `src/app/api/log-food/route.ts`, `src/app/api/search-foods/__tests__/route.test.ts`, `src/lib/__tests__/swr.test.ts`, `src/components/__tests__/saved-food-detail.test.tsx`, `src/lib/__tests__/food-log.integration.test.ts` — tech-debt sweep renames/comments/integration test
- `.env.sample`, `MIGRATIONS.md` — `HEALTH_DRY_RUN` docs + post-cutover sex/activity note

### Linear Updates
- FOO-1124, FOO-1125, FOO-1126, FOO-1127, FOO-1128, FOO-1129, FOO-1130, FOO-1131, FOO-1132, FOO-1133, FOO-1134, FOO-1135: Todo → In Progress → Review

### Pre-commit Verification
- **bug-hunter:** Found 3 real bugs (1 HIGH, 1 MEDIUM, 1 LOW) + several self-retracted false positives. All fixed, each with a regression test:
  - HIGH — edit-food fast-path DB-compensation `catch` returned generic `INTERNAL_ERROR` while the regular path returned `PARTIAL_ERROR` in the same orphaned-health-log scenario. Fixed: fast path now returns `PARTIAL_ERROR` + logs both old/new healthLogIds (matches Task 13's "both paths" contract).
  - MEDIUM — `validateHealthDryRunEnv()` silently bypassed all checks when `APP_URL` was empty/unset. Fixed: fail-fast guard requiring `APP_URL`.
  - LOW — edit-food test's inline `validateSession` mock didn't exercise the new `healthScopeComplete` scope gate. Fixed: mock updated + 403 `HEALTH_SCOPE_MISSING` test added.
- **verifier:** 3,531 tests pass (193 files), lint clean, build clean — zero warnings.

### Work Partition
- Worker 1: Tasks 8, 9, 18, 19 (Google Health API contract + tech-debt — owns `google-health.ts`, `google-health-rate-limit.ts`)
- Worker 2: Tasks 11→10, 12 (auth/session scope hardening — owns the auth cluster)
- Worker 3: Tasks 13, 14, 17 (edit-food compensation + boot invariant + Claude)
- Worker 4: Tasks 15, 16 (macro gating + UI error states)

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: merged via `ort` — `types/index.ts` + `health-connection.ts` auto-resolved (disjoint regions)
- Worker 3: merged via `ort` (no conflicts)
- Worker 4: merged via `ort` — `types/index.ts` + `MIGRATIONS.md` auto-resolved (disjoint regions)
- Typecheck green after every merge; post-merge full suite green.

### Continuation Status
**All plan tasks complete (Tasks 1–19 across Iterations 1–2).** Plan implementation is done.
**Release gate unchanged:** the FOO-1115 staging smoke test (`HEALTH_DRY_RUN=false`, real Google Health round-trip — create→read-back→edit→delete→confirm-gone) remains a hard manual gate before `push-to-production`, reconciling the live response shapes flagged in Tasks 4/6/9/18.

### Review Findings

Summary: 16 raw findings across the changed files (single plan-review session, 3 domain reviewers — security, reliability, quality — via Workflow). After dedup: **3 FIX (fixed inline, TDD), 9 DISCARD, 1 deferred to Backlog.** Covers Iterations 1 & 2 jointly (55 changed files).

**Issues fixed inline (TDD + bug-hunter clean):**
- [HIGH] BUG: edit-food returned a misleading **500 INTERNAL_ERROR** on `HEALTH_LOG_NOT_FOUND` drift — both the fast-path and regular-path old-log delete (`mode:"user"`) passed the 404-drift error to `mapHealthError`, which has no case for it (`src/app/api/edit-food/route.ts`, `src/lib/health-error-response.ts`). A user could never edit an entry whose Google Health log was externally deleted. **Fixed:** both paths now detect `HEALTH_LOG_NOT_FOUND`, log CRITICAL drift, and fall through to re-create (mirrors `food-history/[id]` drift handling). Merges reliability + quality findings. → **FOO-1136** (Merge)
- [MEDIUM] CONVENTION: `GET /api/shared-food/[token]` omitted `Cache-Control: private, no-cache` (CLAUDE.md GET rule). **Fixed:** header set on the success response (`src/app/api/shared-food/[token]/route.ts`). → **FOO-1137** (Merge)
- [MEDIUM] TEST: the new FOO-1126 write-route scope gate (403 `HEALTH_SCOPE_MISSING`) was untested for `log-food` + `food-history` — their `validateSession` mocks omitted the `healthScopeComplete === false` branch. **Fixed:** mocks corrected to mirror real `validateSession` + a 403 gate test added to each route. → **FOO-1138** (Merge)

**Deferred to Backlog (low priority, not blocking):**
- [P3] OBSERVABILITY: Google Health API functions don't log `durationMs` (claude.ts does). Zero correctness impact; latency already observable via Sentry tracing (1.0) + per-call breadcrumbs; M-size across ~6 functions. → **FOO-1139** (Backlog)

**Discarded findings (genuinely not bugs — verified against the code):**
- [DISCARDED] [med] SECURITY: edit/google callback token-binding guard is conditional on `stateUserId !== null` (`callback/route.ts:85`) — **impossible to exploit**: the incoming `state` must exactly equal the iron-session-stored `oauthState` (line 38), which always includes `userId` post-deploy; old states bind to the same initiating cookie user anyway, so no cross-user misbinding. Defense-in-depth only.
- [DISCARDED] [low] SECURITY: login flow drops `returnTo` when the user has no health tokens (`callback/route.ts:187`) — intended onboarding (must connect health first); minor UX, not a bug.
- [DISCARDED] [low] SECURITY: `validateSession` treats `healthScopeComplete === undefined` as passing (`session.ts:107`) — **impossible in production**: `getSession` is the only `FullSession` producer and always sets it (line 78); undefined only occurs in test mocks.
- [DISCARDED] [low] SECURITY: `refreshGoogleHealthToken` reads `GOOGLE_CLIENT_ID/SECRET` via `process.env` not `getRequiredEnv` (`google-health.ts:228`) — **misdiagnosed**: both vars ARE in `REQUIRED_ENV_VARS` and validated at boot (`env.ts:2-3` + `instrumentation.ts:40`), so the manual check is unreachable in a booted server, not a fail-fast gap.
- [DISCARDED] [low] BUG: weight `sampleTime` nesting assumption (`google-health.ts:929`) — inferred v4 schema, internally consistent with its fixture, explicitly gated on the FOO-1115 live-validation smoke test.
- [DISCARDED] [low] EDGE-CASE: `findKcalSum` first-match DFS (`google-health.ts:1007`) — speculative ("unlikely but not impossible"), inferred schema, gated on FOO-1115; summing across rollup points is already handled.
- [DISCARDED] [low] EDGE-CASE: `assertUnitIdConverted` boot guard couples to a future `unit_id` rename (`migrate.ts:22`) — intended design (fail-fast on corrupt post-migration state); hypothetical future-migration scenario, reviewer rated it "doing exactly what it was designed to do."
- [DISCARDED] [low] TYPE: `daily-goals` `ComputeResult` blocked-reason union includes `sex_unset` which `doCompute` never returns (`daily-goals.ts:59`) — not dead: it's part of the shared reason surface and handled defensively by UI components; zero runtime impact, removing it risks UI narrowing.
- [DISCARDED] [low] CONVENTION: stale `fitbitConnected`/`hasFitbitCredentials` mock in `shared-food` test — cosmetic stale-naming, the route never reads those fields; outside the Task 19 sweep file list, no correctness impact (noted, not fixed).

### Linear Updates
- FOO-1117 … FOO-1135 (19 issues): Review → Merge (all original tasks completed)
- FOO-1136: Created in Merge (Fix: edit-food HEALTH_LOG_NOT_FOUND drift → 500, fixed inline)
- FOO-1137: Created in Merge (Fix: shared-food Cache-Control, fixed inline)
- FOO-1138: Created in Merge (Fix: log-food/food-history scope-gate tests, fixed inline)
- FOO-1139: Created in Backlog (deferred: durationMs observability)

### Inline Fix Verification
- Unit tests: 3537 pass (193 files) — +6 new tests (3 edit-food drift, 1 shared-food Cache-Control, 1 log-food 403, 1 food-history 403)
- typecheck: clean · lint: clean (zero warnings)
- bug-hunter: no bugs found in the inline fixes (drift fall-through control flow, error selectivity, Cache-Control branch isolation, and mock accuracy all verified)

<!-- REVIEW COMPLETE -->

---

## E2E Release Gate — FAILED (3 tests) → Fix Plan below

The unit/lint/typecheck gates and the review are all green, but the **E2E suite found 3 real failures** in `e2e/tests/goal-anchored-engine.spec.ts` (132 passed). The plan is therefore **NOT marked COMPLETE** — these must be fixed before the PR/release. Both root causes are understood and filed (FOO-1140, FOO-1141).

**Failures (all in goal-anchored-engine.spec.ts):**
1. `shows GoalsSetupBanner on the dashboard when goal settings are not set` (`/app`)
2. `TargetsCard shows the goals_not_set blocked message on settings` (`/settings`)
3. `DailyGoalsCard renders with all three input controls` (`/settings`)

**Root causes:**
- **(1) & (2)** — The new write-route scope gate (Task 10 / FOO-1126) 403s the health-gated reads for the E2E test user, because the E2E seed (`e2e/fixtures/db.ts:177`) grants a single **stale Fitbit-era scope** (`…/auth/fitness.nutrition.write`) that doesn't match `GOOGLE_HEALTH_SCOPES`. `/api/nutrition-goals` 403s before it can return the `goals_not_set` 200 result, so the banner/blocked-message never render. Test-infra gap exposed by the new gate.
- **(3)** — Regression from Task 16 (FOO-1132): `daily-goals-card`'s `if (profileError) return <error>` early-return replaces the whole card (incl. the profile-independent goal inputs) whenever `/api/health-profile` fails (in E2E the fake token fails the real read). The user can't set goals at all — contradicts Task 15.

---

## Fix Plan

**Source:** E2E release-gate failures from the completion check (post-review).
**Linear Issues:** [FOO-1140](https://linear.app/lw-claude/issue/FOO-1140), [FOO-1141](https://linear.app/lw-claude/issue/FOO-1141)

### Fix 1: E2E seed grants a stale single scope → new scope gate 403s the goals UI reads
**Linear Issue:** [FOO-1140](https://linear.app/lw-claude/issue/FOO-1140)

1. Update `e2e/fixtures/db.ts` (`healthTokens` seed, ~line 177): set `scope` to the full `GOOGLE_HEALTH_SCOPES` joined by spaces (derive from `@/lib/auth`) — or `null` (RFC 6749 all-granted, honored by `checkHealthConnection`, FOO-1127). Prefer the full set (most realistic).
2. Re-run `npm run e2e`; confirm the dashboard-banner and TargetsCard-blocked-message tests pass.

### Fix 2: daily-goals-card hides goal inputs on profile-read failure
**Linear Issue:** [FOO-1141](https://linear.app/lw-claude/issue/FOO-1141)

1. Write a component test (`src/components/__tests__/daily-goals-card.test.tsx`): when the `/api/health-profile` SWR errors, the sex/activity radios + goal weight/rate + Save still render, and a non-blocking "preview unavailable" notice is shown. (Expect fail.)
2. In `src/components/daily-goals-card.tsx`, remove the full-card `profileError` early-return (~lines 204-221). Render the normal card regardless of `profileError`; suppress only the live preview and show the inline notice. Keep the `settingsError` hard-error (that one genuinely gates the inputs).
3. Run vitest (expect pass), then `npm run e2e` (with Fix 1 applied) — confirm the DailyGoalsCard-renders test passes.

**Note:** This Fix Plan is independent of the already-completed review fixes (FOO-1136/1137/1138, fixed inline). The 19 original migration-fix tasks (FOO-1117..1135) remain done; only the E2E gate blocks completion.

---

## Fix Plan — Iteration 1

**Implemented:** 2026-06-02
**Method:** Single-agent (2 fixes across 2 independent units, effort score 3 — below the worker threshold; Fix 1 is E2E-fixture-only, which is lead-exclusive)

### Tasks Completed This Iteration
- **Fix 1 (FOO-1140):** E2E seed scope — `e2e/fixtures/db.ts` `healthTokens` seed `scope` changed from the single stale Fitbit-era scope (`.../fitness.nutrition.write`) to the full Google Health set via `GOOGLE_HEALTH_SCOPES.join(' ')` (imported from `@/lib/auth`). `checkHealthConnection` now reports `healthy` for the E2E user, so the write-route scope gate (FOO-1126) admits the goals-UI reads (`/api/nutrition-goals`, `/api/health-profile`) instead of 403-ing them.
- **Fix 2 (FOO-1141):** `daily-goals-card` no longer blanks on profile-read failure — removed the full-card `profileError` early-return (the FOO-1132 regression). The card now always renders the goal inputs + Save regardless of `profileError`; the live target preview is already suppressed when `profileData` is absent, and a non-blocking `role="status"` notice ("…live preview unavailable. You can still set and save your goals.") is shown. `settingsError` still hard-errors the card (it genuinely gates the inputs). Unused `mutateProfile` destructure removed (zero-warnings).

### Files Modified
- `e2e/fixtures/db.ts` — import `GOOGLE_HEALTH_SCOPES`; seed full health scope set
- `src/components/daily-goals-card.tsx` — remove `profileError` early-return; add non-blocking preview-unavailable notice; drop unused `mutateProfile`
- `src/components/__tests__/daily-goals-card.test.tsx` — replaced the FOO-1132 full-card-error assertions with non-blocking-behavior tests (inputs render + notice shown + preview hidden + Save enabled) and added a `settingsError`-still-blocks guard

### Linear Updates
- FOO-1140: Todo → In Progress → Review
- FOO-1141: Todo → In Progress → Review

### Pre-commit Verification
- **bug-hunter:** No bugs found. Verified `profileUnavailable`/`canPreview` mutual exclusivity, `role="status"` correctness (non-urgent degradation, not an error), no dangling `mutateProfile` reference, and the E2E seed → `checkHealthConnection: healthy` chain.
- **verifier (unit + lint + build):** 3,540 tests pass (193 files), lint clean, build clean — zero warnings.
- **verifier "e2e":** All 135 E2E tests pass — the 3 previously-failing `goal-anchored-engine.spec.ts` tests (dashboard GoalsSetupBanner, TargetsCard goals_not_set message, DailyGoalsCard three input controls) are now green.

### Continuation Status
**All Fix Plan tasks complete (FOO-1140, FOO-1141).** The E2E release gate is now GREEN — all 135 E2E tests pass. With the 19 original migration-fix tasks (FOO-1117..1135) and the 3 inline review fixes (FOO-1136/1137/1138) already done, the full plan is implementation-complete.
**Release gate unchanged:** the FOO-1115 staging smoke test (`HEALTH_DRY_RUN=false`, real Google Health round-trip — create→read-back→edit→delete→confirm-gone) remains a hard manual gate before `push-to-production`, reconciling the live response shapes flagged in Tasks 4/6/9/18.

### Review Findings

Files reviewed: 3 (`e2e/fixtures/db.ts`, `src/components/daily-goals-card.tsx`, `src/components/__tests__/daily-goals-card.test.tsx`)
Reviewer: single-agent (3 files, no security-sensitive changes)
Checks applied: Security, Logic, Async, Resources, Type Safety, Conventions

No issues found — both fixes are correct and follow project conventions.

- **Fix 1 (FOO-1140):** the seed now sets `scope: GOOGLE_HEALTH_SCOPES.join(' ')`, byte-identical to the production OAuth format (`auth.ts:33`). `checkHealthConnection` splits on `/\s+/` and finds every required scope → `healthy`. No E2E test asserts on `scope_mismatch`/403, so the seed change neutralizes no existing coverage; the 403 scope-gate path stays covered by unit tests (FOO-1138).
- **Fix 2 (FOO-1141):** removing the full-card `profileError` early-return is safe — `canPreview` requires `profileData !== undefined` (`daily-goals-card.tsx:100`), which is always false when SWR carries an error on first load, so the live preview and the new `role="status"` notice are mutually exclusive (no contradictory double-render in the normal failure path). Save remains gated only by `saving || isRequiredFieldsMissing`; `settingsError` still hard-errors the card and is now protected by a regression test. Unused `mutateProfile` destructure removed (zero-warnings).

**Discarded findings (genuinely not bugs):**
- [DISCARDED] EDGE-CASE: SWR could in theory hold stale `profileData` *and* an `error` simultaneously (successful load followed by a failing revalidation), rendering both the live preview and the "preview unavailable" notice. Defensible degradation (last-known preview + a notice that the refresh failed), not a correctness bug, and not reachable on the first-load-failure path the fix targets. No change.

### Linear Updates
- FOO-1140: Review → Merge
- FOO-1141: Review → Merge

<!-- REVIEW COMPLETE -->

---

## Status: COMPLETE

All tasks implemented and reviewed successfully across Iterations 1–2 plus the E2E-gate Fix Plan. All 24 Linear issues moved to Merge (FOO-1117..1138, FOO-1140, FOO-1141; FOO-1139 deferred to Backlog). E2E release gate green (135/135). The FOO-1115 staging smoke test (`HEALTH_DRY_RUN=false`, real Google Health round-trip) remains the only hard manual gate before `push-to-production`.
