# Implementation Plan

**Created:** 2026-05-05
**Source:** Bug report: Carbs and calorie goals appear at zero on the dashboard every morning until Fitbit's cumulative `caloriesOut` clears `RMR × 1.05`.
**Linear Issues:** [FOO-1036](https://linear.app/lw-claude/issue/FOO-1036)
**Branch:** fix/foo-1036-always-on-calorie-goals

## Context Gathered

### Codebase Analysis

- **Hot files:**
  - `src/lib/daily-goals.ts` — core engine compute path, `partial` branch, ratchet, invalidation, mapper
  - `src/db/schema.ts` — `daily_calorie_goals` table definition
  - `src/types/index.ts` — `NutritionGoals` and `ComputeResult` shapes
  - `src/components/targets-card.tsx` — only UI surface that handles `partial` explicitly
  - `src/lib/chat-tools.ts` — branches on `partial` for nutrition summary tool
  - `src/lib/nutrition-goals.ts` — `getDailyGoalsByDateRange` (range-mode v1 reads)
  - `src/app/api/v1/nutrition-goals/route.ts` — range-mode caller of `getDailyGoalsByDateRange`
  - `src/lib/macro-engine.ts` — `computeMacroTargets` + `computeRmr` (no changes needed; reused by seed path)
- **Existing patterns:**
  - All DB access through `src/lib/`. Route handlers never touch `src/db/` directly.
  - Drizzle migrations generated with `npx drizzle-kit generate` (lead-only after schema change).
  - In-flight `Promise` dedupe map keyed `${userId}:${date}` already covers the seeded path (no change).
  - Vitest tests colocated in `__tests__/` siblings — see `src/lib/__tests__/daily-goals.test.ts` and `src/lib/__tests__/macro-engine.test.ts`.
  - SWR + standardized `apiFetcher` for client reads — no client wiring change required because the response stays a valid `ok` shape.
- **Test conventions:**
  - `daily-goals.test.ts` mocks Drizzle with string literals in `where()` clauses (CLAUDE.md known accepted pattern).
  - DB row construction goes through `getDb().insert/update`. Tests stub DB calls; macro engine is exercised directly with deterministic inputs.

### MCP Context

- **MCPs used:** Railway (production deploy logs), Linear (issue search)
- **Findings:**
  - Production logs for Lucas (userId `6bc0189f-...`) on `2026-05-05`: every read since 02:12 UTC returned `status="partial"` from both `/api/nutrition-goals` and `/api/v1/nutrition-goals`. No `daily_goals_computed` log entry exists for that date — engine never reached the full compute branch. Activity-summary fetches for today succeeded (no error), confirming the gate (`caloriesOut < RMR × 1.05`) is what blocks the compute.
  - The earlier `ok` reads at 02:15 UTC (= 23:15 BRT May 4, end of day in user TZ) confirm the partial state is purely time-of-day driven, not a write-side or Fitbit error.
- **Linear:** No open issue covers always-on goals. FOO-997 ("TargetsCard hides protein/fat in partial") and FOO-1002 ("Chat tools don't surface partial macros") were narrower follow-ups that are now superseded — the entire `partial` status is being removed.

### Investigation

**Bug report:** Calorie and carb goals show as 0 (no goal indicator) on the dashboard. The user expects a goal to be present at all times.

**Classification:** Frontend Bug + Data Issue / **High** (every user, every morning, until afternoon) / Macro engine + dashboard rendering

**Root cause:** The macro engine returns `status: "partial"` whenever today's cumulative `caloriesOut < RMR × 1.05` (FOO-999 gate). Fitbit's `caloriesOut` is cumulative-since-midnight — for a typical adult (RMR ≈ 1700 kcal) the threshold (≈ 1785) doesn't clear until afternoon. The mapper translates `partial` to `{ calories: null, carbsG: null, proteinG: <number>, fatG: <number> }`. The dashboard renders the two `null`s as "no goal" (plain calorie display, relative-bar carbs), which the user reads as "goals at zero". Only the settings-page `TargetsCard` has explicit "partial" copy; the dashboard never explains the missing goals.

**Evidence:**
- `src/lib/daily-goals.ts:438–456` — the `partial` branch: `if (activity === null || activity.caloriesOut === null || activity.caloriesOut < rmrThreshold)` returns `{status:"partial",proteinG,fatG}` and writes nothing.
- `src/lib/daily-goals.ts:734–741` — mapper emits `calories: null, carbsG: null` for `partial`.
- `src/components/daily-dashboard.tsx:289–313` — `goals?.calories != null` toggles the calorie ring; `MacroBars` falls back to relative widths when `goal === undefined || goal <= 0`.
- `src/components/macro-bars.tsx:33–45` — `hasGoal = goal !== undefined && goal > 0` controls whether the `X / Yg` label or just `Xg` is rendered.
- `src/lib/daily-goals.ts:80–168` — `tryRatchetRecompute` only ratchets UP from a stored row; never demotes a high estimate.
- `src/lib/daily-goals.ts:611–683` — `invalidateUserDailyGoalsForDate` and `invalidateUserDailyGoalsForProfileChange` zero `calorieGoal` and null macros (existing sentinel for "recompute me").
- `src/db/schema.ts:156–180` — `daily_calorie_goals` lacks any column to distinguish a row computed from today's live data vs a row seeded from a fallback.

**Impact:** Dashboard never shows a calorie ring or carbs goal until mid-afternoon for any user, every day. Affects both Lucas and Mariana on production right now. Defeats the purpose of the macro engine (FOO-992 → FOO-1010 release) for the morning use-case and breaks the showcase narrative.

## Tasks

> **Implementation order:** Tasks must be done sequentially. Task 1 (schema) is a prerequisite for everything else; Task 2 (seed resolver) is the new pure-logic primitive used by Task 3 and 4; Task 5 (mapper + types) is what unlocks the cleanup tasks (6, 7, 8). Task 9 is the operational migration. The plan is intentionally small enough for single-agent implementation.

---

### Task 1: Add `tdee_source` column to `daily_calorie_goals`

**Linear Issue:** [FOO-1036](https://linear.app/lw-claude/issue/FOO-1036)

**Files:**
- `src/db/schema.ts` (modify)
- `drizzle/<auto>.sql` (generated by `drizzle-kit generate` — **lead/single-agent only**, never hand-write)
- `drizzle/meta/_journal.json` (generated)
- `drizzle/meta/<auto>_snapshot.json` (generated)
- `MIGRATIONS.md` (modify — append entry)

**Steps:**
1. Add `tdeeSource: text("tdee_source")` to `dailyCalorieGoals` (nullable, no default). Place after `weightLoggedDate`.
2. Run `npx drizzle-kit generate` to produce the new migration + snapshot.
3. Append a MIGRATIONS.md entry: schema-only `ADD COLUMN`, nullable, no backfill (legacy rows = NULL = treated as `'live'` by the read path).

**Notes:**
- `tdee_source` valid values (enforced in TS, not via CHECK initially to keep the migration trivial): `'live' | 'history' | 'default'`. Legacy rows = NULL.
- **Migration note:** New nullable column on `daily_calorie_goals`. No data backfill required. Production `ALTER TABLE` is safe under load (PostgreSQL fast-path for NULL columns).

---

### Task 2: TDEE seed resolver

**Linear Issue:** [FOO-1036](https://linear.app/lw-claude/issue/FOO-1036)

**Files:**
- `src/lib/daily-goals.ts` (modify — add `resolveTdeeSeed` near other private helpers)
- `src/lib/__tests__/daily-goals.test.ts` (modify — new `describe("resolveTdeeSeed")` block)

**Steps:**
1. Write tests first covering, for an arbitrary `userId`, RMR, weight:
   - **history-median path:** when DB returns ≥ 1 prior `daily_calorie_goals` row with `tdeeSource = 'live'` and non-null `caloriesOut` from the last 7 days strictly before the target date — returns `{ source: "history", value: <median> }`. Median over 1–7 values, ignoring nulls; for an even count, the lower of the two middle values (avoid float arithmetic, integer-clean).
   - **history excludes today:** a `live` row for `date === target` must not contribute (today's row is the one we're seeding).
   - **history excludes non-live:** rows with `tdeeSource = 'history' | 'default'` (or NULL with `caloriesOut` null) are skipped. NULL `tdeeSource` rows that *do* have a non-null `caloriesOut` ARE included (legacy rows pre-migration are treated as `'live'`).
   - **default fallback:** when zero qualifying history rows — returns `{ source: "default", value: round(rmr * 1.4) }`.
   - **lookback ordering:** function pulls `WHERE date < target AND date >= target - 7 days AND userId = ...`. Ensure SQL uses inclusive-from / exclusive-to and is ORDER BY date DESC LIMIT 7.
2. Implement `resolveTdeeSeed(userId, targetDate, rmr, log): Promise<{ source: "history" | "default"; value: number }>`. New module-level constant `DEFAULT_ACTIVITY_MULTIPLIER = 1.4` exported from `daily-goals.ts` (or co-located near `tryRatchetRecompute`).
3. Run vitest `daily-goals` (expect pass).

**Notes:**
- Pure read; never mutates. Caller decides whether to insert/update.
- 7-day window chosen: balances responsiveness to weight/activity changes with robustness against single anomalous days. Median (not mean) hardens against a single very-high or very-low day.
- Logger: `debug` log on resolution `{action:"tdee_seed_resolved", source, value, sampleSize}` — useful for production telemetry.

---

### Task 3: Replace `partial` branch with seeded compute (write path)

**Linear Issue:** [FOO-1036](https://linear.app/lw-claude/issue/FOO-1036)

**Files:**
- `src/lib/daily-goals.ts` (modify — replace lines `438–456` partial branch and the surrounding insert/update logic)
- `src/lib/__tests__/daily-goals.test.ts` (modify — replace partial tests with seed tests)

**Steps:**
1. Write tests first:
   - **first-day cold start:** no history → `resolveTdeeSeed` returns `default`. `doCompute` returns `{status: "ok", goals, audit, isSeeded: true}`. Row is INSERTed with `tdeeSource = 'default'`, `caloriesOut = round(rmr*1.4)`, `activityKcal/rmr/tdee` consistent with that input.
   - **second day with prior live row:** `resolveTdeeSeed` returns `history`. Row has `tdeeSource = 'history'`, `caloriesOut = <median>`.
   - **caloriesOut just under threshold:** seeded compute, not full-compute path — verify the engine input was the seed value, not Fitbit's reported partial value.
   - **caloriesOut clears threshold (live path):** existing test stays — row has `tdeeSource = 'live'`. Add new assertion that the column is set.
   - **invalid_activity (FOO-1030):** stays as `blocked/invalid_activity` — seeding does not bypass the explicit invalid gate above (negative/NaN/Infinity/>30000).
   - **blocked states:** `sex_unset`, `no_weight`, `scope_mismatch`, `invalid_profile` — unchanged. Seeding requires sex+weight+height to compute RMR.
2. Implementation:
   - At line 438ish, after the `INVALID_ACTIVITY_DATA` gate, replace the `partial`-returning branch with:
     - Compute `rmr = computeRmr(...)` once (already done in surrounding code).
     - When `activity === null || activity.caloriesOut === null || activity.caloriesOut < rmrThreshold`, call `resolveTdeeSeed(userId, date, rmr, l)` and feed `seed.value` into `computeMacroTargets` as `caloriesOut`. Status becomes `ok` and `isSeeded = true`.
     - Otherwise (live path) — current code. `tdeeSource = 'live'`, `isSeeded` omitted/false.
   - INSERT/UPDATE: include `tdeeSource: <"live"|"history"|"default">` in the values. The existing `INSERT ... ON CONFLICT DO NOTHING` + read-back UPDATE sequence already handles concurrency; preserve it.
   - Update `ComputeResult` `ok` variant to add `isSeeded?: boolean` (Task 5 covers the type).
3. Run vitest (expect pass), then `npm run typecheck`.

**Notes:**
- The existing `versionStale` and `!hasMacros(row)` UPDATE guards (lines 517–538) still apply. Add `tdeeSource` to the UPDATE `set` block.
- The `preserve-non-zero` rule on line 524 (`!hasMacros(row) && row.calorieGoal > 0 ? row.calorieGoal : engineOut.targetKcal`) was for legacy Lumen rows. Keep it but make sure seeded rows always overwrite `calorieGoal` with `engineOut.targetKcal` regardless — easiest by checking `row.tdeeSource !== 'live'` (treating NULL as `'live'`).
- `daily_goals_computed` log line should include `tdeeSource` and (when seeded) `seedSource`.

---

### Task 4: Promotion logic (cache-hit path + ratchet)

**Linear Issue:** [FOO-1036](https://linear.app/lw-claude/issue/FOO-1036)

**Files:**
- `src/lib/daily-goals.ts` (modify — cache-hit branch around lines `268–395` and `tryRatchetRecompute` around lines `80–168`)
- `src/lib/__tests__/daily-goals.test.ts` (modify — extend ratchet tests + new promotion tests)

**Steps:**
1. Write tests first:
   - **promotion overrides downward:** existing row `tdeeSource='history'` with `calorieGoal=2400`. Today's live `caloriesOut` now clears `RMR × 1.05` and `engineOut.targetKcal=2100`. The cache-hit path must UPDATE the row (not just ratchet) → new row has `calorieGoal=2100`, `tdeeSource='live'`, `caloriesOut=<live>`. Assert: returned `goals.calorieGoal === 2100`.
   - **promotion overrides upward:** same setup, `engineOut.targetKcal=2700` → new row has `calorieGoal=2700`, `tdeeSource='live'`. (Same outcome as ratchet, but reached via the promotion code path.)
   - **already-live row, ratchet UP only (regression):** existing row `tdeeSource='live'` with `calorieGoal=2200`. Live `engineOut.targetKcal=2500` → ratchets to 2500. Live `engineOut.targetKcal=2000` → no change. Assert no demotion.
   - **already-live row, live caloriesOut now below threshold:** if Fitbit returns a smaller `caloriesOut` after the row is live (rare but possible on a same-day refresh edge), the row stays as-is. Promotion is one-way per FOO design.
   - **legacy NULL `tdeeSource`:** treated as `'live'` — never re-seeded, only ratcheted. Add explicit test.
   - **historical date (target < today):** never promotes, never re-seeds, never ratchets — historical rows stay frozen (existing FOO-1034 / FOO-995 invariant). Add explicit test if not already covered.
2. Implementation:
   - In the cache-hit branch, after the existing FOO-1009 ratchet attempt and before `return ok`:
     - If `targetIsToday` AND `existing.tdeeSource !== 'live'` (treat NULL as `'live'`) AND today's live snapshot clears `caloriesOut >= RMR × 1.05`: run a fresh `computeMacroTargets`, UPDATE the row with the live values and `tdeeSource = 'live'`, return the new values.
     - The ratchet remains unchanged for `tdeeSource === 'live'` rows (or legacy NULL).
   - Promotion is a one-shot UPDATE; subsequent reads hit the live branch.
3. Run vitest, typecheck.

**Notes:**
- Promotion must run BEFORE the ratchet attempt for seeded rows — otherwise the ratchet's "only-UP" rule could veto a legitimate downward correction. Order: detect `tdeeSource !== 'live'` and live-clears-threshold → promote; else if `tdeeSource === 'live'` → consider ratchet UP; else return cached values.
- Reuse `liveActivity`, `liveProfile` from the existing `Promise.allSettled` block (lines 289–295) — no extra Fitbit call.
- The promotion path implicitly subsumes FOO-1034 (today-only) because the cache-hit branch already gates on `targetIsToday` for the activity fetch.

---

### Task 5: Drop `partial` from public types and mapper

**Linear Issue:** [FOO-1036](https://linear.app/lw-claude/issue/FOO-1036)

**Files:**
- `src/types/index.ts` (modify — `NutritionGoals.status` union)
- `src/lib/daily-goals.ts` (modify — `ComputeResult` union, `mapComputeResultToNutritionGoals`)
- `src/lib/__tests__/daily-goals.test.ts` (modify — remove partial-branch mapper tests)

**Steps:**
1. Write tests first (mapper):
   - `ok` with `isSeeded: true` → `NutritionGoals` carries `status: "ok"`, all four numbers populated, `isSeeded: true` propagated.
   - `ok` without `isSeeded` → no `isSeeded` field on the response (or `false`).
   - `blocked` reasons unchanged (`no_weight`, `sex_unset`, `scope_mismatch`, `invalid_profile`, `invalid_activity`, `not_computed`).
2. Implementation:
   - `NutritionGoals.status`: `"ok" | "blocked"` (drop `"partial"`).
   - `NutritionGoals`: add `isSeeded?: boolean`. `calories` and `carbsG` types stay `number | null` (still `null` in `blocked`).
   - `ComputeResult`: drop the `partial` variant. Add `isSeeded?: boolean` to the `ok` variant.
   - `mapComputeResultToNutritionGoals`: delete the `partial` branch entirely; pass through `isSeeded` from `ok` to `NutritionGoals`.
3. Run vitest, typecheck.

**Notes:**
- This will produce TypeScript errors at every consumer that handles `partial` — those consumers are cleaned up in tasks 6–8 below. Sequence the merge so all are landed together (single PR, single agent).
- v1 `RangeEntry` derives via `Pick<NutritionGoals, "status" | "reason" | ...>` so it follows automatically — no edit needed in `src/app/api/v1/nutrition-goals/route.ts:20–23` beyond verifying the `Pick` still type-checks.

---

### Task 6: Remove `partial` handling from `TargetsCard`

**Linear Issue:** [FOO-1036](https://linear.app/lw-claude/issue/FOO-1036)

**Files:**
- `src/components/targets-card.tsx` (modify)
- `src/components/__tests__/targets-card.test.tsx` (modify — drop "partial" test, keep blocked + ok)

**Steps:**
1. Write tests first:
   - When `goals.status === "ok"` and `isSeeded: true`, rendered output is **identical** to the non-seeded case (silent UI per project decision). All four numbers visible.
   - Existing `blocked` tests remain.
   - Existing partial tests removed (no longer reachable).
2. Implementation:
   - Delete the `if (goals.status === "partial")` branch (lines `82–94`).
   - Remove `proteinG/fatG != null` defensive checks in the `ok` branch — calories/carbs/protein/fat are all numbers in `ok`.
   - Do NOT add a "seeded" badge or copy. Silent.
3. Run vitest.

**Notes:**
- `getBlockedMessage` keeps all existing reasons. No copy change.

---

### Task 7: Remove `partial` handling from `chat-tools.ts`

**Linear Issue:** [FOO-1036](https://linear.app/lw-claude/issue/FOO-1036)

**Files:**
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify if a partial test exists)

**Steps:**
1. Write tests first:
   - Single-date `get_nutrition_summary` with seeded `ok` result emits the same string format as the live `ok` case — protein, carbs, fat, calorie all surfaced. No "pending Fitbit activity sync" copy anymore.
   - `blocked` branch unchanged.
2. Implementation:
   - In `chat-tools.ts:233–264`, delete the `else if (result.status === "partial")` branch entirely. The remaining `else` covers `blocked`.
   - The single `ok` branch already produces complete output — no change needed there other than removing the dead conditional `> 0` checks if the `result.goals.X` are now guaranteed positive. (Conservative: keep the `> 0` guards — they're cheap defense-in-depth.)
3. Run vitest.

**Notes:**
- The FOO-1002 comment block above this code says partial returns no row — that's now obsolete. Replace the comment with a one-liner explaining the engine always returns `ok` for valid users (or remove the comment).

---

### Task 8: Drop `rmrThreshold` and `partial` plumbing from `daily-goals.ts`

**Linear Issue:** [FOO-1036](https://linear.app/lw-claude/issue/FOO-1036)

**Files:**
- `src/lib/daily-goals.ts` (modify)
- `src/lib/__tests__/daily-goals.test.ts` (modify)

**Steps:**
1. Confirm via grep that no remaining caller / test references `partial` or `rmrThreshold` once Task 5 is in.
2. Implementation:
   - The `rmrThreshold` constant survives **inside** `tryRatchetRecompute` (the original FOO-1009 / FOO-999 reasoning still applies for the ratchet — we don't ratchet UP from a noisy partial-day reading) and **inside** the seed-vs-live decision in `doCompute`. It is no longer a `partial`-status gate. Make sure it is not duplicated; extract to a private const if useful.
   - Delete the inline FOO-999 comment block in `doCompute` that explains "Partial: protein/fat only, no calorie target" (lines `438–456`) and replace with a brief note on the seed/live decision.
   - The FOO-1030 invalid-activity gate (lines `428–436`) **stays** — runs *before* the seed/live decision. Negative/NaN/>30000 still routes to `blocked/invalid_activity`. Add a regression test if not already present.
3. Run vitest, typecheck, lint.

**Notes:**
- Keep `invalidateUserDailyGoalsForDate` and `invalidateUserDailyGoalsForProfileChange` setting `tdeeSource: null` (alongside the existing nulled fields) so the next read re-seeds cleanly.

---

### Task 9: Backfill production hint (no schema migration, only telemetry)

**Linear Issue:** [FOO-1036](https://linear.app/lw-claude/issue/FOO-1036)

**Files:**
- `MIGRATIONS.md` (modify — already done in Task 1; verify completeness)

**Steps:**
1. Verify MIGRATIONS.md entry covers:
   - Schema: `ALTER TABLE daily_calorie_goals ADD COLUMN tdee_source text` — nullable, no default. Generated by `drizzle-kit`.
   - Data: no backfill needed. Legacy rows have `tdee_source = NULL`, treated as `'live'` (never re-seeded; only ratchet UP applies).
   - Behavior: starting on the first read after deploy, today's row will be re-INSERTed (or UPDATEd) with `tdee_source = 'history' | 'default' | 'live'`. The status `partial` is gone — every authenticated user with sex/weight/height set will see a goal.
2. No further migration tasks.

**Notes:**
- Production safety: the FOO-995 historical-rows-stay-zeroed invariant is preserved. Historical rows with `calorie_goal = 0` and null macros stay as-is until a user navigates to that day; on view, they hit the seeded path (since `caloriesOut` for a past date has either been recorded by Fitbit or won't ever be — the seed path covers both cases via history-median or default fallback).

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent — review changes for bugs (focus on race-safety, NULL/legacy-row handling, schema-side effects).
2. Run `verifier` agent — `npm test`, `npm run lint`, `npm run build` (zero warnings).
3. Confirm by hand-grep: no remaining `"partial"` literal in `src/types`, `src/lib`, `src/app`, `src/components` other than unrelated uses (e.g., `claude.ts:1180` "partial response" log line, which is unrelated to nutrition).
4. Run `verifier "e2e"` — TargetsCard spec under `e2e/tests/` should still pass with the partial-branch removed (it tests `ok` and `blocked` only, but verify).

---

## Plan Summary

**Objective:** Eliminate the `partial` engine status so the dashboard always shows calorie + carbs goals, even before Fitbit's cumulative `caloriesOut` clears `RMR × 1.05`.

**Linear Issues:** FOO-1036

**Approach:** Add a `tdee_source` column to `daily_calorie_goals` to track whether the row's TDEE came from today's live Fitbit data, the user's 7-day history median, or a `RMR × 1.4` default. Replace the engine's `partial` branch with a seeded full-compute (status: `ok`, `isSeeded: true`). On any subsequent read where today's live `caloriesOut` finally clears the threshold, **promote** the row by overwriting it with live values (one-way per design — `'live'` rows then ratchet UP only, preserving FOO-1009 stability). Drop `"partial"` from `NutritionGoals.status` and `ComputeResult` and remove every dead branch in TargetsCard, chat-tools, daily-goals, and tests.

**Scope:** 9 tasks, ~7 source files + 1 schema/migration pair, ~5 test files updated, 1 nullable column added.

**Key Decisions:**
- Hardcoded `DEFAULT_ACTIVITY_MULTIPLIER = 1.4` (lightly active) — no per-user setting.
- 7-day **median** of `caloriesOut` from `tdeeSource = 'live'` rows (legacy NULL rows count as `'live'`).
- **Silent UI**: `isSeeded` flows through to clients but no badge or "estimated" copy is rendered.
- **One-way promotion**: once a row reaches `tdeeSource = 'live'`, it never demotes — preserves the FOO-1009 ratchet-up invariant.
- "Leave no dead core behind" — `partial` is fully removed from types, mapper, UI, chat-tools, and tests in the same change.

**Risks:**
- **Seed inflation early in the day**: if yesterday's `caloriesOut` was unusually high, today's seeded goal is generous. Mitigated by the promotion-on-threshold-clear, which overwrites the row with today's actual the moment live data is reliable. Median (not mean) hardens against single-day outliers.
- **First-day cold start uses `RMR × 1.4`**: not personalized, but always within a safe TDEE range (no sub-RMR target risk because the seed itself is `≥ RMR × 1.4`, well above `RMR × 1.05`).
- **Legacy rows treated as `'live'`**: existing zeroed-historical rows from FOO-995 still recompute lazily on view via the seeded path (since `caloriesOut` for past dates is either recorded by Fitbit or unrecoverable, and the seed path handles both).
- **Concurrency**: existing in-flight Promise dedupe + `INSERT ... ON CONFLICT DO NOTHING + read-back UPDATE` sequence covers both seeded and live writes. The promotion UPDATE is a same-row mutation gated on `targetIsToday + tdeeSource !== 'live' + threshold-cleared`; no new race window introduced.

---

## Iteration 1

**Date:** 2026-05-05
**Method:** single-agent
**Status:** COMPLETE

### Tasks Completed

1. **Task 1** — Added `tdee_source text` column to `daily_calorie_goals` (nullable, no default). Generated migration `drizzle/0025_wonderful_franklin_storm.sql` via `drizzle-kit generate`. Appended MIGRATIONS.md entry.
2. **Task 2** — Implemented `resolveTdeeSeed(userId, targetDate, rmr, log)` in `src/lib/daily-goals.ts`. Pure read; pulls 7-day lookback rows ordered DESC, filters to `tdeeSource ∈ {null, 'live'}` with non-null `caloriesOut`, returns median (lower of two middle on even count) or `round(rmr × 1.4)` fallback. Exported `DEFAULT_ACTIVITY_MULTIPLIER = 1.4`. Added 8 tests covering history-median, single-row median, even-count lower-of-two-middle, non-live exclusion, default fallback, lookback window bounds.
3. **Task 3** — Replaced the `partial` branch in `doCompute` with a seed-vs-live decision. Added the `tdeeSource` field to `INSERT` and the post-conflict `UPDATE`. The Lumen-row `calorieGoal` preservation rule now also gates on `existingIsSeededRow` (treats NULL as legacy/live → preserve, treats `'history'/'default'` → overwrite). 7 new tests for seeded compute (cold start, history median, just-under-threshold, threshold cleared = live, audit.caloriesOut surfaces seed value, default-MAINTAIN goalType, FOO-1030 invalid-activity precedence).
4. **Task 4** — Added `tryPromoteSeededRow` helper. Cache-hit branch runs promotion BEFORE ratchet for seeded rows: when `targetIsToday && storedIsSeeded && live caloriesOut ≥ RMR × 1.05`, the row is overwritten with live values regardless of direction (downward or upward). Ratchet (FOO-1009) is now gated on `!storedIsSeeded`. `isSeeded` cleared on successful promotion. 7 promotion tests (downward override, upward override, threshold-not-cleared, no live activity, historical-date frozen, legacy-NULL ratchet still works, legacy-NULL no-change regression). 3 cache-hit isSeeded propagation tests.
5. **Task 5** — `NutritionGoals.status` reduced to `"ok" | "blocked"`. Added `isSeeded?: boolean` to both `NutritionGoals` and `ComputeResult.ok`. Mapper drops the `partial` branch and propagates `isSeeded`. `ActivitySummary` doc comment updated.
6. **Task 6** — Removed the `partial` branch from `TargetsCard`. Silent UI for seeded ok (no badge, no "estimated" copy). Test replaced with seeded-ok rendering check.
7. **Task 7** — Removed the `partial` else-if branch from `chat-tools.ts get_nutrition_summary`. The "FOO-1002 partial" comment block replaced with a one-liner. Test replaced with seeded-ok format check.
8. **Task 8** — Verified no remaining `partial` references in source (only the FOO-1036 explainer comments and one unrelated "partial range params" in v1 route remain). Updated FOO-1030 invalid-activity gate comment to reference seed routing instead of partial. Cleaned a stale "partial state" comment in `src/lib/user-profile.ts`. Removed the now-unused `bmiTier` slow-path local in `doCompute` (the engine returns its own bmiTier and the partial branch that consumed it is gone).
9. **Task 9** — Verified MIGRATIONS.md entry: `ALTER TABLE … ADD COLUMN tdee_source text` (nullable, no default), no data backfill, behavior expectations documented.

### Test Results

- `npm test` — **3469 tests passed** across 191 test files (~115s)
- `npm run lint` — zero warnings, zero errors
- `npm run build` — succeeded, 59 static pages generated, no warnings
- `bug-hunter` — **0 bugs found**. Verified: race-safety in promotion (idempotent same-input writers, mirrors FOO-1009 precedent), NULL/legacy-row handling, calorieGoal preservation rule, UTC-correct date arithmetic in `resolveTdeeSeed`, promotion-before-ratchet ordering. Doc nit fixed (`user-profile.ts:91`).

### Files Changed

- `src/db/schema.ts`, `drizzle/0025_wonderful_franklin_storm.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0025_snapshot.json`
- `src/lib/daily-goals.ts` (heavy)
- `src/types/index.ts`
- `src/components/targets-card.tsx`
- `src/lib/chat-tools.ts`
- `src/lib/user-profile.ts` (one-line comment update)
- `src/lib/__tests__/daily-goals.test.ts` (+25 tests, ~3 partial tests replaced/removed)
- `src/components/__tests__/targets-card.test.tsx` (1 test replaced)
- `src/lib/__tests__/chat-tools.test.ts` (1 test replaced)
- `MIGRATIONS.md`

### Tasks Remaining

None. Plan is complete and ready for `plan-review-implementation` → PR.
