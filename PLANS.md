# Implementation Plan

**Created:** 2026-05-04
**Status:** ACTIVE
**Source:** Backlog: FOO-992, FOO-993, FOO-995, FOO-996, FOO-997, FOO-998, FOO-999, FOO-1000, FOO-1001, FOO-1002, FOO-1003, FOO-1005, FOO-1006, FOO-1007, FOO-1008, FOO-1009, FOO-1010
**Linear Issues:**
- [FOO-992](https://linear.app/lw-claude/issue/FOO-992) — "Refresh from Fitbit" doesn't recompute daily macro targets
- [FOO-993](https://linear.app/lw-claude/issue/FOO-993) — Audit goalType reflects current Fitbit goal, not stored
- [FOO-995](https://linear.app/lw-claude/issue/FOO-995) — Macro profile change invalidates ALL historical days
- [FOO-996](https://linear.app/lw-claude/issue/FOO-996) — Race window in profile-change invalidation
- [FOO-997](https://linear.app/lw-claude/issue/FOO-997) — TargetsCard hides protein/fat in "partial" status
- [FOO-998](https://linear.app/lw-claude/issue/FOO-998) — computeMacroTargets does not validate caloriesOut input
- [FOO-999](https://linear.app/lw-claude/issue/FOO-999) — caloriesOut=0 silently yields below-RMR target
- [FOO-1000](https://linear.app/lw-claude/issue/FOO-1000) — Audit doesn't expose raw caloriesOut
- [FOO-1001](https://linear.app/lw-claude/issue/FOO-1001) — macro_profile lacks DB CHECK constraint
- [FOO-1002](https://linear.app/lw-claude/issue/FOO-1002) — Chat tools don't surface partial macros to Claude
- [FOO-1003](https://linear.app/lw-claude/issue/FOO-1003) — SWR revalidate-on-focus risks rate-limit exhaustion
- [FOO-1005](https://linear.app/lw-claude/issue/FOO-1005) — BmiTier type duplicated in three locations
- [FOO-1006](https://linear.app/lw-claude/issue/FOO-1006) — Macro profile descriptions hardcoded in client
- [FOO-1007](https://linear.app/lw-claude/issue/FOO-1007) — Settings TargetsCard captures date once at render
- [FOO-1008](https://linear.app/lw-claude/issue/FOO-1008) — Unify external /api/v1/nutrition-goals
- [FOO-1009](https://linear.app/lw-claude/issue/FOO-1009) — Calorie target frozen at first morning compute
- [FOO-1010](https://linear.app/lw-claude/issue/FOO-1010) — Extend weight lookback to 14 days
**Branch:** feat/macro-engine-correctness

## Context Gathered

### Codebase Analysis

**Hot files (touched by ≥3 tasks):**
- `src/lib/daily-goals.ts` — orchestrator. `doCompute` (line 96), cache-hit fast path (100-155), partial path (183-190), full compute + INSERT/UPDATE (192-244), `invalidateUserDailyGoalsForProfileChange` (305-326), `getDailyGoalsByDate` (328-358).
- `src/lib/macro-engine.ts` — pure compute. `computeMacroTargets` (line 88), `ACTIVITY_MULTIPLIER`, `GOAL_MULTIPLIERS`, profile constants, `MACRO_PROFILES_BY_KEY`, `isMacroProfileKey`, `getMacroProfile`.
- `src/types/index.ts` — `MacroEngineInputs/Outputs` (588), `NutritionGoalsAudit` (608), `NutritionGoals` (617), `FitbitWeightLog` (572), `FitbitFoodGoals` (582 — to be deleted).
- `src/db/schema.ts` — `users.macroProfile` (line 22), `dailyCalorieGoals` (144).
- `src/components/targets-card.tsx` — entire file (130 lines).

**API routes:**
- `src/app/api/nutrition-goals/route.ts` — `mapResult(ComputeResult): NutritionGoals` helper (lines 9-38), full error mapping (71-100). Uses `getSession()` + `validateSession({ requireFitbit: true })`.
- `src/app/api/v1/nutrition-goals/route.ts` — Fitbit passthrough, calls `getFoodGoals(...)`. Uses `validateApiRequest()` + `checkRateLimit('v1:nutrition-goals:...', 30, 60_000)`.
- `src/app/api/fitbit/profile/route.ts` — `?refresh=1` calls `invalidateFitbitProfileCache(userId)` only.
- `src/app/api/macro-profile/route.ts` — PATCH writes `users.macroProfile` then calls `invalidateUserDailyGoalsForProfileChange`.

**Caches:** `src/lib/fitbit-cache.ts` — profile (24h), weight (1h), weight goal (24h), activity (5min). All have a per-user generation counter that suppresses cache writes after invalidation. `invalidateFitbitProfileCache(userId)` bumps generation + clears caches + clears in-flight maps across all criticality tiers.

**Existing patterns:**
- Fitbit calls go through `fetchWithRetry` with `FitbitCallCriticality` ("critical" / "important" / "optional"). Background revalidations use "optional"; user-driven reads use "important"; writes use "critical".
- Errors: `FITBIT_RATE_LIMIT_LOW` → HTTP 503 in route handlers (see nutrition-goals route 81-87 for the error map).
- API responses: `successResponse(data)` / `errorResponse(code, message, status)` from `src/lib/api-response.ts`. GET routes set `Cache-Control: private, no-cache`.
- Client data fetching: `useSWR` + `apiFetcher` from `src/lib/swr.ts`. Default config (no overrides) revalidates on focus.
- Dashboard's date-reset on `visibilitychange` lives in `src/components/daily-dashboard.tsx:79-114` — reset to today when (a) date changed since hide, or (b) >1h elapsed.

**Test conventions:**
- Vitest, colocated `__tests__/` (e.g. `src/lib/__tests__/daily-goals.test.ts`).
- Mocks declared at top of file before `await import(...)`.
- DB mock: chainable `select/from/where`, `insert/values/onConflictDoNothing`, `update/set/where` returning vi.fn pre-queued with `mockResolvedValueOnce`.
- Drizzle-orm operators (`eq`, `and`, `between`) mocked to string identifiers — column-name typos still caught at compile time per CLAUDE.md "Known Accepted Patterns".

### MCP Context

**Linear MCP:** Used to fetch all 17 issue descriptions and validate against code. Will move issues Backlog → Todo at end.

**Railway MCP:** Not consulted — no infrastructure/env-var changes in this plan.

### Triage Results

**Planned (17, all valid — line numbers and behavior in each issue match the live code):**
FOO-992, FOO-993, FOO-995, FOO-996, FOO-997, FOO-998, FOO-999, FOO-1000, FOO-1001, FOO-1002, FOO-1003, FOO-1005, FOO-1006, FOO-1007, FOO-1008, FOO-1009, FOO-1010

**Canceled:** none.

**Out of scope (deferred — need design discussion, not in this plan):**
- **FOO-994** (ACTIVITY_MULTIPLIER per-user override) — needs UX (auto-calibration vs settings card) before implementing. Stays in Backlog.
- **FOO-1004** (BMI tier coefficient cliff) — needs interpolation strategy decision. Stays in Backlog.

### Key Design Decisions (committed in this plan)

1. **FOO-995 invalidation scope**: profile changes invalidate **today and forward only**. Historical days reflect the goal context active at the time the row was written and stay stable. This avoids the rate-limit storm (lazy recompute on each historical view) and is also semantically correct: history shouldn't change retroactively.
2. **FOO-1009 ratchet behavior**: **ratchet-up only**. Cache-hit path re-fetches live `caloriesOut` (already in 5-min activity cache) and only UPDATEs the row when the new computed target is **higher** than the stored one. Sedentary days keep the morning's number — the user still has a meal plan to work against. Combined with FOO-999's below-RMR guard, no need for a separate "7-day projection" seed.
3. **FOO-1010 staleness mode**: continue producing targets in the 7–14 day window with a UI staleness warning. Beyond 14 days the engine still blocks (`reason: "no_weight"`) but the message differentiates "never logged" vs. "log >14d old".
4. **FOO-996 race fix**: profile-version counter on `users` written into `daily_calorie_goals.profile_version`; cache-hit returns row only when stored version matches `users.macro_profile_version`. This is simpler and more robust than awaiting in-flight Promises (which doesn't help if the request is in-flight on a *different* node — though we're single-node today, the version counter is future-proof).
5. **FOO-993 audit columns**: persist `goal_type` and `bmi_tier` on `daily_calorie_goals`. Cache-hit path returns the stored values, not values reconstructed from current Fitbit state.

## Tasks

Foundation tasks (F*) come first because Engine/Cache/UI/API tasks depend on the new schema columns and consolidated types.

---

### Task F1: Add `goal_type`, `bmi_tier`, `profile_version`, `weight_logged_date` columns to `daily_calorie_goals`; `macro_profile_version` to `users`

**Linear Issue:** FOO-993 (audit goalType drift) + foundation for FOO-996 (race window), FOO-1009 (ratchet-up), FOO-1010 (weight staleness).

**Files:**
- `src/db/schema.ts` (modify)
- `drizzle/0023_*.sql` (generate via `npx drizzle-kit generate` — do NOT hand-write)
- `MIGRATIONS.md` (append entry)
- `src/lib/daily-goals.ts` (modify — write/read new columns)
- `src/lib/__tests__/daily-goals.test.ts` (modify — add stored-vs-current goalType test)

**Steps:**
1. **RED:** In `src/lib/__tests__/daily-goals.test.ts`, add test "cache-hit returns stored goalType, not current Fitbit goalType":
   - Pre-queue `select` returning a stored row with `goalType: "LOSE"`, `bmiTier: "lt25"`, `profileVersion: 1`, `weightLoggedDate: "2026-05-03"`.
   - Mock `getCachedFitbitWeightGoal` to return `{ goalType: "MAINTAIN" }` (i.e., user changed goal in Fitbit since row was written).
   - Assert `result.audit.goalType === "LOSE"` and `result.audit.bmiTier === "lt25"`.
2. **RED:** Add test "first compute persists goal_type, bmi_tier, profile_version, weight_logged_date":
   - No existing row; mock standard inputs; pre-queue insert.
   - After call, assert `mockInsertOnce().values` was called with object containing `goalType: "LOSE"`, `bmiTier: "lt25"`, `profileVersion: <user's current version>`, `weightLoggedDate: "2026-05-03"`.
3. **GREEN:**
   - In `src/db/schema.ts:144-164`, extend `dailyCalorieGoals`:
     - `goalType: text("goal_type")` (nullable — backfill on next compute)
     - `bmiTier: text("bmi_tier")` (nullable)
     - `profileVersion: integer("profile_version")` (nullable for legacy rows)
     - `weightLoggedDate: date("weight_logged_date")` (nullable)
   - In `src/db/schema.ts:18-25` `users`, add `macroProfileVersion: integer("macro_profile_version").default(1).notNull()`.
   - Run `npx drizzle-kit generate` to produce migration. Verify the snapshot is correct.
   - In `src/lib/daily-goals.ts`, extend `DbRow` (line 22-31) with `goalType`, `bmiTier`, `profileVersion`, `weightLoggedDate`.
   - In `queryRow`, select the new columns.
   - Cache-hit fast path (line 100-155): if `existing.goalType` is non-null, return it directly in `audit.goalType`. Else fall back to today's `weightGoal?.goalType` (legacy row support — emit `l.warn({action: "daily_goals_legacy_audit", userId, date}, "audit reconstructed from current Fitbit state")`).
   - Same for `bmiTier`: prefer `existing.bmiTier`, else recompute.
   - In the full compute INSERT (line 207-220) and UPDATE-after-conflict (line 230-243), include `goalType`, `bmiTier: engineOut.bmiTier`, `profileVersion: <current users.macro_profile_version>`, `weightLoggedDate: weightLog.loggedDate`. To get version, extend `loadUserMacroProfile` to also return version, or run a parallel query — pick whichever keeps the diff small.
4. **REFACTOR:** Extract `auditFromRow(row, fallbackGoalType, fallbackBmiTier): NutritionGoalsAudit` if the cache-hit path becomes verbose.
5. Run `npx vitest run "daily-goals"` (expect pass), `npm run typecheck`.

**Notes:**
- **Migration note:** Adds four nullable columns to `daily_calorie_goals` (`goal_type`, `bmi_tier`, `profile_version`, `weight_logged_date`) and one column to `users` (`macro_profile_version`, NOT NULL DEFAULT 1). No data migration needed — legacy rows have nulls and the cache-hit path falls back gracefully with a warning log.
- New columns must be nullable so existing rows pass; the engine populates on next recompute.
- Use `text(...)` for `goal_type`/`bmi_tier` consistent with other text columns in the table; CHECK constraints can be added later if data drift becomes a concern.

---

### Task F2: Consolidate `BmiTier` to `src/types/index.ts`

**Linear Issue:** FOO-1005

**Files:**
- `src/types/index.ts` (modify — single canonical declaration)
- `src/lib/macro-engine.ts` (modify — import instead of declare)
- `src/lib/daily-goals.ts` (modify — import instead of declare)

**Steps:**
1. **GREEN (refactor — no new test; existing tests pin behavior):**
   - In `src/types/index.ts`, add near the top of macro-related types: `export type BmiTier = "lt25" | "25to30" | "ge30";`. Update `MacroEngineOutputs.bmiTier: BmiTier` and `NutritionGoalsAudit.bmiTier: BmiTier` to reference it.
   - In `src/lib/macro-engine.ts:12`, replace the local `export type BmiTier = ...` with `import type { BmiTier } from "@/types";` and `export type { BmiTier };` if any external import of macro-engine's `BmiTier` exists (grep first — none expected).
   - In `src/lib/daily-goals.ts:20`, delete the local `type BmiTier = ...` and add `BmiTier` to the existing `import type { ... } from "@/types"` block.
2. Run `npm run typecheck` (expect pass — pure type alias dedup, no runtime behavior change).
3. Run `npx vitest run` to confirm no test broke.

**Notes:**
- Pure type-level refactor. Verify with `grep -n "type BmiTier" src/` after — should be exactly one declaration.

---

### Task F3: Add raw `caloriesOut` to audit (type + persistence + display)

**Linear Issue:** FOO-1000

**Files:**
- `src/types/index.ts` (modify — `NutritionGoalsAudit`)
- `src/lib/daily-goals.ts` (modify — populate audit.caloriesOut)
- `src/components/targets-card.tsx` (modify — render in expanded view)
- `src/lib/__tests__/daily-goals.test.ts` (modify — assert caloriesOut in audit)
- `src/components/__tests__/targets-card.test.tsx` (modify or create — assert raw value rendered)

**Steps:**
1. **RED (lib):** Add test "audit includes raw caloriesOut from Fitbit":
   - Mock activity → `{ caloriesOut: 3000 }`, RMR computed to ~2070.
   - Assert `result.audit.caloriesOut === 3000` and `result.audit.activityKcal === 791` (post-haircut).
2. **RED (component):** In `targets-card.test.tsx`, add test "expanded view shows Fitbit calories burned and adjusted activity":
   - Render with audit including `caloriesOut: 3000`, `activityKcal: 791`.
   - Click expand button.
   - Assert text "Fitbit calories burned: 3,000 kcal" AND "Activity (after 0.85× haircut): 791 kcal" both visible.
3. **GREEN:**
   - In `src/types/index.ts:608-615`, add `caloriesOut: number` to `NutritionGoalsAudit`.
   - In `src/lib/daily-goals.ts`:
     - Cache-hit path (lines 138-154): include `caloriesOut: existing.caloriesOut!` in audit (`hasMacros` guarantees non-null).
     - Full compute return (lines 251-267): include `caloriesOut: activity.caloriesOut`.
   - In `src/components/targets-card.tsx:120-130`, replace `Activity: {audit.activityKcal} kcal` with two lines:
     - `<p>Fitbit calories burned: {audit.caloriesOut.toLocaleString("en-US")} kcal</p>`
     - `<p>Activity (after 0.85× haircut): {audit.activityKcal} kcal</p>`
4. Run `npx vitest run "daily-goals|targets-card"` (expect pass), `npm run typecheck`.

**Notes:**
- The `caloriesOut` column already exists in `daily_calorie_goals` — no schema change needed.
- The 0.85 multiplier text mirrors the engine's `ACTIVITY_MULTIPLIER` constant.

---

### Task F4: DB CHECK constraint on `users.macro_profile`

**Linear Issue:** FOO-1001

**Files:**
- `src/db/schema.ts` (modify — add CHECK)
- `drizzle/0024_*.sql` (generate via drizzle-kit)
- `MIGRATIONS.md` (append)
- `src/lib/macro-engine.ts` (modify — log warning when `isMacroProfileKey(stored)` is false)
- `src/lib/__tests__/macro-engine.test.ts` (modify — assert warning logged)

**Steps:**
1. **RED:** Add test in `macro-engine.test.ts` "getMacroProfile logs warning when stored key is invalid":
   - Spy on logger.warn.
   - Call `getMacroProfile("foo" as any)`.
   - Assert warn called with `{ action: "macro_profile_invalid_key", key: "foo" }`.
2. **GREEN:**
   - In `src/db/schema.ts`, add CHECK constraint via Drizzle's table-level `check` helper:
     ```
     (table) => ({
       macroProfileCheck: check("users_macro_profile_chk",
         sql`${table.macroProfile} IN ('muscle_preserve', 'metabolic_flex')`),
     })
     ```
     Import `check` from `drizzle-orm/pg-core` and `sql` from `drizzle-orm`.
   - Run `npx drizzle-kit generate`. Verify the SQL is `ALTER TABLE users ADD CONSTRAINT users_macro_profile_chk CHECK (...)`.
   - In `src/lib/macro-engine.ts`, modify `getMacroProfile` to log a warning when key fails `isMacroProfileKey` (currently silent fallback). Pass an optional logger; if absent use module-level `logger` from `@/lib/logger`.
3. Run typecheck + vitest.

**Notes:**
- **Migration note:** Adds CHECK constraint to `users.macro_profile`. Pre-flight check before applying: `SELECT DISTINCT macro_profile FROM users` should return only the two known values. If any other value exists (manual psql edits), the migration will fail — log such a row in `MIGRATIONS.md` for cleanup.

---

### Task E1: Validate `caloriesOut` input in `computeMacroTargets`

**Linear Issue:** FOO-998

**Files:**
- `src/lib/macro-engine.ts` (modify — extend validation block)
- `src/lib/daily-goals.ts` (modify — map error to blocked status)
- `src/types/index.ts` (modify — add reason union member)
- `src/components/targets-card.tsx` (modify — blocked message)
- `src/lib/__tests__/macro-engine.test.ts` (modify)
- `src/lib/__tests__/daily-goals.test.ts` (modify)

**Steps:**
1. **RED:** Add tests in `macro-engine.test.ts`:
   - "throws INVALID_ACTIVITY_DATA on NaN caloriesOut"
   - "throws INVALID_ACTIVITY_DATA on Infinity caloriesOut"
   - "throws INVALID_ACTIVITY_DATA on negative caloriesOut" (`-100`)
   - "accepts caloriesOut up to 30000"
   - "throws INVALID_ACTIVITY_DATA above 30000"
2. **RED:** In `daily-goals.test.ts`, add test "INVALID_ACTIVITY_DATA produces blocked result with invalid_activity reason":
   - Stub activity → `{ caloriesOut: NaN }`.
   - Assert `result.status === "blocked"`, `result.reason === "invalid_activity"`.
3. **GREEN:** In `src/lib/macro-engine.ts:98-107`, extend validation:
   ```
   if (!Number.isFinite(caloriesOut) || caloriesOut < 0 || caloriesOut > 30000) {
     throw new Error("INVALID_ACTIVITY_DATA");
   }
   ```
4. **GREEN (caller):** In `src/lib/daily-goals.ts:268-276`, add to the catch:
   ```
   if (error instanceof Error && error.message === "INVALID_ACTIVITY_DATA") {
     return { status: "blocked", reason: "invalid_activity" };
   }
   ```
   Add `"invalid_activity"` to the union in `ComputeResult.blocked.reason` (line 47).
5. **GREEN (types):** Add `invalid_activity` to `NutritionGoals.reason` in `src/types/index.ts:623`.
6. **GREEN (UI):** In `src/components/targets-card.tsx:15-28` `getBlockedMessage`, add case:
   ```
   case "invalid_activity":
     return "Fitbit returned invalid activity data. Try again later or check the Fitbit app.";
   ```
7. Run vitest + typecheck.

**Notes:**
- 30000 kcal/day upper bound is conservative — Tour de France maxes around 9000.
- No route-handler change: `INVALID_ACTIVITY_DATA` is converted to a blocked result inside `doCompute`, not propagated.

---

### Task E2: Treat `caloriesOut < rmr * 1.05` as `partial`

**Linear Issue:** FOO-999

**Files:**
- `src/lib/macro-engine.ts` (modify — extract `computeRmr` export)
- `src/lib/daily-goals.ts` (modify — extend partial guard)
- `src/lib/__tests__/daily-goals.test.ts` (modify)

**Steps:**
1. **RED:** Add tests:
   - "partial when caloriesOut === 0"
   - "partial when caloriesOut equals RMR exactly" (caloriesOut: 2070 for RMR ~2070)
   - "partial when caloriesOut just below 1.05 × RMR" (caloriesOut: Math.floor(2070 * 1.04))
   - "ok when caloriesOut at 1.05 × RMR" (caloriesOut: Math.ceil(2070 * 1.05))
2. **GREEN (engine extraction):** In `src/lib/macro-engine.ts`, extract:
   ```
   export function computeRmr(sex: "MALE"|"FEMALE", ageYears: number, heightCm: number, weightKg: number): number { ... }
   ```
   Have `computeMacroTargets` call it (no behavior change there).
3. **GREEN (guard):** In `src/lib/daily-goals.ts:183`, replace:
   ```
   if (activity === null || activity.caloriesOut === null) { ... partial ... }
   ```
   with:
   ```
   const rmrThreshold = computeRmr(profile.sex, profile.ageYears, profile.heightCm, weightKg) * 1.05;
   if (activity === null || activity.caloriesOut === null || activity.caloriesOut < rmrThreshold) {
     // partial
   }
   ```
   (compute `rmrThreshold` after the `weightLog === null` guard at line 171, before line 183.)
4. **REFACTOR:** Add `// FOO-999: 5% headroom above RMR — caloriesOut below this is too noisy to anchor a target.` comment.
5. Run vitest + typecheck.

**Notes:**
- After 1-2 hours of normal movement, caloriesOut typically exceeds 1.1× RMR. The 1.05 threshold catches early-morning Fitbit reports (when caloriesOut ≈ RMR before tracking begins).

---

### Task E3: Extend weight walk-back to 14 days; surface staleness

**Linear Issue:** FOO-1010

**Files:**
- `src/lib/fitbit.ts` (modify — walk-back loop)
- `src/lib/fitbit-cache.ts` (modify — null-result TTL split)
- `src/lib/daily-goals.ts` (modify — populate weightLoggedDate, compute staleness)
- `src/types/index.ts` (modify — `NutritionGoalsAudit.weightLoggedDate`, `NutritionGoals.weightStale`)
- `src/components/targets-card.tsx` (modify — staleness messaging)
- `src/components/fitbit-profile-card.tsx` (modify — staleness warning row)
- `src/lib/__tests__/fitbit.test.ts` (modify)
- `src/lib/__tests__/daily-goals.test.ts` (modify)
- `src/components/__tests__/targets-card.test.tsx` (modify)

**Steps:**
1. **RED (fitbit.ts):** Add tests:
   - "walk-back returns weight on day 12": days 0-11 empty, day 12 has a log. Expect non-null with `loggedDate` matching.
   - "walk-back returns null after 14 days": all 14 stubs empty.
2. **GREEN (fitbit.ts):** In `src/lib/fitbit.ts:760`, change `daysBack < 7` to `daysBack < 14`. The shared `walkbackStart` deadline already coordinates timeouts across iterations.
3. **RED (daily-goals.ts):** Add test "audit exposes weightLoggedDate and weightStale flag set when >7 days old":
   - Stub weight log → `{ weightKg: 75, loggedDate: "<8 days before target>" }`.
   - Assert `result.audit.weightLoggedDate === "<8 days ago>"` AND `result.weightStale === true`.
4. **GREEN (daily-goals.ts + types):**
   - Extend `NutritionGoalsAudit` (`src/types/index.ts:608`) with `weightLoggedDate: string | null`.
   - Extend `NutritionGoals` with optional `weightStale?: boolean`.
   - In `src/lib/daily-goals.ts`, populate `weightLoggedDate` in audit (cache-hit reads from row column added in F1; full-compute uses `weightLog.loggedDate`).
   - Compute staleness: `weightStale = (Date.parse(date) - Date.parse(weightLoggedDate)) / 86400000 > 7`. Inline math, no new util needed.
5. **GREEN (UI):**
   - `src/components/targets-card.tsx`: in expanded view, render `Weight: {weightKg}kg (logged {weightLoggedDate})` and put `BMI tier: {bmiTier}` on its own line. If `goals.weightStale === true` AND `goals.status === "ok"`, render a small warning row above the targets row: `⚠ Weight log is N days old — log a recent weight in Fitbit.`
   - `src/components/fitbit-profile-card.tsx:108-116`: when `data.weightLoggedDate` is between 8 and 14 days old, render a small warning row beneath the weight row with `text-amber-600 dark:text-amber-500` class: `Weight log is N days old — consider weighing in.`
6. **GREEN (cache TTL split):** In `src/lib/fitbit-cache.ts:111`, change weight-cache write:
   ```
   const ttl = weight === null ? 10 * 60 * 1000 : TTL_1H;
   weightCache.set(key, { value: weight, expiresAt: Date.now() + ttl });
   ```
7. Run vitest + typecheck.

**Notes:**
- F1's migration includes `weight_logged_date` so this task only consumes the column.
- Beyond 14 days the engine still returns `blocked, reason: "no_weight"` — same surface text as today.

---

### Task C1: Scope `invalidateUserDailyGoalsForProfileChange` to today + forward

**Linear Issue:** FOO-995

**Files:**
- `src/lib/daily-goals.ts` (modify)
- `src/app/api/macro-profile/route.ts` (modify — pass today's date)
- `src/lib/__tests__/daily-goals.test.ts` (modify)

**Steps:**
1. **RED:** Add test "invalidate scopes update to today + future dates only":
   - Mock `update.set.where` to capture the where clause string.
   - Call `invalidateUserDailyGoalsForProfileChange("user-a", "2026-05-04")`.
   - Assert the where clause string contains both `eq:user-a` AND a `gte:2026-05-04` operator.
2. **GREEN:**
   - Change signature to `invalidateUserDailyGoalsForProfileChange(userId: string, fromDate: string): Promise<void>`.
   - In the `where(...)` at line 325, change to `and(eq(dailyCalorieGoals.userId, userId), gte(dailyCalorieGoals.date, fromDate))`. Import `gte` from `drizzle-orm`.
   - Update the in-flight clear loop to only clear keys for dates `>= fromDate`. Parse the date suffix from the key: `if (key.startsWith(\`${userId}:\`) && key.split(":")[1] >= fromDate)`.
3. **GREEN (caller):** In `src/app/api/macro-profile/route.ts:77`:
   ```
   await invalidateUserDailyGoalsForProfileChange(session!.userId, getTodayDate());
   ```
   Import `getTodayDate` from `@/lib/date-utils`.
4. **GREEN (doc):** Update the JSDoc comment on `invalidateUserDailyGoalsForProfileChange` (lines 295-304).
5. Run vitest + typecheck.

**Notes:**
- Behavior change visible to users: switching macro profile no longer rewrites historical macros. Existing zeroed historical rows from prior behavior remain zeroed and lazily recompute on view (one-time cost). Document in MIGRATIONS.md.

---

### Task C2: Close race window — profile-version counter

**Linear Issue:** FOO-996

**Files:**
- `src/db/schema.ts` (already extended in F1 with `users.macro_profile_version` and `daily_calorie_goals.profile_version`)
- `src/lib/daily-goals.ts` (modify — read current version, compare on cache-hit, write on insert)
- `src/app/api/macro-profile/route.ts` (modify — increment version atomically)
- `src/lib/__tests__/daily-goals.test.ts` (modify)
- `src/app/api/macro-profile/__tests__/route.test.ts` (modify or create)

**Steps:**
1. **RED (daily-goals):** Add test "cache-hit recomputes when stored profile_version mismatches":
   - Stored row has `profileVersion: 1`.
   - Mock users-table read → `{ macroProfile: "muscle_preserve", macroProfileVersion: 2 }`.
   - Assert full recompute path runs (verify by `mockGetCachedActivitySummary` was called — cache-hit fast path doesn't call it).
2. **RED (macro-profile):** Add test "PATCH increments macro_profile_version atomically":
   - Mock the update.
   - PATCH with new profile.
   - Assert `update.set` was called with both `macroProfile` AND `macroProfileVersion: sql\`...\`` (i.e., the SQL increment expression).
3. **GREEN:**
   - In `src/lib/daily-goals.ts`, extend the user query (or the `loadUserMacroProfile` helper) to also return `macroProfileVersion`. Cache-hit path: after fetching `existing` row, if `existing.profileVersion !== userVersion`, fall through to full compute (treat as if `hasMacros(existing)` is false).
   - Full compute path: write `profileVersion: userVersion` into the row.
   - In `src/app/api/macro-profile/route.ts:72-76`, change the update to set both fields atomically:
     ```
     await getDb().update(users).set({
       macroProfile: profileValue,
       macroProfileVersion: sql`${users.macroProfileVersion} + 1`,
       updatedAt: new Date(),
     }).where(eq(users.id, session!.userId));
     ```
     Import `sql` from `drizzle-orm`.
4. **REFACTOR:** Update JSDoc on `invalidateUserDailyGoalsForProfileChange` to note: version counter is the actual race-safety mechanism; the row clear is for UX (immediate visible refresh on next read).
5. Run vitest + typecheck.

**Notes:**
- `sql\`macro_profile_version + 1\`` is atomic in Postgres — no separate read needed.
- Robust to multi-node deploys (future-proof) and to the existing single-node race because the in-flight compute that captured the old profile will write the OLD `profileVersion`, and the next cache-hit sees the version mismatch and recomputes.

---

### Task C3: "Refresh from Fitbit" invalidates today's `daily_calorie_goals` row

**Linear Issue:** FOO-992

**Files:**
- `src/lib/daily-goals.ts` (modify — add `invalidateUserDailyGoalsForDate`)
- `src/app/api/fitbit/profile/route.ts` (modify — call the new helper)
- `src/app/api/fitbit/profile/__tests__/route.test.ts` (modify or create)

**Steps:**
1. **RED:** In `route.test.ts`, add test "GET ?refresh=1 zeroes today's daily_calorie_goals row":
   - Set up session with userId + Fitbit.
   - Spy on `invalidateUserDailyGoalsForDate`.
   - Call `GET /api/fitbit/profile?refresh=1`.
   - Assert spy called with `(userId, getTodayDate())`.
2. **GREEN:**
   - Add to `src/lib/daily-goals.ts`:
     ```
     export async function invalidateUserDailyGoalsForDate(userId: string, date: string): Promise<void> { ... }
     ```
     Body: clear the in-flight key `${userId}:${date}`, then UPDATE the row at `(userId, date)` setting macro/audit columns to null and `calorieGoal` to 0 (same shape as the post-C1 `invalidateUserDailyGoalsForProfileChange`, but scoped to one date and **without** bumping `users.macro_profile_version` — the Fitbit-side data changed, not the user's profile choice).
   - In `src/app/api/fitbit/profile/route.ts:21-25`, after `invalidateFitbitProfileCache(session!.userId)`:
     ```
     await invalidateUserDailyGoalsForDate(session!.userId, getTodayDate());
     ```
     Import `getTodayDate` from `@/lib/date-utils` and `invalidateUserDailyGoalsForDate` from `@/lib/daily-goals`.
3. Run vitest + typecheck.

**Notes:**
- Why a separate helper instead of reusing C1's: a profile change implies "all forward computations under the old profile are now wrong" (and C2 bumps the version counter). A Fitbit refresh implies "the upstream inputs changed for the date(s) being refreshed" — different scope. Conflating would (a) bump version unnecessarily, (b) zero forward dates the user may not want refreshed.
- C4 (ratchet-up) handles the *passive* case where caloriesOut grows over the day. C3 handles the *active* case where the user explicitly clicks refresh.

---

### Task C4: Ratchet-up recompute on read

**Linear Issue:** FOO-1009

**Files:**
- `src/lib/daily-goals.ts` (modify — extend cache-hit path with re-fetch + comparison + conditional UPDATE)
- `src/lib/__tests__/daily-goals.test.ts` (modify)

**Steps:**
1. **RED:** Add tests:
   - "ratchet-up: cache-hit re-fetches activity, updates row when new target exceeds stored":
     - Stored row: `calorieGoal: 2289`, `caloriesOut: 3000` (morning value).
     - Mock activity → `{ caloriesOut: 4500 }` (after a workout).
     - Call `getOrComputeDailyGoals`.
     - Assert `mockUpdateOnce.set` was called with a higher `calorieGoal`, AND `result.audit.caloriesOut === 4500`.
   - "ratchet-up: does NOT update when new target equal to stored":
     - Stored 2289, caloriesOut 3000. Mock activity → 3000 (no change).
     - Assert `update` NOT called; result returns stored.
   - "ratchet-up: does NOT update when new target lower than stored":
     - Stored 2289 (caloriesOut 3000). Mock activity → 2200 (sedentary day).
     - Assert `update` NOT called; result returns stored 2289.
   - "ratchet-up: skipped when activity below RMR×1.05 threshold":
     - Stored 2289 (caloriesOut 3000). Mock activity → 1500 (caloriesOut < rmr).
     - Assert `update` NOT called; result returns stored.
2. **GREEN:** In `src/lib/daily-goals.ts` cache-hit path (lines 100-155), after the existing row is loaded and audit reconstructed:
   - Fetch live activity via `getCachedActivitySummary(userId, date, l, "optional")`. The "optional" criticality means low rate-limit headroom skips the recompute (graceful degrade).
   - If activity is null OR `activity.caloriesOut === null` OR `activity.caloriesOut < computeRmr(...) * 1.05` (FOO-999 guard): keep stored values, return as-is.
   - Else: call `computeMacroTargets(...)` with the live caloriesOut.
   - If `recomputed.targetKcal > existing.calorieGoal`: UPDATE the row's `calorieGoal`, `proteinGoal`, `carbsGoal`, `fatGoal`, `caloriesOut`, `activityKcal`, `updatedAt: new Date()`. Do NOT update `goalType`/`bmiTier`/`profileVersion`/`weightLoggedDate` — they don't change with activity. Return the recomputed values + audit reflecting the new inputs.
   - Else: return stored values unchanged.
3. **REFACTOR:** Extract the live-recompute block to `tryRatchetRecompute(existing, userId, date, profile, weightKg, goalType, bmiTier, l): Promise<ComputeResult>` to keep the cache-hit path readable.
4. Run vitest + typecheck.

**Notes:**
- Largest behavior change in this plan. The cache-hit path now does one extra activity fetch on every read (5-min cache absorbs cost; 95%+ of reads will hit cache).
- Rate-limit safety: criticality "optional" means breaker skips when remaining < 20. In that case the user sees stored target — degraded but correct.
- Why ratchet-up only: a target that drops mid-day after meals creates an impossible deficit. A target that grows is always actionable ("you have more headroom now").
- Audit's "delta" UI ("+120 kcal earned from exercise" mentioned in FOO-1009 acceptance criteria) is left as a follow-up; numbers are visible via the expanded audit (raw caloriesOut from F3) — sufficient for transparency.

---

### Task U1: TargetsCard renders partial protein/fat with explanatory footnote

**Linear Issue:** FOO-997

**Files:**
- `src/components/targets-card.tsx` (modify — partial branch)
- `src/components/__tests__/targets-card.test.tsx` (modify)

**Steps:**
1. **RED:** Add test "partial status renders proteinG and fatG with calorie-pending footnote":
   - Render with `goals = { calories: null, proteinG: 218, carbsG: null, fatG: 97, status: "partial" }`.
   - Assert `P:218g` AND `F:97g` visible.
   - Assert text matching /calories.*pending|pending.*Fitbit activity/i visible.
   - Assert `C:` is NOT rendered (carbs null in partial).
2. **GREEN:** In `src/components/targets-card.tsx:79-85`, replace the partial branch:
   ```
   if (goals.status === "partial") {
     return (
       <div className="rounded-lg border p-3 space-y-1">
         <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
           {goals.proteinG != null && <span>P:{goals.proteinG}g</span>}
           {goals.fatG != null && <span>F:{goals.fatG}g</span>}
         </div>
         <p className="text-xs text-muted-foreground">
           Calories and carbs pending Fitbit activity sync.
         </p>
       </div>
     );
   }
   ```
3. Run vitest + typecheck.

**Notes:**
- Mirrors the dashboard's `MacroBars` pattern of conditionally rendering each macro.
- Footnote tells users why calories/carbs aren't shown — discoverable.

---

### Task U2: Settings TargetsCard refreshes date on visibility change

**Linear Issue:** FOO-1007

**Files:**
- `src/components/settings-content.tsx` (modify — `DailyTargetsSection`)
- `src/components/__tests__/settings-content.test.tsx` (modify or create)

**Steps:**
1. **RED:** Add test "DailyTargetsSection updates date when visibility becomes visible after midnight":
   - Mock `getTodayDate` to return "2026-05-04" initially, render component.
   - Change mock to return "2026-05-05".
   - Dispatch `visibilitychange` with `document.visibilityState = "visible"`.
   - Assert TargetsCard now receives `date="2026-05-05"`.
2. **GREEN:** Convert `DailyTargetsSection` (`settings-content.tsx:349-356`) to use hooks:
   ```
   function DailyTargetsSection() {
     const [date, setDate] = useState(() => getTodayDate());
     const lastActiveRef = useRef({ date: getTodayDate(), timestamp: Date.now() });
     useEffect(() => {
       const handler = () => {
         if (document.visibilityState === "hidden") {
           lastActiveRef.current = { date: getTodayDate(), timestamp: Date.now() };
         } else if (document.visibilityState === "visible") {
           const today = getTodayDate();
           const elapsed = Date.now() - lastActiveRef.current.timestamp;
           if (today !== lastActiveRef.current.date || elapsed > 3_600_000) {
             setDate(today);
           }
         }
       };
       document.addEventListener("visibilitychange", handler);
       return () => document.removeEventListener("visibilitychange", handler);
     }, []);
     return (
       <div className="flex flex-col gap-4 rounded-xl border bg-card p-6">
         <h2 className="text-lg font-semibold">Today&apos;s Targets</h2>
         <TargetsCard date={date} />
       </div>
     );
   }
   ```
   Add `useState`, `useRef`, `useEffect` to existing React imports at the top of the file.
3. Run vitest + typecheck.

**Notes:**
- Mirrors `src/components/daily-dashboard.tsx:79-114`. Use the same 1h elapsed threshold for consistency.
- Don't need to invalidate SWR caches — TargetsCard's SWR key changes when `date` prop changes, triggering a refetch automatically.

---

### Task U3: Macro profile descriptions derived from engine constants

**Linear Issue:** FOO-1006

**Files:**
- `src/lib/macro-engine.ts` (modify — add `describeProfile(profile): string` helper)
- `src/app/api/macro-profile/route.ts` (modify — return description per available profile)
- `src/components/macro-profile-card.tsx` (modify — read description from API, drop hardcoded map)
- `src/lib/__tests__/macro-engine.test.ts` (modify)
- `src/app/api/macro-profile/__tests__/route.test.ts` (modify)

**Steps:**
1. **RED (engine):** Add test "describeProfile produces strings referencing current coefficients":
   - Call `describeProfile(MACRO_PROFILE_MUSCLE_PRESERVE)`.
   - Assert returned string contains "1.6" AND "2.2" AND "130".
   - Same for `MACRO_PROFILE_METABOLIC_FLEX`: contains "1.0" AND "1.4" AND "80".
2. **RED (route):** In `route.test.ts`, add test "GET returns description for each available profile":
   - Stub user with `macroProfile: "muscle_preserve"`.
   - Call GET.
   - Assert each entry in `data.available` has `description: <non-empty string>`.
3. **GREEN (engine):** Add to `src/lib/macro-engine.ts`:
   ```
   export function describeProfile(profile: MacroProfile): string {
     const coeffs = profile.proteinCoefficients;
     const minProtein = Math.min(coeffs.lt25.MAINTAIN, coeffs.ge30.LOSE).toFixed(1);
     const maxProtein = Math.max(coeffs.lt25.LOSE, coeffs["25to30"].LOSE).toFixed(1);
     const carbDescriptor = profile.residualMacro === "carbs"
       ? `${profile.carbGrams} g carb floor`
       : `${profile.carbGrams} g carbs`;
     const school = profile.residualMacro === "carbs"
       ? "Sports-nutrition / muscle-preservation"
       : "Lumen / metabolic-flexibility";
     return `Protein ${minProtein}–${maxProtein} g/kg with a ${carbDescriptor}. ${school} school.`;
   }
   ```
4. **GREEN (route):** In `src/app/api/macro-profile/route.ts:21-27` `buildResponse`, extend `available`:
   ```
   available: MACRO_PROFILE_KEYS.map((k) => {
     const p = getMacroProfile(k);
     return { key: k, name: p.name, description: describeProfile(p) };
   }),
   ```
   Update `MacroProfileResponse` interface (line 15-19) to include `description: string` on each available entry.
5. **GREEN (component):** In `src/components/macro-profile-card.tsx`:
   - Update `MacroProfileResponse.available` type (line 14) to include `description: string`.
   - Delete `PROFILE_DESCRIPTIONS` (lines 17-22).
   - Replace `PROFILE_DESCRIPTIONS[option.key]` (line 117) with `option.description`.
6. Run vitest + typecheck.

**Notes:**
- Description text intentionally mirrors the existing hardcoded text so the UI doesn't shift visually.

---

### Task U4: SWR `revalidateOnFocus` discipline for Fitbit-backed cards

**Linear Issue:** FOO-1003

**Files:**
- `src/lib/swr.ts` (modify — export shared config)
- `src/components/targets-card.tsx` (modify)
- `src/components/fitbit-profile-card.tsx` (modify)
- `src/lib/__tests__/swr.test.ts` (create)

**Steps:**
1. **RED:** Create `src/lib/__tests__/swr.test.ts` with test "FITBIT_BACKED_SWR_CONFIG disables revalidateOnFocus and sets dedupe to 30 minutes":
   - Import `FITBIT_BACKED_SWR_CONFIG` from `@/lib/swr`.
   - Assert `revalidateOnFocus === false`, `dedupingInterval === 30 * 60 * 1000`.
2. **GREEN (swr):** In `src/lib/swr.ts`, add:
   ```
   export const FITBIT_BACKED_SWR_CONFIG = {
     revalidateOnFocus: false,
     revalidateOnReconnect: true,
     dedupingInterval: 30 * 60 * 1000,
   } as const;
   ```
3. **GREEN (components):** Pass the config to `useSWR` calls hitting Fitbit-backed endpoints:
   - `src/components/targets-card.tsx:38` — endpoint `/api/nutrition-goals` is Fitbit-backed. Apply config.
   - `src/components/fitbit-profile-card.tsx:27` — endpoint `/api/fitbit/profile` is Fitbit-backed. Apply config.
   - Leave `MacroProfileCard` (DB-only `/api/macro-profile`), `SettingsContent` session/credentials calls (DB-only) at default.
4. Run vitest + typecheck.

**Notes:**
- 30-min dedupe means manual click-around in settings doesn't burn quota. Mutate-after-action calls (refresh button, profile change) bypass dedupe.
- Skip the "graceful 429 banner with countdown" sub-criterion from FOO-1003 — separate UX feature, future task.

---

### Task A1: Unify external `/api/v1/nutrition-goals` to engine-computed

**Linear Issue:** FOO-1008

**Files:**
- `src/app/api/v1/nutrition-goals/route.ts` (modify — replace passthrough)
- `src/lib/daily-goals.ts` (modify — extract `mapComputeResultToNutritionGoals` helper, add `loadUserMacroProfileKey` helper)
- `src/app/api/nutrition-goals/route.ts` (modify — import shared mapper)
- `src/lib/fitbit.ts` (modify — delete `getFoodGoals`)
- `src/types/index.ts` (modify — delete `FitbitFoodGoals`)
- `src/lib/nutrition-goals.ts` (existing `getDailyGoalsByDateRange` — verify no change needed)
- `src/app/api/v1/nutrition-goals/__tests__/route.test.ts` (modify or create)

**Steps:**
1. **RED:** In v1 route test, add tests:
   - "single date returns engine-computed goals": Bearer auth, `?date=2026-05-04`, expect response shape `{ date, calories, proteinG, carbsG, fatG, status: "ok", profileKey, audit }`.
   - "default date returns today's goals": no `date`, response date matches today.
   - "range mode returns rows from getDailyGoalsByDateRange": `?from=2026-05-01&to=2026-05-04`, expect array of 4 entries.
   - "range mode rejects spans >90 days": `?from=2026-01-01&to=2026-05-04`, expect 400.
   - "range mode does NOT call getOrComputeDailyGoals": ensure no engine backfill.
   - "auth required": missing Bearer → 401.
2. **GREEN (extract mapper):** In `src/lib/daily-goals.ts`, extract:
   ```
   export function mapComputeResultToNutritionGoals(result: ComputeResult): NutritionGoals { ... }
   ```
   Body taken from `src/app/api/nutrition-goals/route.ts:9-38`. Update the internal nutrition-goals route to import this helper.
3. **GREEN (helper):** Add `export async function loadUserMacroProfileKey(userId: string): Promise<MacroProfileKey>` to `src/lib/daily-goals.ts` (or expose `loadUserMacroProfile` to also return the key).
4. **GREEN (rewrite v1 route):** Replace `src/app/api/v1/nutrition-goals/route.ts`:
   - Keep `validateApiRequest` + `checkRateLimit('v1:nutrition-goals:...', 30, 60_000)`.
   - Parse `searchParams`: `date`, `from`, `to`. Validate format with `isValidDateFormat`.
   - If `from` and `to` both present:
     - Validate `to >= from` and span ≤ 90 days.
     - Call `getDailyGoalsByDateRange(userId, from, to)` from `@/lib/nutrition-goals`.
     - Map each row: `{ date, calories: row.calorieGoal > 0 ? row.calorieGoal : null, proteinG, carbsG, fatG, status: row.calorieGoal > 0 && row.proteinGoal != null ? "ok" : "blocked", reason: status === "blocked" ? "not_computed" : undefined }`. Add `profileKey` from `loadUserMacroProfileKey(userId)` (one query for the response, not per row).
     - Return `{ entries: [...], profileKey }`.
   - Else (single-date mode):
     - `date = searchParams.get("date") ?? getTodayDate()`.
     - Call `getOrComputeDailyGoals(userId, date, log)`.
     - Map via `mapComputeResultToNutritionGoals`.
     - Return mapped object plus `{ date, profileKey: await loadUserMacroProfileKey(userId) }`.
   - Error mapping: copy the FITBIT_* → HTTP map from `src/app/api/nutrition-goals/route.ts:71-100`. Add `not_computed` to NutritionGoals.reason union in `src/types/index.ts:623`.
   - Use `conditionalResponse(request, payload)` for ETag.
5. **GREEN (delete dead code):**
   - Delete `getFoodGoals` from `src/lib/fitbit.ts:638-681`.
   - Delete `FitbitFoodGoals` interface from `src/types/index.ts:582-583`.
   - Verify no other imports: `grep -r "getFoodGoals\|FitbitFoodGoals" src/` should be empty.
6. Run vitest + typecheck + `npm run lint` (catches dead-code warnings).

**Notes:**
- Range mode is read-only (no engine calls). Days without rows return `status: "blocked", reason: "not_computed"`.
- **Breaking change** to v1 API response shape. Document in MIGRATIONS.md under "API contract changes".

---

### Task A2: Chat tools surface partial macros

**Linear Issue:** FOO-1002

**Files:**
- `src/lib/chat-tools.ts` (modify — `executeGetNutritionSummary` single-date branch)
- `src/lib/__tests__/chat-tools.test.ts` (modify)

**Steps:**
1. **RED:** Add test "get_nutrition_summary surfaces partial protein/fat goals when calorie goal is pending":
   - Mock `getOrComputeDailyGoals` to return `{ status: "partial", proteinG: 218, fatG: 97 }`.
   - Mock `getDailyNutritionSummary` to return non-empty totals.
   - Call `executeGetNutritionSummary({ date: "2026-05-04" }, ...)`.
   - Assert returned string contains "Protein goal: 218g" AND "calorie goal pending Fitbit activity" (or similar) AND does NOT contain "Calorie goal:".
2. **GREEN:** In `src/lib/chat-tools.ts:222-254` (single-date branch of `executeGetNutritionSummary`):
   - Replace `getDailyGoalsByDate(userId, date)` with `getOrComputeDailyGoals(userId, date, log)`.
   - Branch on `result.status`:
     - `"ok"`: existing logic, populate calorie/macros from `result.goals`.
     - `"partial"`: skip calorie line, render `Protein goal: ${result.proteinG}g (calorie goal pending Fitbit activity sync)`, `Fat goal: ${result.fatG}g`.
     - `"blocked"`: render `Goal status: blocked (${result.reason})` so Claude knows why.
3. Run vitest + typecheck.

**Notes:**
- Range-mode (`from_date`+`to_date`) keeps using `getDateRangeNutritionSummary` — out of scope for this iteration; partial status is rare across multi-day ranges.
- `src/lib/user-profile.ts:61-104` has the same `getDailyGoalsByDate` pattern — same fix should apply later as a separate task.

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent — Review changes for bugs across all 17 tasks; pay special attention to:
   - C2 race window (version counter atomicity, especially in PATCH route)
   - C4 ratchet-up (audit consistency between stored and recomputed values; UPDATE shape)
   - F1+E3 migration coverage (single migration covers all F1/E3 column additions)
   - A1 dead-code removal (`getFoodGoals`, `FitbitFoodGoals`, no orphan imports)
   - U2 `useEffect` cleanup (event listener removal)
2. Run `verifier` agent (no args) — Unit tests + lint + build, expect zero warnings.
3. Run `verifier "e2e"` — Playwright suite, especially settings page (TargetsCard, MacroProfileCard, FitbitProfileCard) and dashboard.
4. Update `MIGRATIONS.md` with a single block describing all DB changes from this plan:
   - F1: `daily_calorie_goals` adds `goal_type text`, `bmi_tier text`, `profile_version integer`, `weight_logged_date date` (all nullable). `users` adds `macro_profile_version integer NOT NULL DEFAULT 1`.
   - F4: CHECK constraint on `users.macro_profile`.
   - C1: Behavior change documented (no data migration).
   - A1: v1 API response shape changed (no DB migration; consumer notice).

---

## Plan Summary

**Objective:** Fix correctness, race, and transparency bugs in the macro-engine / daily-goals subsystem; unify the external nutrition-goals API; tighten SWR/Fitbit rate-limit discipline.

**Linear Issues:** FOO-992, FOO-993, FOO-995, FOO-996, FOO-997, FOO-998, FOO-999, FOO-1000, FOO-1001, FOO-1002, FOO-1003, FOO-1005, FOO-1006, FOO-1007, FOO-1008, FOO-1009, FOO-1010

**Approach:** 17 TDD tasks ordered foundation-first (F1–F4 schema/types) → engine-correctness (E1–E3) → cache/invalidation (C1–C4) → UI surfacing (U1–U4) → API integration (A1–A2). The hot file `src/lib/daily-goals.ts` is touched by ~10 tasks but most are surgical changes inside the cache-hit and invalidate paths, so the work is sequential and conflict-free under a single worker. Foundation tasks gate everything downstream; the lead must merge them before workers start dependent clusters. One Drizzle migration covers all DB changes (F1 + E3 column + F4 constraint can fold into one or two migrations — drizzle-kit will generate accordingly).

**Scope:** 17 tasks, ~22 files modified, 0 new files (all edits to existing). 1–2 generated migrations covering all DB changes. Estimated effort score ~24–28 points (mostly M-sized tasks; C4 is L).

**Key Decisions:**
1. Profile-change invalidation scoped to today + forward only (FOO-995) — historical days stable.
2. Ratchet-up only, no projection seed (FOO-1009) — simpler, sufficient when paired with FOO-999's below-RMR guard.
3. Profile-version counter for race safety (FOO-996) — future-proof against multi-node, simpler than Promise-await coordination.
4. Stored audit columns (`goal_type`, `bmi_tier`) for consistency (FOO-993) — cache-hit no longer reconstructs from current Fitbit state.
5. Weight staleness uses warning + extended 14-day window (FOO-1010), not "soft block".
6. v1 API breaking change accepted (FOO-1008) — engine-computed goals replace Fitbit food-goal passthrough; `getFoodGoals` deleted.

**Risks:**
- C4 ratchet-up adds one activity-cache lookup per cache-hit. The 5-min cache absorbs most reads, but criticality must remain `"optional"` so the breaker can reject when headroom is low (graceful degrade).
- C2 version counter requires `users.macro_profile_version` to be present on every PATCH that changes profile. Defense in depth: F1's migration sets default 1 and NOT NULL; the test in C2 step 2 asserts the increment.
- F1 migration adds 4 columns to `daily_calorie_goals` plus 1 to `users`. If staging DB is far behind production, verify migration ordering before pushing.
- E2 partial threshold (1.05× RMR) may surface "Targets pending" longer than expected on rest days. If feedback is noisy, revisit the threshold or fall back to the 7-day projection seed deferred from FOO-1009.

**Out of Scope (deferred — stay in Backlog):**
- FOO-994 (per-user `ACTIVITY_MULTIPLIER` override) — needs UX design.
- FOO-1004 (BMI tier coefficient cliff smoothing) — needs interpolation strategy.
- FOO-1003's "graceful 429 countdown banner" sub-criterion — separate UX feature.
- 7-day caloriesOut projection seed mentioned in FOO-1009's hints — superseded by E2's below-RMR guard for this iteration.

---

## Iteration 1 — 2026-05-04

**Status:** COMPLETE
**Method:** single-agent (effective scope = 1 work unit; `src/lib/daily-goals.ts` touched by 11/17 tasks; foundation→cascade dependency chain prevents parallelism)

### Tasks Completed (17/17)

All foundation, engine, cache/invalidation, UI, and API tasks landed.

| ID | Task | Linear | Status |
|----|------|--------|--------|
| F1 | Audit columns + macro_profile_version (migration 0023) | FOO-993 | ✅ Review |
| F2 | Consolidate `BmiTier` to `src/types/index.ts` | FOO-1005 | ✅ Review |
| F3 | Raw `caloriesOut` in audit + UI display | FOO-1000 | ✅ Review |
| F4 | DB CHECK constraint on `users.macro_profile` (migration 0024) + warn-log | FOO-1001 | ✅ Review |
| E1 | Validate `caloriesOut` input (NaN/∞/<0/>30000 → INVALID_ACTIVITY_DATA) | FOO-998 | ✅ Review |
| E2 | `caloriesOut < rmr×1.05` → partial; extracted `computeRmr` | FOO-999 | ✅ Review |
| E3 | 14-day weight walk-back; `weightStale` flag; UI staleness warnings; null TTL split | FOO-1010 | ✅ Review |
| C1 | Profile-change invalidation scoped to today + forward | FOO-995 | ✅ Review |
| C2 | Profile-version counter (atomic increment in PATCH; mismatch triggers recompute) | FOO-996 | ✅ Review |
| C3 | Refresh from Fitbit invalidates today's daily-goals row | FOO-992 | ✅ Review |
| C4 | Ratchet-up recompute on read (`tryRatchetRecompute` helper) | FOO-1009 | ✅ Review |
| U1 | TargetsCard renders partial protein/fat with footnote | FOO-997 | ✅ Review |
| U2 | Settings TargetsCard refreshes date on visibility change | FOO-1007 | ✅ Review |
| U3 | Macro profile descriptions derived from engine constants (`describeProfile`) | FOO-1006 | ✅ Review |
| U4 | `FITBIT_BACKED_SWR_CONFIG` (no revalidateOnFocus, 30-min dedupe) | FOO-1003 | ✅ Review |
| A1 | Unify `/api/v1/nutrition-goals` to engine-computed; deleted `getFoodGoals`/`FitbitFoodGoals` | FOO-1008 | ✅ Review |
| A2 | Chat tools surface partial macros via `getOrComputeDailyGoals` | FOO-1002 | ✅ Review |

### Migrations

- **`drizzle/0023_young_doctor_faustus.sql`** — adds `goal_type`, `bmi_tier`, `profile_version`, `weight_logged_date` (nullable) to `daily_calorie_goals` and `macro_profile_version integer NOT NULL DEFAULT 1` to `users`.
- **`drizzle/0024_far_roland_deschain.sql`** — adds `users_macro_profile_chk` CHECK constraint constraining `users.macro_profile` to `('muscle_preserve', 'metabolic_flex')`.

Both documented in `MIGRATIONS.md` with pre-flight checks.

### Inline Fixes (post-bug-hunter)

Two real bugs caught and fixed before commit:

- **High** — Cache-hit path was re-throwing non-breaker errors from the new ratchet activity fetch (e.g. `FITBIT_API_ERROR`, `FITBIT_TOKEN_INVALID`), breaking the cache-hit even though stored macros are self-sufficient. Removed the activity re-throw; activity errors now silently skip the ratchet. Regression test added: "ratchet-up: serves stored row when activity fetch fails with non-breaker error."
- **Medium** — `/api/v1/nutrition-goals` silently fell through to single-date mode when only `?from=` (or only `?to=`) was provided, returning a structurally different response shape with no error signal. Added explicit XOR validation rejecting partial range params with HTTP 400. Two regression tests added.

### Verification

- **Unit/integration:** 3434 tests across 191 files — all passing.
- **Lint:** zero warnings (initial React-19 purity violation in `useRef({ ..., timestamp: Date.now() })` fixed by lazy-init inside `useEffect`).
- **Build:** production build successful (59 routes).
- **bug-hunter:** 2 bugs found, both fixed (above).

### Documentation

- `MIGRATIONS.md`: 4 entries (F1, F4, C1 behavior change, A1 API contract change).
- No new files created.

### Tasks Remaining

None. Implementation phase complete.

### Review Findings

Summary: 11 findings raised by 3-reviewer team (security, reliability, quality) on 33 changed files.
- FIX: 5 issues — Linear issues created (FOO-1023, 1024, 1025, 1026, 1027)
- DISCARDED: 6 findings — false positives or non-bugs (reasoning below)

**Issues requiring fix (Fix Plan below):**
- [HIGH] BUG: `hasMacros()` doesn't enforce non-null `caloriesOut` — latent null deref via `existing.caloriesOut!` at `src/lib/daily-goals.ts:371` could crash `targets-card.tsx:144`. (FOO-1023)
- [MEDIUM] TYPE: `"not_computed"` reason emitted by `/api/v1/nutrition-goals` range mode but missing from `NutritionGoals.reason` union in `src/types/index.ts:624-629`. (FOO-1024)
- [MEDIUM] CONVENTION: Cache-Control + ETag tests on `/api/v1/nutrition-goals` removed during FOO-1008 rewrite without replacement. (FOO-1025)
- [MEDIUM] CONVENTION: 5 Fitbit error-code mapping tests on `/api/v1/nutrition-goals` removed during FOO-1008 rewrite (FITBIT_CREDENTIALS_MISSING, FITBIT_TOKEN_INVALID, FITBIT_SCOPE_MISSING, FITBIT_RATE_LIMIT, FITBIT_API_ERROR). (FOO-1026)
- [MEDIUM] TEST: FOO-996 version-mismatch test uses `toHaveBeenCalled()` — cache-hit path also calls the same mock, so the test passes both paths. (FOO-1027)

**Discarded findings (not bugs):**
- [DISCARDED] [reliability] Race window in `tryRatchetRecompute` (`daily-goals.ts:108`) — reviewer themselves noted "Functionally safe... no action needed unless transaction desired." The version-check correctly catches the case on the next read; design is intentional non-transactional read-then-recompute with version mismatch as the safety net.
- [DISCARDED] [reliability] `invalidateUserDailyGoalsForProfileChange` doesn't reset F1 audit columns (`daily-goals.ts:602-621`) — reviewer says "Functionally safe but inconsistent." `hasMacros=false` forces full recompute (which overwrites F1 columns); version-check guard prevents any cache-hit from reading stale F1 data. Pure code-cleanliness with zero correctness impact.
- [DISCARDED] [reliability] NaN slips past `< rmrThreshold` guard at `daily-goals.ts:411` — reviewer notes "the result is correct... readability suggestion." Caught downstream by `computeMacroTargets` → INVALID_ACTIVITY_DATA → blocked. The current path produces correct behavior.
- [DISCARDED] [quality] `mapComputeResultToNutritionGoals` reimplemented inline as a mock — stylistic choice; the mock matches current behavior. Migrating to `vi.importActual` is a maintenance preference, not a bug.
- [DISCARDED] [quality] No boundary test at exactly 7 days for `computeWeightStale` — coverage gap, not a bug. The 8-day and 3-day tests bracket the boundary; semantics (`> 7`, strict greater-than) are clear from the implementation.
- [DISCARDED] [quality] No boundary test at exactly 90 days for the v1 range cap — coverage gap, not a bug. The `> 90 days` rejection is tested.

### Linear Updates
- FOO-992, 993, 995, 996, 997, 998, 999, 1000, 1001, 1002, 1003, 1005, 1006, 1007, 1008, 1009, 1010 → Review → Merge (originals)
- FOO-1023, 1024, 1025, 1026, 1027 → Created in Todo (Fix Plan)

<!-- REVIEW COMPLETE -->

---

## Fix Plan

**Source:** Review findings from Iteration 1
**Linear Issues:** [FOO-1023](https://linear.app/lw-claude/issue/FOO-1023), [FOO-1024](https://linear.app/lw-claude/issue/FOO-1024), [FOO-1025](https://linear.app/lw-claude/issue/FOO-1025), [FOO-1026](https://linear.app/lw-claude/issue/FOO-1026), [FOO-1027](https://linear.app/lw-claude/issue/FOO-1027)

### Fix 1: `hasMacros()` should require non-null `caloriesOut`
**Linear Issue:** [FOO-1023](https://linear.app/lw-claude/issue/FOO-1023)

1. **RED:** In `src/lib/__tests__/daily-goals.test.ts`, add test "cache-hit bypassed when stored row has null caloriesOut": pre-queue a stored row with `proteinGoal/carbsGoal/fatGoal/rmr/activityKcal/weightKg` populated but `caloriesOut: null`. Mock the full-compute Fitbit fetches. Assert `mockGetCachedActivitySummary` called with criticality `"important"` (slow path).
2. **GREEN:** In `src/lib/daily-goals.ts:183-192`, add `row.caloriesOut !== null` to the `hasMacros()` check.
3. Run `npx vitest run "daily-goals"` + `npm run typecheck`.

### Fix 2: Add `"not_computed"` to `NutritionGoals.reason` union
**Linear Issue:** [FOO-1024](https://linear.app/lw-claude/issue/FOO-1024)

1. **GREEN:** In `src/types/index.ts:624-629`, extend the `NutritionGoals.reason` union to include `"not_computed"`.
2. **REFACTOR:** In `src/app/api/v1/nutrition-goals/route.ts:115-126`, define a typed entry shape (e.g. `type RangeEntry = Pick<NutritionGoals, "calories" | "proteinG" | "carbsG" | "fatG" | "status" | "reason"> & { date: string }`) and assert the `entries` array conforms. This makes future drift on the reason union a compile error.
3. Run `npm run typecheck` (no behavioral test needed — pure type tightening). Run `npx vitest run "v1/nutrition-goals"` to confirm no regression.

### Fix 3: Restore Cache-Control + ETag tests on `/api/v1/nutrition-goals`
**Linear Issue:** [FOO-1025](https://linear.app/lw-claude/issue/FOO-1025)

1. **RED→GREEN:** In `src/app/api/v1/nutrition-goals/__tests__/route.test.ts`, add two tests:
   - `it("sets Cache-Control: private, no-cache on success", …)`: mock `getOrComputeDailyGoals` to return `status: "ok"`, call GET, assert `response.headers.get("Cache-Control") === "private, no-cache"`.
   - `it("returns ETag header on success", …)`: same setup, assert `response.headers.get("ETag")` matches `/^"[a-f0-9]{16}"$/`.
2. Run `npx vitest run "v1/nutrition-goals"`.

### Fix 4: Restore Fitbit error-code mapping tests on `/api/v1/nutrition-goals`
**Linear Issue:** [FOO-1026](https://linear.app/lw-claude/issue/FOO-1026)

1. **RED→GREEN:** In `src/app/api/v1/nutrition-goals/__tests__/route.test.ts`, add 5 tests, one per error code:
   - "returns 424 when Fitbit credentials are missing" — mock `getOrComputeDailyGoals` to reject with `new Error("FITBIT_CREDENTIALS_MISSING")`, assert status 424 + `data.error.code === "FITBIT_CREDENTIALS_MISSING"`.
   - "returns 401 when Fitbit token is invalid" — `FITBIT_TOKEN_INVALID` → 401.
   - "returns 403 when Fitbit scope is missing" — `FITBIT_SCOPE_MISSING` → 403.
   - "returns 429 when Fitbit rate-limit is hit" — `FITBIT_RATE_LIMIT` → 429.
   - "returns 502 when Fitbit API errors" — `FITBIT_API_ERROR` → 502.
2. Run `npx vitest run "v1/nutrition-goals"`.

### Fix 5: Strengthen FOO-996 version-mismatch test
**Linear Issue:** [FOO-1027](https://linear.app/lw-claude/issue/FOO-1027)

1. In `src/lib/__tests__/daily-goals.test.ts`, locate the FOO-996 test "cache-hit falls through to full compute when stored profile_version mismatches user version". Replace `expect(mockGetCachedActivitySummary).toHaveBeenCalled()` with `expect(mockGetCachedActivitySummary).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), "important")` (full-compute criticality).
2. Sanity-check by temporarily inverting the version-check comparison in `daily-goals.ts:267-268` and re-running the test — it should fail. Revert the inversion.
3. Run `npx vitest run "daily-goals"` + `npm run typecheck`.

---

## Iteration 2 — 2026-05-04

**Status:** COMPLETE
**Method:** single-agent (effective scope = 5 S-sized fixes across 2 independent units = 5 effort points; below the 6-point worker threshold)

### Tasks Completed (5/5)

All Fix Plan items landed.

| ID | Task | Linear | Status |
|----|------|--------|--------|
| Fix 1 | `hasMacros()` requires non-null `caloriesOut` (+ regression test) | FOO-1023 | ✅ Review |
| Fix 2 | `"not_computed"` added to `NutritionGoals.reason` union; v1 range entries pinned to `RangeEntry = Pick<NutritionGoals, …> & { date: string }` | FOO-1024 | ✅ Review |
| Fix 3 | Restored Cache-Control: private, no-cache + ETag tests on `/api/v1/nutrition-goals` (2 tests) | FOO-1025 | ✅ Review |
| Fix 4 | Restored Fitbit error-code mapping tests on `/api/v1/nutrition-goals` (5 tests covering 424/401/403/429/502) | FOO-1026 | ✅ Review |
| Fix 5 | Strengthened FOO-996 version-mismatch assertion to discriminate slow-path criticality `"important"` from cache-hit ratchet `"optional"` | FOO-1027 | ✅ Review |

### Files Modified

- `src/lib/daily-goals.ts` — one-line guard added to `hasMacros()`.
- `src/lib/__tests__/daily-goals.test.ts` — 1 new test (FOO-1023); FOO-996 assertion strengthened (FOO-1027).
- `src/types/index.ts` — `"not_computed"` added to `NutritionGoals.reason` union.
- `src/app/api/v1/nutrition-goals/route.ts` — typed `RangeEntry` introduced; entries array pinned to it.
- `src/app/api/v1/nutrition-goals/__tests__/route.test.ts` — 7 new tests (2 Cache-Control/ETag + 5 Fitbit error mappings).

### Verification

- **Unit/integration:** 3442 tests across 191 files — all passing (+8 new tests vs Iteration 1's 3434).
- **Lint:** zero warnings.
- **Build:** production build successful (59 routes).
- **bug-hunter:** 0 bugs found — verdict SHIP.

### Migrations

None — no schema changes in this iteration.

### Tasks Remaining

None. Fix Plan complete.

### Linear Updates
- FOO-1023, 1024, 1025, 1026, 1027 → Todo → In Progress → Review
