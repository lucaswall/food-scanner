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
