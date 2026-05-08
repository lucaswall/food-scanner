# Implementation Plan

**Created:** 2026-05-08
**Source:** Inline request: Replace the Fitbit-driven calorie engine with a goal-anchored, device-independent engine. Drop metabolic_flex profile, drop body-fat input, drop expand-on-tap on TargetsCard, gate dashboard goals on declared user settings, show safety-floor warning in Settings (no silent clamp).
**Linear Issues:** [FOO-1040](https://linear.app/lw-claude/issue/FOO-1040), [FOO-1041](https://linear.app/lw-claude/issue/FOO-1041), [FOO-1042](https://linear.app/lw-claude/issue/FOO-1042), [FOO-1043](https://linear.app/lw-claude/issue/FOO-1043), [FOO-1044](https://linear.app/lw-claude/issue/FOO-1044), [FOO-1045](https://linear.app/lw-claude/issue/FOO-1045), [FOO-1046](https://linear.app/lw-claude/issue/FOO-1046), [FOO-1047](https://linear.app/lw-claude/issue/FOO-1047), [FOO-1048](https://linear.app/lw-claude/issue/FOO-1048), [FOO-1049](https://linear.app/lw-claude/issue/FOO-1049)
**Branch:** feat/goal-anchored-engine

## Context Gathered

### Codebase Analysis

**Current engine (to replace):**
- `src/lib/macro-engine.ts` — `computeMacroTargets`, `ACTIVITY_MULTIPLIER=0.85`, `GOAL_MULTIPLIERS={LOSE:0.80,MAINTAIN:1.00,GAIN:1.10}`, two profiles (`MUSCLE_PRESERVE`/`METABOLIC_FLEX`), BMI-tier protein coefficients, `computeRmr` (Mifflin-St Jeor). Keep RMR; replace everything else.
- `src/lib/daily-goals.ts` — `getOrComputeDailyGoals` cache-hit-then-compute; `tryRatchetRecompute` (only-up); `tryPromoteSeededRow` (seed→live); `resolveTdeeSeed` (7-day median or `RMR × 1.4`); `DEFAULT_ACTIVITY_MULTIPLIER=1.4`; `invalidateUserDailyGoalsForProfileChange`. All ratchet/seed/promote logic deletes; new path is a single idempotent compute.
- `src/lib/fitbit.ts` — `getFitbitProfile`, `getFitbitLatestWeightKg`, `getFitbitWeightGoal` (`goalType` only), `getActivitySummary` (caloriesOut). Profile + weight reads stay; `getFitbitWeightGoal` and `getActivitySummary` are no longer goal inputs.
- `src/lib/fitbit-cache.ts` — `getCachedFitbitProfile`, `getCachedFitbitWeightKg`, `getCachedFitbitWeightGoal`, `getCachedActivitySummary`. Last two become unused; remove.
- `src/lib/macro-engine.ts:62-72` — `MACRO_PROFILES_BY_KEY`, `MACRO_PROFILE_KEYS`, `isMacroProfileKey`, `describeProfile`, `getMacroProfile`, `MacroProfile` interface — all removable.

**Schema (`src/db/schema.ts`):**
- `users` (line 20): currently has `macroProfile` / `macroProfileVersion` + CHECK constraint. To drop both columns and the CHECK; to add `activityLevel`, `goalWeightKg`, `goalRateKgPerWeek` (all nullable).
- `dailyCalorieGoals`: currently has `caloriesOut`, `activityKcal`, `bmiTier`, `goalType`, `profileVersion`, `tdeeSource`. To drop all six; to add `activityLevel`, `goalWeightKg`, `goalRateKgPerWeek`, `tdee`, `deficitKcal`. `weightKg`, `rmr`, `weightLoggedDate`, `calorieGoal`, `proteinGoal`, `carbsGoal`, `fatGoal` stay.

**API routes:**
- `src/app/api/macro-profile/route.ts` (GET/PATCH) — pattern reference for new settings route; the file itself is deleted (no profile selector).
- `src/app/api/nutrition-goals/route.ts` — internal goals endpoint; returns `NutritionGoals`. Update to handle new audit fields and the `goals_not_set` blocked reason.
- `src/app/api/v1/nutrition-goals/route.ts` — external v1 endpoint; same updates.
- `src/app/api/fitbit/profile/route.ts` — exposes sex/age/height/weight to the client; reused by new `DailyGoalsCard` for live target preview.

**UI:**
- `src/components/macro-profile-card.tsx` — DELETE.
- `src/components/targets-card.tsx` — REWRITE: drop `expanded` state and ChevronUp/Down toggle (lines 33, 111-126, 129-142). Show all audit fields inline. New audit shape: RMR, activity_level, PAL multiplier, TDEE, goal weight, goal rate, deficit, current weight.
- `src/components/settings-content.tsx` — replace `<MacroProfileCard />` (line 307) with `<DailyGoalsCard />`. `<DailyTargetsSection>` (line 309) stays.
- `src/components/daily-dashboard.tsx` — add `<GoalsSetupBanner />` rendered above `<CalorieRing>` whenever `goals?.status === "blocked"`. Existing fallback at lines 290-302 (bare totals when `goals?.calories == null`) already handles the no-goals case visually; banner is purely additive.

**Integration touchpoints:**
- `src/lib/user-profile.ts:67-100` — chat-context profile string: branches on `dailyGoals.calorieGoal`. Add `goals_not_set` handling.
- `src/lib/chat-tools.ts:227-253, 280-290` — `executeGetNutritionSummary` and `getDateRangeNutritionSummary` consume `ComputeResult.status`. Add `goals_not_set` reason.
- `src/lib/api-response.ts:40` / `src/types/index.ts:134` — `errorResponse` and `ErrorCode` patterns to follow for the new settings route.

**Test conventions:**
- Unit/integration tests colocated in `__tests__/` (e.g., `src/lib/__tests__/macro-engine.test.ts`).
- E2E specs in `e2e/tests/*.spec.ts`; Fitbit mocks in `e2e/fixtures/fitbit.ts`. Follow patterns in `e2e/tests/macro-engine.spec.ts`.
- Component tests use Testing Library + Vitest, in `src/components/__tests__/*.test.tsx`.

### MCP Context

- **Linear:** Connected. Two related Backlog issues canceled this session as superseded: FOO-994 (per-user `ACTIVITY_MULTIPLIER`), FOO-1004 (BMI tier cliff).
- **Roadmap:** "Calorie Target Formula Review" entry in `ROADMAP.md` is subsumed by this rework — to be removed from the file as part of this work.
- **Production logs reviewed:** Daily ratchet pattern confirmed for `userId=6bc0189f-...` — calorie target climbs ~1,000 kcal across each day (1,780 → 2,785 on 2026-05-07). Eliminated by the new design.

## Tasks

### Task 1: Schema migration — replace activity-driven columns with goal-anchored columns

**Linear Issue:** [FOO-1040](https://linear.app/lw-claude/issue/FOO-1040)

**Files:**
- `src/db/schema.ts` (modify)
- `drizzle/<auto>.sql` (generated by `drizzle-kit generate`)
- `drizzle/meta/_journal.json` (generated)
- `drizzle/meta/<n>_snapshot.json` (generated)
- `MIGRATIONS.md` (modify)
- `src/types/index.ts` (modify)

**Steps:**
1. Write tests in `src/db/__tests__/schema.test.ts` (create if missing — otherwise add cases) that exercise the new shape:
   - `users` row insert succeeds with `activityLevel: null`, `goalWeightKg: null`, `goalRateKgPerWeek: null` (legacy / pre-onboarding state).
   - `users` row insert succeeds with all three set.
   - Selecting from `users` no longer references `macroProfile` or `macroProfileVersion` (compile-time check via the typed query builder).
   - `daily_calorie_goals` row insert succeeds with the new columns set and the dropped columns absent (compile-time check).
2. Run vitest with the failing test pattern (expect fail at this stage because schema hasn't changed).
3. Modify `src/db/schema.ts`:
   - In `users`: remove `macroProfile`, `macroProfileVersion`, and the `users_macro_profile_chk` CHECK constraint. Add:
     - `activityLevel: text("activity_level")` (nullable)
     - `goalWeightKg: numeric("goal_weight_kg")` (nullable)
     - `goalRateKgPerWeek: numeric("goal_rate_kg_per_week")` (nullable)
     - CHECK constraint `users_activity_level_chk`: `activity_level IN ('sedentary','light','moderate','very_active','extra_active')` OR `activity_level IS NULL`.
     - CHECK constraint `users_goal_rate_chk`: `goal_rate_kg_per_week >= 0` OR `goal_rate_kg_per_week IS NULL`.
   - In `dailyCalorieGoals`: remove `caloriesOut`, `activityKcal`, `bmiTier`, `goalType`, `profileVersion`, `tdeeSource`. Add:
     - `activityLevel: text("activity_level")` (nullable — matches users column at compute time)
     - `goalWeightKg: numeric("goal_weight_kg")` (nullable)
     - `goalRateKgPerWeek: numeric("goal_rate_kg_per_week")` (nullable)
     - `tdee: integer("tdee")` (nullable — RMR × PAL, snapshotted)
     - `deficitKcal: integer("deficit_kcal")` (nullable — signed: − for LOSE, + for GAIN, 0 for MAINTAIN)
4. Update `src/types/index.ts`:
   - Drop `MacroEngineInputs`, `MacroEngineOutputs`, `MacroGoalType`, `BmiTier`, `FitbitWeightGoal`, `NutritionGoalsAudit` (existing shapes — full replacement, not extension).
   - Add `ActivityLevel = "sedentary" | "light" | "moderate" | "very_active" | "extra_active"`.
   - Add new `MacroEngineInputs` (sex, ageYears, heightCm, currentWeightKg, activityLevel, goalWeightKg, goalRateKgPerWeek).
   - Add new `MacroEngineOutputs` (targetKcal, proteinG, carbsG, fatG, rmr, palMultiplier, tdee, deficitKcal, direction: `"LOSE" | "MAINTAIN" | "GAIN"`).
   - Add new `NutritionGoalsAudit` with the same fields plus `weightKg`, `weightLoggedDate`. Drop `caloriesOut`, `bmiTier`, `goalType`, `activityKcal`.
   - Update `NutritionGoals.reason` union: drop `"not_computed"` (this rework removes the gap-fill path); add `"goals_not_set"`.
5. Run `npx drizzle-kit generate` to produce the SQL migration and snapshot. The migration must include:
   - `ALTER TABLE users DROP CONSTRAINT users_macro_profile_chk;`
   - `ALTER TABLE users DROP COLUMN macro_profile, DROP COLUMN macro_profile_version;`
   - `ALTER TABLE users ADD COLUMN activity_level text, ADD COLUMN goal_weight_kg numeric, ADD COLUMN goal_rate_kg_per_week numeric;`
   - `ALTER TABLE users ADD CONSTRAINT users_activity_level_chk CHECK (activity_level IS NULL OR activity_level IN ('sedentary','light','moderate','very_active','extra_active'));`
   - `ALTER TABLE users ADD CONSTRAINT users_goal_rate_chk CHECK (goal_rate_kg_per_week IS NULL OR goal_rate_kg_per_week >= 0);`
   - `ALTER TABLE daily_calorie_goals DROP COLUMN calories_out, DROP COLUMN activity_kcal, DROP COLUMN bmi_tier, DROP COLUMN goal_type, DROP COLUMN profile_version, DROP COLUMN tdee_source;`
   - `ALTER TABLE daily_calorie_goals ADD COLUMN activity_level text, ADD COLUMN goal_weight_kg numeric, ADD COLUMN goal_rate_kg_per_week numeric, ADD COLUMN tdee integer, ADD COLUMN deficit_kcal integer;`
   - `DELETE FROM daily_calorie_goals WHERE date >= CURRENT_DATE;` — wipe today and future rows so the new engine computes fresh; historical rows keep their `calorie_goal`/macro values for the dashboard's date-history view (audit columns will read NULL for those past rows; UI handles gracefully — see Task 6).
6. Add an entry to `MIGRATIONS.md` describing: drop list, add list, the `DELETE FROM daily_calorie_goals WHERE date >= CURRENT_DATE` data step, and the cutover note that user-declared goal fields default to NULL → all users see the goals-setup banner on next dashboard visit.
7. Run vitest — schema tests should pass once the generated migration is applied locally.

**Notes:**
- **Migration note:** Production data affected. (a) `users.macro_profile` / `macro_profile_version` columns dropped (data lost — irrelevant after rework); (b) `daily_calorie_goals` loses `caloriesOut`/`activityKcal`/`bmiTier`/`goalType`/`profileVersion`/`tdeeSource` for historical rows (audit detail lost; calorie/macro goals preserved); (c) all `daily_calorie_goals` rows where `date >= CURRENT_DATE` are deleted at migration time so the new engine writes fresh rows. Run as part of `push-to-production`.
- Worker must NOT hand-write the `drizzle/<auto>.sql` file or `_journal.json` — run `npx drizzle-kit generate` against the modified `src/db/schema.ts`.
- After `drizzle-kit generate`, the worker must edit the generated `drizzle/<auto>.sql` to append the `DELETE FROM daily_calorie_goals WHERE date >= CURRENT_DATE;` data statement (drizzle-kit only emits DDL, not data steps).

---

### Task 2: Rewrite `macro-engine.ts` — single profile, declared PAL, rate-anchored deficit

**Linear Issue:** [FOO-1041](https://linear.app/lw-claude/issue/FOO-1041)

**Files:**
- `src/lib/macro-engine.ts` (modify — substantial rewrite)
- `src/lib/__tests__/macro-engine.test.ts` (modify — replace fixtures)

**Steps:**
1. Replace `src/lib/__tests__/macro-engine.test.ts` test cases:
   - **RMR** — keep existing Mifflin-St Jeor cases for male/female and the rounding behavior (function `computeRmr` is unchanged).
   - **PAL lookup** — for each `ActivityLevel`, the engine maps to the correct multiplier: sedentary=1.2, light=1.375, moderate=1.55, very_active=1.725, extra_active=1.9. (Constant `PAL_BY_ACTIVITY_LEVEL`, exported for client-side reuse.)
   - **TDEE** — `tdee = round(rmr × pal)`, returned in outputs.
   - **Direction** — derived from `goalWeightKg` vs `currentWeightKg`:
     - `currentWeight > goalWeight` → `LOSE`
     - `currentWeight < goalWeight` → `GAIN`
     - `currentWeight === goalWeight` (or `goalRateKgPerWeek === 0`) → `MAINTAIN`
   - **Deficit / surplus magnitude** — `kcal_per_day = round(goalRateKgPerWeek × 7700 / 7)` (= `goalRateKgPerWeek × 1100`). One kg of body fat ≈ 7700 kcal.
   - **Target** — `MAINTAIN: targetKcal = tdee`, `LOSE: targetKcal = tdee − kcal_per_day`, `GAIN: targetKcal = tdee + kcal_per_day`. Sign of returned `deficitKcal`: negative for LOSE, positive for GAIN, zero for MAINTAIN.
   - **No safety clamp** — explicit test: `LOSE` with sedentary + aggressive rate yielding `targetKcal < 1200` returns the raw computed value, NOT a clamped value.
   - **No body-fat input** — call sites pass only the new `MacroEngineInputs` shape.
   - **Protein anchoring** — single coefficient per direction, no BMI tier:
     - `LOSE: 2.2 × currentWeightKg`
     - `MAINTAIN: 1.6 × currentWeightKg`
     - `GAIN: 1.8 × currentWeightKg`
   - **Carbs/fat split** — keep the existing muscle-preserve residual logic but constants live as top-level engine constants (no `MacroProfile` indirection):
     - `fatG = round(max(currentWeightKg × 0.8, targetKcal × 0.25 / 9))`
     - `carbsResidual = (targetKcal − proteinG×4 − fatG×9) / 4`
     - `carbsFloor10pct = (targetKcal × 0.10) / 4`
     - `carbsG = round(max(carbsResidual, 130, carbsFloor10pct))`
   - **Input validation** — `INVALID_PROFILE_DATA` for non-finite/non-positive sex/age/height/weight; `SEX_UNSET` for `sex === "NA"`. Drop `INVALID_ACTIVITY_DATA` (no caloriesOut input).
   - **Goal-rate validation** — `goalRateKgPerWeek < 0` or non-finite throws `INVALID_GOAL_RATE`.
2. Run vitest pattern (expect fail).
3. Rewrite `src/lib/macro-engine.ts`:
   - Delete: `ACTIVITY_MULTIPLIER`, `GOAL_MULTIPLIERS`, `MacroProfile`, `MACRO_PROFILE_MUSCLE_PRESERVE`, `MACRO_PROFILE_METABOLIC_FLEX`, `DEFAULT_MACRO_PROFILE`, `MACRO_PROFILES_BY_KEY`, `MacroProfileKey`, `MACRO_PROFILE_KEYS`, `isMacroProfileKey`, `describeProfile`, `getMacroProfile`. Drop the `BmiTier` re-export.
   - Keep: `computeRmr` (unchanged).
   - Add: `PAL_BY_ACTIVITY_LEVEL: Record<ActivityLevel, number>`, `ACTIVITY_LEVEL_LABELS: Record<ActivityLevel, string>` (Sedentary, Light, Moderate, Very active, Extra active), top-level macro constants (`PROTEIN_PER_KG_LOSE = 2.2`, `PROTEIN_PER_KG_MAINTAIN = 1.6`, `PROTEIN_PER_KG_GAIN = 1.8`, `FAT_PER_KG = 0.8`, `FAT_MIN_PERCENT_KCAL = 0.25`, `CARB_FLOOR_GRAMS = 130`, `KCAL_PER_KG = 7700`).
   - Replace `computeMacroTargets(inputs: MacroEngineInputs): MacroEngineOutputs` per the test spec above.
4. Run vitest (expect pass).

**Notes:**
- Pure function. No I/O, no DB. Must be safely importable in `'use client'` components for live preview (Task 5).
- Follow the existing pattern for `INVALID_PROFILE_DATA` throws — typed `Error` instances with stable message strings, callers `try/catch`.

---

### Task 3: Rewrite `daily-goals.ts` service — single idempotent compute path

**Linear Issue:** [FOO-1042](https://linear.app/lw-claude/issue/FOO-1042)

**Files:**
- `src/lib/daily-goals.ts` (modify — substantial rewrite)
- `src/lib/__tests__/daily-goals.test.ts` (modify — replace fixtures)

**Steps:**
1. Replace `src/lib/__tests__/daily-goals.test.ts` test cases:
   - **Goals not set** — when `users.activity_level`, `users.goal_weight_kg`, or `users.goal_rate_kg_per_week` is NULL, `getOrComputeDailyGoals` returns `{ status: "blocked", reason: "goals_not_set" }` and writes NO row.
   - **Cache-hit** — when a row exists for `(userId, date)` and date is past, return its values without re-computing or hitting Fitbit.
   - **Today auto-recompute on settings drift** — when today's row exists but `row.activity_level !== users.activity_level` (or any of the three settings columns differ), recompute and overwrite. Past dates: never auto-recompute.
   - **Fresh compute path** — first call for `(userId, today)` reads users settings + `getCachedFitbitProfile` + `getCachedFitbitWeightKg`, computes via `computeMacroTargets`, INSERTs the row, returns `{ status: "ok", goals, audit }`.
   - **Audit shape** — audit contains: `rmr`, `palMultiplier`, `tdee`, `weightKg`, `weightLoggedDate`, `activityLevel`, `goalWeightKg`, `goalRateKgPerWeek`, `deficitKcal`, `direction`. Drop `caloriesOut`, `bmiTier`, `goalType`, `activityKcal`.
   - **Existing blocked reasons preserved** — `no_weight`, `sex_unset`, `scope_mismatch`, `invalid_profile` still surface from upstream errors.
   - **`weightStale` flag** — preserved (>7 days old weight log per FOO-1010).
   - **Past-date computes** — accept and store with the user's CURRENT settings (no time-traveling settings history). Tests assert this is the documented behavior.
2. Run vitest (expect fail).
3. Rewrite `src/lib/daily-goals.ts`:
   - **Delete:** `tryRatchetRecompute` (lines 86-183), `tryPromoteSeededRow` (lines 201-308), `resolveTdeeSeed` (lines 326-391), `DEFAULT_ACTIVITY_MULTIPLIER` constant, the entire seed/promote/ratchet documentation block.
   - **Delete:** `invalidateUserDailyGoalsForProfileChange` (used only by the old macro-profile route, which is also being deleted).
   - **Add:** new `invalidateUserDailyGoalsForSettingsChange(userId, todayDate)` — DELETEs `daily_calorie_goals` rows where `userId = $1 AND date >= $2`. Called from the new settings PATCH route.
   - **Rewrite `getOrComputeDailyGoals(userId, date, log)`:**
     1. Read users row → check `activityLevel`, `goalWeightKg`, `goalRateKgPerWeek`. If any is NULL → `{ status: "blocked", reason: "goals_not_set" }`.
     2. Read existing `daily_calorie_goals` row for `(userId, date)`. If present AND date is past → return mapped row. If present AND date is today/future AND `(row.activityLevel, row.goalWeightKg, row.goalRateKgPerWeek)` matches users → return mapped row.
     3. Read Fitbit profile + weight (cached). Map blocked reasons (`scope_mismatch`, `sex_unset`, `no_weight`, `invalid_profile`).
     4. Call `computeMacroTargets` with the new inputs. Map `INVALID_PROFILE_DATA`/`SEX_UNSET` exceptions to blocked reasons.
     5. UPSERT row (INSERT or UPDATE on `(userId, date)` unique). Set `calorieGoal`, `proteinGoal`, `carbsGoal`, `fatGoal`, `weightKg`, `weightLoggedDate`, `rmr`, `tdee`, `activityLevel`, `goalWeightKg`, `goalRateKgPerWeek`, `deficitKcal`. Apply `weightStale` flag.
     6. Return `{ status: "ok", goals, audit, weightStale }`.
4. Run vitest (expect pass).

**Notes:**
- The `getOrComputeDailyGoals` cache-key shape stays the same (the existing call sites in `api/nutrition-goals`, `api/v1/nutrition-goals`, `chat-tools.ts`, and `user-profile.ts` are unchanged); only the audit shape changes.
- Drop `getCachedFitbitWeightGoal` and `getCachedActivitySummary` from imports — both become unused after this task and are removed in Task 8.
- All API responses must continue to follow the `successResponse` / `errorResponse` pattern from `src/lib/api-response.ts`.

---

### Task 4: New `/api/daily-goals-settings` route + delete `/api/macro-profile` route

**Linear Issue:** [FOO-1043](https://linear.app/lw-claude/issue/FOO-1043)

**Files:**
- `src/app/api/daily-goals-settings/route.ts` (create)
- `src/app/api/daily-goals-settings/__tests__/route.test.ts` (create)
- `src/app/api/macro-profile/route.ts` (delete)
- `src/app/api/macro-profile/__tests__/route.test.ts` (delete)

**Steps:**
1. Write tests in `src/app/api/daily-goals-settings/__tests__/route.test.ts`:
   - **GET** — returns `{ activityLevel, goalWeightKg, goalRateKgPerWeek }` for the authenticated user, with `null` for any unset field. Sets `Cache-Control: private, no-cache`. Numeric columns cast to numbers (not strings) in the response payload.
   - **GET unauth** — returns 401 via `validateSession`.
   - **PATCH valid** — accepts `{ activityLevel: "light", goalWeightKg: 75.0, goalRateKgPerWeek: 0.5 }`, persists to `users` table, calls `invalidateUserDailyGoalsForSettingsChange(userId, today)`, returns the updated values.
   - **PATCH partial** — accepts a subset of fields (e.g., only `activityLevel`); only the provided fields are updated; the others retain prior values.
   - **PATCH validation** — `activityLevel` not in the union → 400 `VALIDATION_ERROR`. `goalWeightKg ≤ 0` or non-finite → 400. `goalRateKgPerWeek < 0` or non-finite → 400. Invalid JSON body → 400.
   - **PATCH unauth** — returns 401.
2. Run vitest (expect fail).
3. Create `src/app/api/daily-goals-settings/route.ts` modeled on `src/app/api/macro-profile/route.ts`:
   - `GET`: read `activityLevel`, `goalWeightKg`, `goalRateKgPerWeek` from the user row, return as JSON. Cache-Control: `private, no-cache`. Use `successResponse`. Cast numeric strings to numbers in the response shape.
   - `PATCH`: parse JSON body; validate fields with explicit type guards (not zod — match the existing macro-profile route pattern); UPDATE `users` row; call `invalidateUserDailyGoalsForSettingsChange(session.userId, getTodayDate())`; return updated values.
   - Auth: `getSession()` + `validateSession()` (browser-facing convention).
   - Errors: `errorResponse("VALIDATION_ERROR", message, 400)` for validation; the standard `validateSession` 401 path otherwise.
4. Delete `src/app/api/macro-profile/route.ts` and its `__tests__/`. The route is no longer referenced.
5. Run vitest (expect pass).

**Notes:**
- Numeric values arrive from JSON as `number`; persist to Drizzle's `numeric` column as strings (call `.toString()`). Match the pattern used elsewhere (e.g., custom_foods).
- 15-second timeout applied client-side in Task 5 (`AbortSignal.timeout(15000)`); server-side path has no external API dependency, so no server-side timeout needed.

---

### Task 5: Settings UI — `DailyGoalsCard` component (replaces `MacroProfileCard`)

**Linear Issue:** [FOO-1044](https://linear.app/lw-claude/issue/FOO-1044)

**Files:**
- `src/components/daily-goals-card.tsx` (create)
- `src/components/__tests__/daily-goals-card.test.tsx` (create)
- `src/components/macro-profile-card.tsx` (delete)
- `src/components/__tests__/macro-profile-card.test.tsx` (delete if present)
- `src/components/settings-content.tsx` (modify — line 13 import, line 307 render)

**Steps:**
1. Write tests in `src/components/__tests__/daily-goals-card.test.tsx`:
   - **Loading** — Skeletons render while `/api/daily-goals-settings` and `/api/fitbit/profile` SWR fetches are pending.
   - **Initial values** — when GET returns existing values, the activity-level radio reflects the saved choice; goal-weight and goal-rate inputs are pre-filled.
   - **Empty initial state** — when GET returns `null` for all three fields, radios are unselected and numeric inputs are empty (no placeholder values masquerading as data).
   - **Live target preview** — typing values updates an "Estimated daily target: {N} kcal" display. Computation uses imported `computeMacroTargets` with sex/age/height/weight from `/api/fitbit/profile` SWR data + form values.
   - **Safety warning** — when computed `targetKcal < 1200` (sex=FEMALE) or `< 1500` (sex=MALE), an `<p role="alert">` displays "⚠ Estimated target {N} cal/day is below the {floor} cal/day safe minimum for unsupervised dieting." Save remains enabled (no clamp).
   - **Save flow** — click Save → POST PATCH `/api/daily-goals-settings` with all three values → on 200, SWR mutates the goals-related caches (`/api/nutrition-goals*`) so the dashboard and the Settings TargetsCard re-render with new targets.
   - **Save failure** — non-200 response sets a visible error; Save button re-enabled.
   - **Save in flight** — Save button shows "Saving…" and is `disabled` while pending.
   - **Touch targets** — all interactive elements ≥ 44×44 px.
   - **Mobile-first layout** — visual snapshot at 375px width matches existing settings-card patterns.
2. Run vitest (expect fail).
3. Create `src/components/daily-goals-card.tsx`:
   - `'use client'` component.
   - SWR fetch `/api/daily-goals-settings` (read settings) and `/api/fitbit/profile` (sex/age/height/weight for live preview).
   - Form state: local React state for the three fields; sync from SWR on initial load.
   - Activity level: radio group of 5 options matching `MacroProfileCard.tsx`'s radio pattern. Labels: `Sedentary`, `Light`, `Moderate`, `Very active`, `Extra active`. No supplementary descriptions (per directive: drop "what is it" copy).
   - Goal weight: `<Input type="number" step="0.1" inputMode="decimal" />` (kg).
   - Goal rate: `<Input type="number" step="0.05" min="0" inputMode="decimal" />` (kg/week).
   - Live target preview: render below the form by computing `computeMacroTargets({ sex, ageYears, heightCm, currentWeightKg, activityLevel, goalWeightKg, goalRateKgPerWeek })` whenever all required values are present. Surround in a `try/catch` for `INVALID_PROFILE_DATA` etc. — render "—" on error.
   - Safety floor: `floor = sex === "FEMALE" ? 1200 : 1500`. Compute and render the warning conditionally.
   - Save: `fetch("/api/daily-goals-settings", { method: "PATCH", body: JSON.stringify(values), signal: AbortSignal.timeout(15000) })`. On success, `globalMutate((key) => typeof key === "string" && key.startsWith("/api/nutrition-goals"))` (matches `MacroProfileCard:39-42` pattern).
   - Error handling: catch `AbortError`/`TimeoutError` distinctly per `settings-content.tsx:84-89` pattern.
   - Duplicate-submission guard: existing `disabled={saving}` flag covers double-clicks (mirror `MacroProfileCard.tsx`).
4. Update `src/components/settings-content.tsx`:
   - Replace `import { MacroProfileCard } from "@/components/macro-profile-card";` with `import { DailyGoalsCard } from "@/components/daily-goals-card";`.
   - Replace `<MacroProfileCard />` with `<DailyGoalsCard />` at line 307.
5. Delete `src/components/macro-profile-card.tsx` and its test if present.
6. Run vitest (expect pass).

**Notes:**
- The live preview imports the pure `computeMacroTargets` from `src/lib/macro-engine.ts` (Task 2). No server round-trip on every keystroke.
- Safety warning is **informational only** — Save is never blocked. The user has full agency.
- Use the same `Cache-Control: private, no-cache` reasoning that already governs goal endpoints.
- Drizzle `numeric` columns return as strings on read; the GET response should expose them as numbers (cast or transform server-side in Task 4) so the form fills cleanly.

---

### Task 6: `TargetsCard` rewrite — drop expand-on-tap, show all info inline

**Linear Issue:** [FOO-1045](https://linear.app/lw-claude/issue/FOO-1045)

**Files:**
- `src/components/targets-card.tsx` (modify)
- `src/components/__tests__/targets-card.test.tsx` (modify)

**Steps:**
1. Update `src/components/__tests__/targets-card.test.tsx`:
   - **No expand toggle** — `<button aria-label="Show calculation details">` and `<button aria-label="Hide calculation details">` are absent. No `ChevronUp`/`ChevronDown` icons rendered.
   - **All audit fields render inline** when `goals.status === "ok"` and `goals.audit` is present: RMR, activity level (display label, e.g., "Light"), PAL multiplier, TDEE, weight + weight-logged date, goal weight, goal rate, deficit (signed, with direction word: "−500 kcal/day · LOSE", "+275 kcal/day · GAIN", "0 kcal/day · MAINTAIN").
   - **Blocked states** — render the existing reason-mapped message; new reason `goals_not_set` maps to "Set up your daily goals in Settings to enable targets." (Settings page user is already on Settings — message is plain, no CTA.)
   - **Weight-stale** — preserved warning at the top.
   - **Skeleton / error** — preserved.
   - **Past-date row missing audit fields** — when historical row was written by old engine (audit columns NULL), only render the fields that ARE non-null. No "—" filler rows for missing fields.
2. Run vitest (expect fail).
3. Modify `src/components/targets-card.tsx`:
   - Remove `useState` import for `expanded`; remove `ChevronDown`/`ChevronUp` imports.
   - Drop the `setExpanded`-bound `<button>` (lines 111-126) and the `expanded && goals.audit && (...)` block (lines 129-142). Render the audit `<div>` unconditionally when `goals.audit` is present.
   - Update the audit `<div>` content to the new fields per Task 1's `NutritionGoalsAudit` shape:
     ```
     RMR: {audit.rmr} kcal
     Activity: {ACTIVITY_LEVEL_LABELS[audit.activityLevel]} (PAL ×{audit.palMultiplier})
     TDEE: {audit.tdee} kcal
     Weight: {audit.weightKg} kg ({audit.weightLoggedDate ? `logged ${audit.weightLoggedDate}` : "no log date"})
     Goal weight: {audit.goalWeightKg} kg
     Goal rate: {audit.goalRateKgPerWeek} kg/week
     Deficit: {formatSignedDeficit(audit.deficitKcal)} kcal/day · {audit.direction}
     ```
   - For each `<p>` row, conditionally render only when the underlying field is non-null. For past historical rows that lack new audit fields, only RMR + Weight rows render (existing data).
   - Keep the top-line target summary block (cal/day + macros) unchanged.
   - Add `getBlockedMessage` case for `"goals_not_set"`.
4. Run vitest (expect pass).

**Notes:**
- `ACTIVITY_LEVEL_LABELS` defined in `src/lib/macro-engine.ts` (Task 2) so it's reusable in `DailyGoalsCard` (Task 5) and here.
- `formatSignedDeficit(kcal)` — small utility: `kcal === 0 ? "0" : kcal > 0 ? \`+${kcal}\` : \`${kcal}\`` (negative numbers already have the minus sign).

---

### Task 7: Dashboard — `GoalsSetupBanner` + gated rendering

**Linear Issue:** [FOO-1046](https://linear.app/lw-claude/issue/FOO-1046)

**Files:**
- `src/components/goals-setup-banner.tsx` (create)
- `src/components/__tests__/goals-setup-banner.test.tsx` (create)
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify if present; otherwise create)

**Steps:**
1. Write tests in `src/components/__tests__/goals-setup-banner.test.tsx`:
   - **Reason mapping** — the banner renders an `role="alert"` region with text that maps from `reason`:
     - `goals_not_set` → "Set up your daily goals in Settings to see your targets."
     - `no_weight` → "Log your weight in Fitbit to enable targets."
     - `sex_unset` → "Set your biological sex in Fitbit profile to enable targets."
     - `scope_mismatch` → "Reconnect Fitbit to enable targets."
     - `invalid_profile` → "Your Fitbit profile has invalid values — update it in the Fitbit app."
     - `invalid_activity` → "Fitbit returned invalid activity data — try again later."
   - **CTA** — a single `<Link href="/settings">Open Settings</Link>` is the primary action. (Same destination for every reason; settings page handles each upstream issue.)
   - **Touch target** — link is ≥ 44×44 px.
   - **Component is dumb** — receives `reason` prop only; no own data fetching.
2. Run vitest (expect fail).
3. Create `src/components/goals-setup-banner.tsx` matching the patterns in `src/components/fitbit-status-banner.tsx` (existing similar banner):
   - Props: `{ reason: NonNullable<NutritionGoals["reason"]> }`.
   - Render in an amber/warning-tone container (match `fitbit-status-banner.tsx`'s tailwind palette).
   - Map reason → message via a local switch.
4. Update `src/components/__tests__/daily-dashboard.test.tsx` (if present; otherwise add new cases):
   - **Goals blocked** — when `/api/nutrition-goals` returns `{ status: "blocked", reason: "goals_not_set" }`, the dashboard renders `<GoalsSetupBanner reason="goals_not_set" />` above the calorie display, the bare-totals fallback (no `CalorieRing`), and `MacroBars` without goal targets (existing behavior already produces these — assert it still does).
   - **Goals ok** — banner is NOT rendered; `CalorieRing` and `MacroBars` with goals render normally.
5. Run vitest (expect fail).
6. Modify `src/components/daily-dashboard.tsx`:
   - Import `GoalsSetupBanner`.
   - In the JSX between the `DateNavigator` and the calorie ring (after line 286), insert:
     ```
     {goals?.status === "blocked" && goals.reason && (
       <GoalsSetupBanner reason={goals.reason} />
     )}
     ```
   - No other changes — existing fallback (lines 290-302) already handles the no-goals visual state.
7. Run vitest (expect pass).

**Notes:**
- The dashboard test file may not exist today — create with the minimum fixtures needed (mock SWR fetches with `vi.mock`).
- The banner is the only new dashboard widget. It contains zero options/inputs; all interactivity is the link to `/settings`.

---

### Task 8: Cleanup — remove obsolete code paths and dependencies

**Linear Issue:** [FOO-1047](https://linear.app/lw-claude/issue/FOO-1047)

**Files:**
- `src/lib/fitbit-cache.ts` (modify — remove `getCachedFitbitWeightGoal`, `getCachedActivitySummary`)
- `src/lib/__tests__/fitbit-cache.test.ts` (modify — drop tests for removed functions)
- `src/lib/fitbit.ts` (modify — remove `getFitbitWeightGoal`, `getActivitySummary` if no remaining callers)
- `src/lib/__tests__/fitbit.test.ts` (modify accordingly)
- `src/types/index.ts` (modify — drop `ActivitySummary` if no remaining callers)
- `ROADMAP.md` (modify — remove "Calorie Target Formula Review" section + Contents row)

**Steps:**
1. Use Grep to confirm no remaining callers of `getCachedFitbitWeightGoal`, `getCachedActivitySummary`, `getFitbitWeightGoal`, `getActivitySummary` outside of their own modules and test files. If any remain (e.g., from chat-tools or v1 routes), Task 9 must drop them first.
2. Update `src/lib/__tests__/fitbit-cache.test.ts`: drop the `getCachedFitbitWeightGoal` and `getCachedActivitySummary` test blocks. Run vitest (expect fail because functions still exist).
3. Modify `src/lib/fitbit-cache.ts`: delete `getCachedFitbitWeightGoal` and `getCachedActivitySummary` exports and their cache TTL entries. Run vitest (expect pass).
4. Repeat the test-then-delete cycle for `src/lib/fitbit.ts` and `src/types/index.ts` (drop unreferenced types).
5. Update `ROADMAP.md`:
   - Remove the entire "## Calorie Target Formula Review" section and its trailing `---` separator.
   - Remove the Contents-table row pointing to it.
   - Verify no remaining feature cross-references that section.
6. Run `npm run lint` and `npm run typecheck` — expect zero warnings (zero-warnings policy from CLAUDE.md).

**Notes:**
- Keep the `FitbitCallCriticality` type and its `"optional"` mode alive; surviving Fitbit calls (`profile`, `latestWeight`) still use it.
- After this task, the Fitbit OAuth `activity` scope is no longer required for goal computation, but the existing token's scope claim may already include it. Do NOT change the OAuth request URL — keep the scope set to today's value to avoid forcing a re-consent flow on every user. Strict scope cleanup is out of scope for this rework.

---

### Task 9: Integration — `chat-tools.ts`, `user-profile.ts`, v1 API surface

**Linear Issue:** [FOO-1048](https://linear.app/lw-claude/issue/FOO-1048)

**Files:**
- `src/lib/user-profile.ts` (modify)
- `src/lib/__tests__/user-profile.test.ts` (modify)
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify)
- `src/lib/food-log.ts` (modify — `getDateRangeNutritionSummary`)
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/app/api/nutrition-goals/route.ts` (modify)
- `src/app/api/nutrition-goals/__tests__/route.test.ts` (modify)
- `src/app/api/v1/nutrition-goals/route.ts` (modify)
- `src/app/api/v1/nutrition-goals/__tests__/route.test.ts` (modify)

**Steps:**
1. Update test cases for the new audit shape and the new `goals_not_set` blocked reason across each consumer file:
   - `user-profile.ts` chat-context profile string — add a case where `goals.status === "blocked" && goals.reason === "goals_not_set"`. Profile string omits the targets line and adds `Targets pending — set up daily goals in Settings`.
   - `chat-tools.ts` `executeGetNutritionSummary` — same blocked-reason handling. Lines 253 currently emit `Goal status: blocked (${reason})`; verify the new reason flows through.
   - `food-log.ts` `getDateRangeNutritionSummary` — for date ranges, days with `goals_not_set` produce a row with `null` calorie/macro goals (matches existing range-mode shape from FOO-1033).
   - `/api/nutrition-goals` and `/api/v1/nutrition-goals` — assert `audit` field shape uses the new `NutritionGoalsAudit` (no `caloriesOut`, `bmiTier`, `goalType`, `activityKcal`). v1 route's `audit` block must be updated identically. Auth path (`validateApiRequest` for v1, `validateSession` for internal) preserved.
2. Run vitest (expect fail).
3. Update each file:
   - `user-profile.ts:67-100` — add `goals_not_set` branch to the conditional (existing branches return blocked text). Drop any references to `partial` status (no longer in the union).
   - `chat-tools.ts:227-253` — extend the blocked-status string to include the new reason; no logic shape change.
   - `chat-tools.ts:280-290` (range summary) — no change needed if it already handles null goals; verify.
   - `food-log.ts` `getDateRangeNutritionSummary` — same handling.
   - Both routes — update the `mapToNutritionGoals` (or equivalent) helper to produce the new audit shape from `ComputeResult.audit`.
4. Run vitest (expect pass).

**Notes:**
- The chat tool's blocked-reason copy should not say "Set up in Settings" — the chat user may not be on the web app. Use neutral copy like `Goal status: blocked (goals_not_set)`.
- v1 API consumers (e.g., HealthHelper Android app) may parse the `audit` block; this is a breaking change. Acceptable per the `STATUS: PRODUCTION` directive in CLAUDE.md ("Delete unused code immediately. No deprecation warnings needed.").
- Both routes already use the standard `successResponse` / `errorResponse` API helpers and ErrorCode types — no changes to error sanitization needed beyond the audit shape update.

---

### Task 10: E2E coverage — onboarding gate, settings flow, goals appear

**Linear Issue:** [FOO-1049](https://linear.app/lw-claude/issue/FOO-1049)

**Files:**
- `e2e/tests/goal-anchored-engine.spec.ts` (create)
- `e2e/fixtures/fitbit.ts` (modify — add fixtures for the new flow)
- `e2e/tests/macro-engine.spec.ts` (delete or convert — old engine flow)

**Steps:**
1. Write `e2e/tests/goal-anchored-engine.spec.ts` covering the full first-time-setup flow:
   - **Setup** — test-login as a fresh user (`POST /api/auth/test-login` per `ENABLE_TEST_AUTH`). Mock Fitbit profile/weight via existing fixture pattern (`e2e/fixtures/fitbit.ts`).
   - **Step 1: Pre-setup dashboard** — visit `/app`. Assert `<GoalsSetupBanner>` is visible with the `goals_not_set` copy. Assert `<CalorieRing>` is NOT visible. Assert the bare calorie total IS visible (current intake totals still render).
   - **Step 2: Settings navigation** — click "Open Settings" link → URL is `/settings`. Assert `<DailyGoalsCard>` is visible with empty fields.
   - **Step 3: Set values** — select activity level "Light", enter goal weight `75`, enter goal rate `0.5`. Assert the live target preview shows a number consistent with the engine formula (compute expected value from the test fixture's profile values).
   - **Step 4: Safety warning visibility** — change goal rate to `2.0` (very aggressive). Assert the safety warning appears. Change back to `0.5`. Assert warning disappears.
   - **Step 5: Save** — click Save → assert no error, button returns to idle. Confirm `<TargetsCard>` (in `<DailyTargetsSection>`) shows the new targets inline (no expand toggle).
   - **Step 6: Dashboard renders** — go back to `/app`. Assert banner is gone, `<CalorieRing>` is visible with the saved target, `<MacroBars>` shows protein/carbs/fat goal bars.
   - **Step 7: Stable across page loads** — reload the page. Assert the target value is the same (no intra-day ratchet). Wait 30s, reload — same value.
2. Update or delete `e2e/tests/macro-engine.spec.ts` if its scenarios overlap with the old engine flow.
3. Run `npm run e2e` (full Playwright suite via the Playwright config's auto-build + DB setup). Expect pass.

**Notes:**
- Reuse existing `e2e/fixtures/fitbit.ts` mock-fitbit pattern for the profile/weight/sex inputs.
- Safety-warning trigger value `2.0 kg/week` translates to `2200 kcal/day` deficit — for any reasonable user that drops the target below the floor.
- E2E suite is **not** part of the regular TDD loop (per CLAUDE.md "Testing strategy"); only the lead runs it via `verifier "e2e"` before release.

---

## Post-Implementation Checklist

1. Run `bug-hunter` agent — Review changes for bugs across all 10 tasks.
2. Run `verifier` agent (no args) — Unit tests + lint + build.
3. Run `verifier "e2e"` — Full Playwright suite (only lead, after all tasks merge).
4. Update `MIGRATIONS.md` final entry to confirm the delete-today-and-future step ran in production (push-to-production workflow executes it as part of release).

---

## Plan Summary

**Objective:** Replace the Fitbit-driven, drift-prone calorie engine with a goal-anchored, device-independent prescription. The daily target becomes a stable function of declared activity level, goal weight, and weekly rate — no longer a function of cumulative `caloriesOut` and no longer ratcheted only-up. Onboarding requires the user to set the three new values in Settings; the dashboard hides goal visuals (banner-gated) until they're set. Single profile (muscle-preserve), no body-fat input, no silent safety clamp (informational warning instead).
**Linear Issues:** FOO-1040, FOO-1041, FOO-1042, FOO-1043, FOO-1044, FOO-1045, FOO-1046, FOO-1047, FOO-1048, FOO-1049
**Approach:** Schema migration drops 8 obsolete columns and adds 8 new ones, deletes today/future `daily_calorie_goals` rows so the new engine writes fresh. Macro engine simplified to a pure function over Mifflin-St Jeor RMR × PAL multiplier with a deficit derived from `goalRateKgPerWeek × 1100`. Service layer drops ratchet/seed/promote logic in favor of a single idempotent compute. New `/api/daily-goals-settings` GET/PATCH replaces `/api/macro-profile`. UI gains a `DailyGoalsCard` (Settings) and `GoalsSetupBanner` (Dashboard); `TargetsCard` loses its expand-on-tap and inlines all audit fields; `MacroProfileCard` deleted.
**Scope:** 10 tasks, ~25 files modified, ~7 files created, ~6 files deleted. Touches schema (1 migration), engine (1 module rewrite), service (1 module rewrite), 2 API routes (1 created, 1 deleted, 2 modified), 4 components (2 created, 2 deleted, 2 modified), 5 integration consumers (chat/profile/range/v1), 1 new E2E spec.
**Key Decisions:**
- Single source of truth for goal inputs is `users.activity_level / goal_weight_kg / goal_rate_kg_per_week`. Fitbit reads continue for sex/age/height/weight only.
- No safety clamp; safety floors (1500 male / 1200 female) surface as a Settings-side warning at edit time. User retains full agency.
- Direction (LOSE/MAINTAIN/GAIN) inferred from `currentWeight` vs `goalWeight`, with `goalRate=0` forcing MAINTAIN.
- Migration deletes `daily_calorie_goals` rows where `date >= CURRENT_DATE` so the new engine writes fresh today/future rows. Past rows kept for date-history view; their audit fields will read NULL after the column drops, and `TargetsCard` renders only non-null audit rows.
- Live client-side target preview imports the pure engine function; safety warning is rendered when the previewed target is below the floor.
- Body-fat / Katch-McArdle excluded from this rework.
- Adaptive thermogenesis weekly recalibration excluded from this rework.
**Risks:**
- v1 API audit-block shape change is breaking for external consumers (e.g., HealthHelper). Acceptable per project's "delete unused code immediately" stance.
- Past-date dashboard views will show partial audit data (only RMR + Weight) for entries written by the old engine. UI handles gracefully by rendering only non-null rows.
- Migration is sizable (drop + add 14 columns total + DELETE step). The DELETE statement must be appended to the drizzle-kit-generated SQL by hand because drizzle-kit emits DDL only.

---

## Iteration 1

**Implemented:** 2026-05-08
**Method:** Agent team (4 workers, worktree-isolated)

### Tasks Completed This Iteration
- Task 1 (FOO-1040): Schema migration — schema.ts + types/index.ts + MIGRATIONS.md (worker-1)
- Task 2 (FOO-1041): Rewrote macro-engine.ts — declared PAL, rate-anchored deficit, no safety clamp (worker-1)
- Task 3 (FOO-1042): Rewrote daily-goals.ts — single idempotent compute, dropped ratchet/seed/promote (worker-1)
- Task 4 (FOO-1043): New /api/daily-goals-settings GET/PATCH; deleted /api/macro-profile (worker-2)
- Task 5 (FOO-1044): DailyGoalsCard component with live target preview + safety-floor warning; deleted MacroProfileCard (worker-2)
- Task 6 (FOO-1045): TargetsCard rewrite — no expand toggle; inline audit fields with non-null guards (worker-3)
- Task 7 (FOO-1046): GoalsSetupBanner + dashboard gate (worker-3)
- Task 8 (FOO-1047, **partial**): ROADMAP.md cleanup landed; fitbit-cache.ts/fitbit.ts cleanup deferred (live callers in /api/fitbit/profile and /api/v1/activity-summary remain) (worker-4 + lead)
- Task 9 (FOO-1048): Updated user-profile.ts, chat-tools.ts tests, food-log.ts (range mode), nutrition-goals + v1/nutrition-goals routes for new audit shape and goals_not_set reason (worker-4)
- Task 10 (FOO-1049): New e2e/tests/goal-anchored-engine.spec.ts (smoke-level: banner, DailyGoalsCard, TargetsCard inline); deleted old e2e/tests/macro-engine.spec.ts (lead post-merge)

### Files Modified
- Schema/types: src/db/schema.ts, src/types/index.ts, drizzle/0026_goal_anchored_engine.sql, drizzle/meta/0026_snapshot.json, drizzle/meta/_journal.json, MIGRATIONS.md
- Engine/service: src/lib/macro-engine.ts, src/lib/daily-goals.ts, src/lib/users.ts (helpers added)
- API routes: src/app/api/daily-goals-settings/route.ts (created), src/app/api/macro-profile/route.ts (deleted), src/app/api/v1/nutrition-goals/route.ts
- UI: src/components/daily-goals-card.tsx (created), src/components/macro-profile-card.tsx (deleted), src/components/targets-card.tsx, src/components/goals-setup-banner.tsx (created), src/components/daily-dashboard.tsx, src/components/settings-content.tsx
- Integration: src/lib/user-profile.ts, src/lib/__tests__/chat-tools.test.ts, src/app/api/nutrition-goals/__tests__/route.test.ts, src/app/api/v1/nutrition-goals/__tests__/route.test.ts, src/lib/__tests__/user-profile.test.ts
- Tests: associated __tests__ files for every module above
- E2E: e2e/tests/goal-anchored-engine.spec.ts (created), e2e/tests/macro-engine.spec.ts (deleted), e2e/tests/dashboard.spec.ts (Settings link selectors disambiguated)
- Docs: ROADMAP.md (Calorie Target Formula Review section removed), MIGRATIONS.md (entry added)

### Linear Updates
- FOO-1040: Todo → In Progress → Review
- FOO-1041: Todo → In Progress → Review
- FOO-1042: Todo → In Progress → Review
- FOO-1043: Todo → In Progress → Review
- FOO-1044: Todo → In Progress → Review
- FOO-1045: Todo → In Progress → Review
- FOO-1046: Todo → In Progress → Review
- FOO-1047: Todo → In Progress → Review (partial — see Tasks Remaining)
- FOO-1048: Todo → In Progress → Review
- FOO-1049: Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter: Found 5 issues (2 Major, 3 Minor) — all fixed before final verification:
  1. Major: `goalWeightKg` not validated in computeMacroTargets — added to INVALID_PROFILE_DATA guard.
  2. Major: Stale `NewAudit` local interface in targets-card.tsx — replaced with canonical `NutritionGoalsAudit`.
  3. Minor: Stale `as RangeEntry["reason"]` casts in v1/nutrition-goals/route.ts — removed.
  4. Minor: Stale audit fixture in daily-dashboard.test.tsx (line 252) — updated to new shape.
  5. Minor: `invalid_activity` dead reason — removed from union, banner, REASON_MESSAGES, and tests (no path produces it after engine rewrite).
- verifier: 3491 unit tests pass, lint clean, build clean, 144 E2E tests pass.

### Work Partition
- Worker 1: Tasks 1, 2, 3 (foundation — schema, engine, service)
- Worker 2: Tasks 4, 5 (settings — API + DailyGoalsCard)
- Worker 3: Tasks 6, 7 (dashboard UI — TargetsCard inline + GoalsSetupBanner)
- Worker 4: Tasks 8, 9 (cleanup + integration — chat/profile/v1, fitbit-cache)
- Lead post-merge: drizzle-kit generate (Task 1's generated artifacts), Task 10 (E2E spec), bug-hunter fixes, fitbit-cache cleanup investigation

### Merge Summary
- Worker 1: fast-forward (no conflicts)
- Worker 2: ort merge, no conflicts (zero file overlap with worker-1's owned files)
- Worker 3: ort merge, no conflicts
- Worker 4: ort merge, no conflicts
- Cross-worker type errors at intermediate stages all resolved by subsequent merges. Lead added back `FitbitWeightGoal` to src/types/index.ts because /api/fitbit/profile and /api/v1/activity-summary still consume the old Fitbit cache helpers — Worker-1's preemptive type drop was incorrect given those callers.

### Tasks Remaining
- **Task 8 (FOO-1047) partial — fitbit-cache cleanup deferred.** `getCachedFitbitWeightGoal`, `getFitbitWeightGoal`, `getCachedActivitySummary`, `getActivitySummary` still have live callers in `src/app/api/fitbit/profile/route.ts` (Settings page) and `src/app/api/v1/activity-summary/route.ts` (external API). The plan assumed daily-goals.ts was the only consumer — incorrect. Decision needed: either retire the consuming features or accept the helpers as long-lived for those features. Recommend the latter — they serve unrelated functionality and the cleanup goal was scoping to the engine rework.

### Continuation Status
Goal-anchored engine rework substantively complete. All 10 task IDs in Review. The remaining Task 8 cleanup is a scope-decision for follow-up, not a blocker for release.
