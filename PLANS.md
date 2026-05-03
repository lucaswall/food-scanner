# Implementation Plan

**Created:** 2026-05-03
**Source:** Inline request: Replace Lumen screenshot flow with an in-app macro engine that computes daily calorie + macro targets from Fitbit profile and activity data; remove Lumen.
**Linear Issues:** [FOO-967](https://linear.app/lw-claude/issue/FOO-967), [FOO-968](https://linear.app/lw-claude/issue/FOO-968), [FOO-969](https://linear.app/lw-claude/issue/FOO-969), [FOO-970](https://linear.app/lw-claude/issue/FOO-970), [FOO-971](https://linear.app/lw-claude/issue/FOO-971), [FOO-972](https://linear.app/lw-claude/issue/FOO-972), [FOO-973](https://linear.app/lw-claude/issue/FOO-973), [FOO-974](https://linear.app/lw-claude/issue/FOO-974), [FOO-975](https://linear.app/lw-claude/issue/FOO-975), [FOO-976](https://linear.app/lw-claude/issue/FOO-976), [FOO-977](https://linear.app/lw-claude/issue/FOO-977), [FOO-978](https://linear.app/lw-claude/issue/FOO-978), [FOO-979](https://linear.app/lw-claude/issue/FOO-979), [FOO-980](https://linear.app/lw-claude/issue/FOO-980), [FOO-981](https://linear.app/lw-claude/issue/FOO-981)
**Branch:** feat/macro-engine

## Context Gathered

### Codebase Analysis

**Lumen flow (to be removed):**
- `src/lib/lumen.ts` — `parseLumenScreenshot`, `upsertLumenGoals`, `getLumenGoalsByDate`, `getLumenGoalsByDateRange`, `LumenParseError`. Uses Claude Haiku 4.5 vision; records "lumen-parsing" in `claude_usage`.
- `src/db/schema.ts:92` — `lumenGoals` table (id, userId, date, dayType, proteinGoal, carbsGoal, fatGoal, timestamps; unique on userId+date).
- `src/app/api/lumen-goals/route.ts` — POST (upload screenshot) + GET (fetch). Rate limit 20/15min. iron-session auth.
- `src/app/api/v1/lumen-goals/route.ts` — GET only. Bearer API key auth. Rate limit 60/min.
- `src/components/lumen-banner.tsx` — Upload banner; SWR `/api/lumen-goals?date={today}`.
- `src/components/daily-dashboard.tsx:14, 29, 138-140, 239-281, 344-348, 372-380, 467-485, 505-511` — uses `LumenBanner`, `lumenGoals` SWR, "Update Lumen goals" button, day-type badge.
- `src/lib/chat-tools.ts:5, 226, 239-244` — `executeGetNutritionSummary` calls `getLumenGoalsByDate` and renders macro lines.
- `src/lib/user-profile.ts:5, 64, 70, 84-92` — `buildUserProfile` reads Lumen goals and emits `Targets ${cal} cal/day (P:Xg C:Yg F:Zg)`.
- `src/lib/claude-usage.ts` — pricing/recording for "lumen-parsing" operation.

**Fitbit integration (to be extended):**
- `src/lib/fitbit.ts:326-336` — `buildFitbitAuthUrl` with hardcoded `scope: "nutrition activity"`.
- `src/lib/fitbit.ts:75-124` — shared `fetchWithRetry` with timeout, 401→`FITBIT_TOKEN_INVALID`, 403→`FITBIT_SCOPE_MISSING`, 429 retry, 5xx retry. Reuse for new endpoints.
- `src/lib/fitbit.ts:338-415` — `exchangeFitbitCode`. Response shape today: `{ access_token, refresh_token, user_id, expires_in }`. Fitbit also returns `scope` on initial exchange — currently discarded.
- `src/lib/fitbit.ts:421-464` — `refreshFitbitToken`. Refresh response does NOT include `scope` per Fitbit docs — store scope only on initial exchange/re-authorize.
- `src/lib/fitbit.ts:466-528` — `ensureFreshToken` with `refreshInFlight: Map<userId, Promise<string>>`. **This is the model for the first-of-day compute Promise Map.**
- `src/lib/fitbit.ts:530-616` — existing `getFoodGoals`, `getActivitySummary` (returns `caloriesOut`).
- `src/db/schema.ts:33-41` — `fitbitTokens` (no `scope` column today).
- `src/db/schema.ts:43-50` — `fitbitCredentials` (per-user OAuth app).
- `src/lib/fitbit-tokens.ts` — `getFitbitTokens` / `upsertFitbitTokens` (encrypts before storing).
- `src/components/fitbit-status-banner.tsx` — 3 visible states currently: missing creds, tokens-without-creds, has-creds-not-connected. Uses `/api/auth/session` SWR.

**Daily goals (to be extended):**
- `src/db/schema.ts:160-173` — `dailyCalorieGoals` (calorieGoal only; unique on userId+date).
- `src/lib/nutrition-goals.ts` — `upsertCalorieGoal`, `getCalorieGoalsByDateRange`.
- `src/app/api/nutrition-goals/route.ts` — fetches Fitbit `getFoodGoals`, returns `{ calories }`, fire-and-forget upsert. **Uses existing error-code mapping convention** (FITBIT_* → 401/403/424/429/502/504).

**Multi-user posture:**
- App is used by Lucas AND Mariana. All tables are `userId`-keyed. Each user has independent Fitbit credentials, tokens, weight log, profile, and Lumen history. The macro engine must derive per-user values from per-user Fitbit data — no hardcoded body assumptions.

### MCP Context

- **Linear MCP:** Connected. Team "Food Scanner" (id `3e498d7a-30d2-4c11-89b3-ed7bd8cb2031`). Available labels: Feature, Improvement, Bug, Technical Debt, Performance, Security, Convention.
- **No prior Linear issues** for "macro engine", "TDEE", "RMR", "Mifflin", or replacing Lumen. Greenfield.
- **No in-flight branches** related to this work.
- **Roadmap dependency:** "Automated Lumen RQ Ingestion" (still in `ROADMAP.md`) declares "Self-Calculated Macro Goals" as its prerequisite — keep the prerequisite name reference intact when removing this entry.

## Tasks

### Task 1: Extend schema — add `scope` to `fitbit_tokens`; add macro and audit columns to `daily_calorie_goals`

**Linear Issue:** [FOO-967](https://linear.app/lw-claude/issue/FOO-967)

**Files:**
- `src/db/schema.ts` (modify)
- `drizzle/<auto>.sql` (generated)
- `drizzle/meta/_journal.json` (generated)
- `MIGRATIONS.md` (modify)

**Steps:**
1. Modify `fitbitTokens` table: add `scope: text("scope")` (nullable — populated lazily on next exchange/refresh-with-reauth flow).
2. Modify `dailyCalorieGoals` table: add nullable columns `proteinGoal: integer("protein_goal")`, `carbsGoal: integer("carbs_goal")`, `fatGoal: integer("fat_goal")`, `weightKg: numeric("weight_kg")`, `caloriesOut: integer("calories_out")`, `rmr: integer("rmr")`, `activityKcal: integer("activity_kcal")`. All nullable so existing rows migrate cleanly and Lumen-backfilled rows can carry NULL audit fields.
3. Run `npx drizzle-kit generate` (no live DB needed). The lead, not workers, runs this.
4. Append to `MIGRATIONS.md`: "Add `fitbit_tokens.scope` (nullable) — both users will need to reconnect Fitbit once after deploy to populate. Add nullable macro + audit columns to `daily_calorie_goals` — additive, no data backfill in this step."
5. No tests needed — schema only. Existing schema tests pass on `npm test`.

**Notes:**
- **Migration note:** Production data — existing `fitbit_tokens` rows will have `scope: NULL` until each user reconnects (reading NULL means "treat as legacy `nutrition activity` scope only"). Existing `daily_calorie_goals` rows untouched.
- Do NOT hand-write the `.sql` or `_journal.json` — use the generator.

### Task 2: Persist Fitbit OAuth scope; centralize scope constant; add `prompt=consent` on scope-upgrade reconnect

**Linear Issue:** [FOO-968](https://linear.app/lw-claude/issue/FOO-968)

**Files:**
- `src/lib/fitbit.ts` (modify)
- `src/lib/fitbit-tokens.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)
- `src/lib/__tests__/fitbit-tokens.test.ts` (modify)
- `src/app/api/auth/fitbit/route.ts` (modify)
- `src/app/api/auth/fitbit/callback/route.ts` (modify)
- `src/app/api/auth/fitbit/__tests__/route.test.ts` (modify)
- `src/app/api/auth/fitbit/callback/__tests__/route.test.ts` (modify)

**Steps:**
1. Add tests in `fitbit.test.ts` for:
   - `buildFitbitAuthUrl` includes `scope=nutrition+activity+profile+weight` (URL-encoded space). Existing test for `nutrition activity` updated to expect new scopes.
   - `buildFitbitAuthUrl` accepts a `forceConsent` flag and adds `prompt=consent` when true; absent when false.
   - `exchangeFitbitCode` returns `scope` field from Fitbit response (in addition to existing fields).
   - `refreshFitbitToken` does NOT return a `scope` field (Fitbit's refresh response doesn't include it — confirm we don't fabricate one).
2. Run verifier (expect fail).
3. Implement:
   - In `fitbit.ts`, export `FITBIT_REQUIRED_SCOPES = ["nutrition", "activity", "profile", "weight"]` as a single source of truth.
   - `buildFitbitAuthUrl` joins those with spaces; signature gains optional `{ forceConsent?: boolean }`. When true, append `prompt=consent`.
   - `exchangeFitbitCode` extends its return type to include `scope: string` (parsed from response; fail if missing).
   - `refreshFitbitToken` unchanged in shape (do NOT add scope — it isn't returned).
4. Add tests in `fitbit-tokens.test.ts` for `upsertFitbitTokens` accepting and persisting an optional `scope` field.
5. Implement `upsertFitbitTokens` to accept `scope?: string | null` and write it to the column. `getFitbitTokens` returns `scope` in the row.
6. Add tests in callback route for: callback persists `scope` from `exchangeFitbitCode` to `fitbit_tokens.scope`.
7. Update `src/app/api/auth/fitbit/callback/route.ts` to pass `tokens.scope` into `upsertFitbitTokens`.
8. Add tests in `src/app/api/auth/fitbit/__tests__/route.test.ts`: when an existing token row exists with a `scope` value missing any required scope, the redirect URL contains `prompt=consent`. When fully scoped or no token row, no `prompt=consent`.
9. Update `src/app/api/auth/fitbit/route.ts` to compute `forceConsent` from existing token's `scope` vs `FITBIT_REQUIRED_SCOPES` before calling `buildFitbitAuthUrl`.
10. Run verifier (expect pass).

**Notes:**
- Reason for `prompt=consent`: Fitbit silently re-issues tokens without showing the consent screen if the user is logged into fitbit.com — without this flag, the user grants new scopes invisibly.
- Reason scope is read on initial exchange only: Fitbit's documented refresh response contains only `access_token`, `refresh_token`, `expires_in`, `token_type`, `user_id`. Refreshing never grants new scopes.
- **Migration note:** Auth flow now requests broader scopes. Both Lucas and Mariana will see "Reconnect Fitbit" once after deploy.

### Task 3: Add Fitbit profile, weight log, and weight goal fetchers

**Linear Issue:** [FOO-969](https://linear.app/lw-claude/issue/FOO-969)

**Files:**
- `src/lib/fitbit.ts` (modify)
- `src/lib/__tests__/fitbit.test.ts` (modify)
- `src/types/index.ts` (modify — add typed shapes for profile/weight/weight goal responses)

**Steps:**
1. Add tests for three new functions:
   - `getFitbitProfile(accessToken, log?)` — calls `GET /1/user/-/profile.json` with `Accept-Language: en_US`. Returns `{ ageYears: number, sex: "MALE" | "FEMALE" | "NA", heightCm: number }`. Test: parses live-shape fixture (use real response shape from research). Test: `gender: "NA"` propagates as `sex: "NA"`. Test: missing `dateOfBirth`/`gender`/`height` triggers a clear validation error.
   - `getFitbitLatestWeightKg(accessToken, targetDate, log?)` — walks back up to 7 days from `targetDate`, calls `GET /1/user/-/body/log/weight/date/<date>.json` for each. Returns `{ weightKg: number, loggedDate: string } | null`. Always sends `Accept-Language: en_US` header → metric units. Test: empty array on day 0 falls back to day -1. Test: returns null after 7 empty days. Test: parses live shape `{ weight: [{ weight: 121.6, date, ... }] }`.
   - `getFitbitWeightGoal(accessToken, log?)` — calls `GET /1/user/-/body/log/weight/goal.json`. Returns `{ goalType: "LOSE" | "MAINTAIN" | "GAIN" } | null`. Test: returns null when goal field empty/missing. Test: unknown `goalType` value rejected (validation throws).
2. Run verifier (expect fail).
3. Implement using existing `fetchWithRetry`. Apply the documented double-cast pattern (`data as unknown as Type`) immediately followed by runtime validation of every field used (per CLAUDE.md "KNOWN ACCEPTED PATTERNS"). Reject on missing/invalid critical fields with clear errors.
4. Run verifier (expect pass).

**Notes:**
- Body fat % NOT fetched — feature explicitly omits LBM scaling for now.
- Unit handling: pass `Accept-Language: en_US` header to force metric. Store `heightCm` and `weightKg` as canonical units throughout the engine.
- Weight log endpoint returns ONLY the requested date (no implicit fallback) — walk-back is explicit.
- Pattern reference: `getFoodGoals` and `getActivitySummary` at `src/lib/fitbit.ts:530-616`.

### Task 4: Build Fitbit health check + API route + extend `FitbitStatusBanner` with scope-mismatch state

**Linear Issue:** [FOO-970](https://linear.app/lw-claude/issue/FOO-970)

**Files:**
- `src/lib/fitbit-health.ts` (create)
- `src/lib/__tests__/fitbit-health.test.ts` (create)
- `src/app/api/fitbit/health/route.ts` (create)
- `src/app/api/fitbit/health/__tests__/route.test.ts` (create)
- `src/components/fitbit-status-banner.tsx` (modify)
- `src/components/__tests__/fitbit-status-banner.test.tsx` (modify)
- `src/types/index.ts` (modify — add `FitbitHealthStatus` shape)

**Steps:**
1. Add tests for `checkFitbitHealth(userId, log?)`:
   - Returns `{ status: "needs_setup" }` when no `fitbit_credentials` row.
   - Returns `{ status: "needs_reconnect" }` when credentials exist but no token row.
   - Returns `{ status: "scope_mismatch", missingScopes: ["profile", "weight"] }` when token row's `scope` is `"nutrition activity"` (or null).
   - Returns `{ status: "healthy" }` when scope contains all of `FITBIT_REQUIRED_SCOPES`.
2. Run verifier (expect fail).
3. Implement `checkFitbitHealth` reading `fitbit_credentials`, `fitbit_tokens`, comparing scope set vs `FITBIT_REQUIRED_SCOPES`. Treat NULL scope as "legacy nutrition+activity only" → `scope_mismatch`. Do NOT call Fitbit — local DB read only.
4. Add tests for `GET /api/fitbit/health`:
   - 401 if no session (use `getSession()` + `validateSession()` helper).
   - Returns shape `{ status, missingScopes? }` from `checkFitbitHealth(session.userId)`.
   - Sets `Cache-Control: private, no-cache` per project convention.
   - Errors are sanitized via `errorResponse` from `api-response.ts` — never expose raw errors. Use `ErrorCode` enum from `src/types/index.ts`.
5. Implement the route per `src/app/api/nutrition-goals/route.ts` as the auth + error pattern reference.
6. Add tests for `FitbitStatusBanner` 5th state:
   - When `/api/fitbit/health` returns `{ status: "scope_mismatch" }`, banner shows "Reconnect Fitbit to grant new permissions" with form-POST to `/api/auth/fitbit` (existing reconnect endpoint).
   - When `status: "healthy"`, banner returns null (no change to existing behavior).
   - Other statuses map to existing banner branches (no regressions).
7. Modify `FitbitStatusBanner` to swap its data source from `/api/auth/session` to `/api/fitbit/health` (richer status). Adapt the existing 4-branch logic to the new status enum. Loading + error states preserved.
8. Run verifier (expect pass).

**Notes:**
- Reuses existing `POST /api/auth/fitbit` endpoint — no new OAuth route. The existing endpoint is wired to compute `forceConsent` (Task 2).
- Banner stays a single component, single-purpose. No new "Fitbit Connection" card — users should see only one Fitbit-related warning at a time.
- `fitbit-status-banner.test.tsx` migration: existing test fixtures using `SessionResponse` need to be updated to mock `/api/fitbit/health` instead.

### Task 5: Build Fitbit profile/weight/weight-goal cache module

**Linear Issue:** [FOO-971](https://linear.app/lw-claude/issue/FOO-971)

**Files:**
- `src/lib/fitbit-cache.ts` (create)
- `src/lib/__tests__/fitbit-cache.test.ts` (create)

**Steps:**
1. Add tests:
   - `getCachedFitbitProfile(userId, log)` calls `getFitbitProfile` once, second call within 24h returns cached value (mock fetch verifies 1 call).
   - `getCachedFitbitWeightKg(userId, targetDate, log)` cached for 1h per `(userId, targetDate)` key.
   - `getCachedFitbitWeightGoal(userId, log)` cached for 24h.
   - `getCachedActivitySummary(userId, targetDate, log)` cached for 5 minutes per `(userId, targetDate)` key.
   - `invalidateFitbitProfileCache(userId)` clears all profile/weight/goal entries for that user (settings "Refresh" button hook).
   - Cache survives within process; entries auto-expire on TTL.
   - Two simultaneous calls for the same key collapse via per-key in-flight Promise (no double-fetch). Pattern mirrors `refreshInFlight` at `src/lib/fitbit.ts:466`.
2. Run verifier (expect fail).
3. Implement: `Map<string, { value, expiresAt }>` per cache type, module-level. Each getter checks expiry, fetches via `ensureFreshToken` + the matching Fitbit getter, caches, returns. In-flight Map dedupes concurrent reads. Single-instance Railway means no cross-process invalidation needed.
4. Run verifier (expect pass).

**Notes:**
- Differentiated TTLs intentional: profile/goal change rarely; weight log can change mid-day after morning weigh-in; activity changes constantly.
- Cache is process-local. Railway redeploys clear it — fine for single-instance.

### Task 6: Implement `macro-engine.ts` pure compute function

**Linear Issue:** [FOO-972](https://linear.app/lw-claude/issue/FOO-972)

**Files:**
- `src/lib/macro-engine.ts` (create)
- `src/lib/__tests__/macro-engine.test.ts` (create)
- `src/types/index.ts` (modify — add `MacroEngineInputs`, `MacroEngineOutputs`, `MacroGoalType`)

**Steps:**
1. Add unit tests covering the math end-to-end:
   - Mifflin-St Jeor RMR for male: `10·kg + 6.25·cm − 5·age + 5`.
   - Mifflin-St Jeor RMR for female: `10·kg + 6.25·cm − 5·age − 161`.
   - Activity calc: `activity_kcal = max(0, caloriesOut − RMR) × 0.85`. Negative diff clamps to 0.
   - TDEE: `RMR + activity_kcal`.
   - Target calories: `TDEE × {LOSE: 0.80, MAINTAIN: 1.00, GAIN: 1.10}`.
   - **BMI-tiered protein** (BMI = kg / (m²)):
     - BMI < 25 → cut 2.2, maintain 1.6, bulk 1.8 g/kg.
     - 25 ≤ BMI < 30 → cut 2.0, maintain 1.6, bulk 1.8 g/kg.
     - BMI ≥ 30 → cut 1.8, maintain 1.6, bulk 1.6 g/kg.
   - Fat: `max(kg × 0.8, target_kcal × 0.25 / 9)`.
   - Carbs: `max((target_kcal − protein_g·4 − fat_g·9) / 4, 130, 0.10 × target_kcal / 4)` (the latter as a sanity floor; documented as IOM brain-glucose minimum / 10% of energy).
   - Edge: `sex: "NA"` returns a typed error/sentinel — the engine never silently picks a sex.
   - Edge: zero or negative `caloriesOut` → activity_kcal = 0 (clamps).
   - Edge: very low calorie target (e.g., aggressive cut) → carb floor binds at 130.
   - Tunables: export named constants `ACTIVITY_MULTIPLIER = 0.85`, `PROTEIN_COEFFICIENTS` (the table above), `CARB_FLOOR_GRAMS = 130`, `FAT_PERCENT_OF_KCAL = 0.25`. Tests assert defaults but use the constants — future tunes touch one place.
   - Specific scenario tests: high-BMI male profile (49y/M/176cm/121kg/LOSE/3000 caloriesOut) and lower-BMI female profile (44y/F/162cm/65kg/MAINTAIN/2200 caloriesOut). Outputs documented in test assertions; both produce sensible values and exercise different BMI tiers.
2. Run verifier (expect fail).
3. Implement `computeMacroTargets(inputs: MacroEngineInputs): MacroEngineOutputs` as a pure function. No I/O, no logger.
4. Run verifier (expect pass).

**Notes:**
- Inputs: `{ ageYears, sex, heightCm, weightKg, caloriesOut, goalType }`. Outputs: `{ targetKcal, proteinG, carbsG, fatG, rmr, activityKcal, tdee, bmiTier }`.
- `bmiTier` returned for the audit row + the dashboard's expandable math.
- 0.85 activity multiplier: documented in code comment as "Fitbit caloriesOut overestimate haircut — published wrist-device validations show ~23–27% overshoot". One short comment is enough.

### Task 7: Build daily-goals service with idempotent compute

**Linear Issue:** [FOO-973](https://linear.app/lw-claude/issue/FOO-973)

**Files:**
- `src/lib/daily-goals.ts` (create)
- `src/lib/__tests__/daily-goals.test.ts` (create)

**Steps:**
1. Add tests for `getOrComputeDailyGoals(userId, date, log)`:
   - First call for a `(userId, date)` pair fetches Fitbit profile/weight/weight-goal/activity (mocked), runs `computeMacroTargets`, INSERTs row, returns `{ status: "ok", goals, audit }`.
   - Second concurrent call (same userId+date, fired before the first resolves) reuses the in-flight promise (mock fetch verifies 1 call). Pattern mirrors `refreshInFlight` in `src/lib/fitbit.ts:466`.
   - After completion, repeated call within the same day reads the existing row and skips compute when audit columns are populated.
   - Returns `{ status: "blocked", reason: "no_weight" }` when weight walk-back returns null.
   - Returns `{ status: "blocked", reason: "sex_unset" }` when profile sex is `"NA"`.
   - Returns `{ status: "blocked", reason: "scope_mismatch" }` when underlying Fitbit call rejects with `FITBIT_SCOPE_MISSING`.
   - Returns `{ status: "partial", proteinG, fatG }` when profile + weight succeed but activity has no caloriesOut yet (calories/carbs not computed; protein/fat shown as targets per spec).
   - Two simultaneous writes for the same `(userId, date)` collapse via `INSERT ... ON CONFLICT DO NOTHING`; no duplicate rows.
   - When an existing row has `calorieGoal` set but macro/audit columns are NULL (Lumen-backfilled or pre-feature), engine recomputes and updates only the macro+audit fields (does not overwrite an existing macros set by a previous compute).
2. Run verifier (expect fail).
3. Implement using `Map<string, Promise<Result>>` keyed by `${userId}:${date}` for in-flight dedupe (delete on settle, both success and error). DB write: `INSERT ... ON CONFLICT (userId, date) DO NOTHING` against the existing `daily_calorie_goals_user_date_uniq` index. Read back the row after insert and return it. If the row already exists with macro columns populated, skip Fitbit and return cached.
4. Run verifier (expect pass).

**Notes:**
- DB writes are single-statement (INSERT or UPDATE); no transaction needed. The unique index handles the race.
- "Stale" behavior: the spec freezes past days. If `(userId, date)` row exists but is missing macro audit columns (Lumen-backfilled or pre-feature), recompute and update only the macro+audit fields, leaving any existing `calorieGoal` consistent.

### Task 8: Update `GET /api/nutrition-goals` to return full macro goals + degraded states

**Linear Issue:** [FOO-974](https://linear.app/lw-claude/issue/FOO-974)

**Files:**
- `src/app/api/nutrition-goals/route.ts` (modify)
- `src/app/api/nutrition-goals/__tests__/route.test.ts` (modify)
- `src/types/index.ts` (modify — extend `NutritionGoals` with `proteinG`, `carbsG`, `fatG`, `status`, optional `audit` block for the expandable math)

**Steps:**
1. Update tests to expect new response shape and behaviors:
   - Response includes `{ calories, proteinG, carbsG, fatG, status, audit? }` where `status: "ok" | "partial" | "blocked"`.
   - On `status: "ok"`, audit block contains `{ rmr, activityKcal, tdee, weightKg, bmiTier, goalType }` for the dashboard's expandable math.
   - On `status: "partial"` (activity missing), `calories` and `carbsG` are null; `proteinG` and `fatG` populated.
   - On `status: "blocked"`, payload contains `reason` ("no_weight" | "sex_unset" | "scope_mismatch") and all goal fields are null.
   - Existing Fitbit error code mapping preserved (delegate `FITBIT_*` errors via `errorResponse`).
   - Auth via `getSession()` + `validateSession({ requireFitbit: true })` (existing pattern).
   - `Cache-Control: private, no-cache` (existing convention).
2. Run verifier (expect fail).
3. Replace the body to call `getOrComputeDailyGoals(session.userId, clientDate ?? getTodayDate(), log)` and shape the response. Drop the old `getFoodGoals` + `upsertCalorieGoal` flow — the new service captures both.
4. Run verifier (expect pass).

**Notes:**
- API path unchanged (`/api/nutrition-goals?clientDate=YYYY-MM-DD`) so dashboard SWR keys don't break.
- The old `getFoodGoals` (Fitbit food-log calorie goal) is no longer the source — the engine computes calories from RMR+activity. Verify with grep whether `getFoodGoals` has any remaining consumers; if none, delete it as part of this task. If yes, leave it for now.
- **Migration note:** API response shape extends. Document in PR description; consumers (dashboard, chat-tools, user-profile) updated in subsequent tasks.

### Task 9: Update chat-tools `executeGetNutritionSummary` to use new goals (single date + range)

**Linear Issue:** [FOO-975](https://linear.app/lw-claude/issue/FOO-975)

**Files:**
- `src/lib/chat-tools.ts` (modify)
- `src/lib/__tests__/chat-tools.test.ts` (modify if exists; otherwise create alongside the change)
- `src/lib/food-log.ts` (modify — `getDateRangeNutritionSummary` switches macro source)
- `src/lib/__tests__/food-log.test.ts` (modify)

**Steps:**
1. Update or add tests for `executeGetNutritionSummary`:
   - Single date case: macro goals come from `daily_calorie_goals` macro columns (not `lumen_goals`). Output line format updated; `dayType` removed (the engine doesn't have day types).
   - Date-range case: per-day macro goals come from the new columns.
   - Partial state (NULL macros): macro goals line is omitted, only calories shown.
2. Run verifier (expect fail).
3. Replace the `getLumenGoalsByDate` import with a new `getDailyGoalsByDate` from `src/lib/daily-goals.ts` (read-only fetch, no compute) returning the row including macro columns. Update `getDateRangeNutritionSummary` to read macros from `daily_calorie_goals` rather than `lumen_goals`.
4. Run verifier (expect pass).

**Notes:**
- Tool schema unchanged (`get_nutrition_summary`). Output text format minor change — drop the `({dayType})` annotation since the new model doesn't have day types. Claude tolerates this.

### Task 10: Update `buildUserProfile` in user-profile.ts

**Linear Issue:** [FOO-976](https://linear.app/lw-claude/issue/FOO-976)

**Files:**
- `src/lib/user-profile.ts` (modify)
- `src/lib/__tests__/user-profile.test.ts` (modify)

**Steps:**
1. Update tests:
   - Profile string with full goals: `Targets ${cal} cal/day (P:Xg C:Yg F:Zg)` from new columns (no Lumen).
   - Partial state: `Targets pending — waiting for Fitbit activity`.
   - Blocked state: profile omits the targets section (no goals to report).
2. Run verifier (expect fail).
3. Replace `getLumenGoalsByDate` import with the same `getDailyGoalsByDate` reader. Adapt the section-building logic. The existing `getCalorieGoalsByDateRange` call becomes redundant — the daily-goals row carries the calorie goal directly; consolidate.
4. Run verifier (expect pass).

**Notes:**
- 1200-character truncation rules unchanged.

### Task 11: Update `daily-dashboard.tsx` — remove Lumen banner + button, add "Today's targets" expandable card

**Linear Issue:** [FOO-977](https://linear.app/lw-claude/issue/FOO-977)

**Files:**
- `src/components/daily-dashboard.tsx` (modify)
- `src/components/targets-card.tsx` (create)
- `src/components/__tests__/targets-card.test.tsx` (create)
- `src/components/__tests__/daily-dashboard.test.tsx` (modify if exists)
- `src/types/index.ts` (modify — `LumenGoalsResponse` removed; `NutritionGoals` extended)

**Steps:**
1. Add tests for `TargetsCard`:
   - Renders calorie + macro targets when `status: "ok"`, with collapsed-by-default expandable math (`{audit.rmr}, {audit.activityKcal}, ...`).
   - Renders "Targets pending — waiting for Fitbit activity" when `status: "partial"`.
   - Renders status-specific message when `status: "blocked"` (per `reason`).
   - Loading state via Skeleton.
   - Error state with retry button.
2. Run verifier (expect fail).
3. Implement `TargetsCard` as a client component (`'use client'`), reads `/api/nutrition-goals?clientDate=...` via SWR `apiFetcher` from `@/lib/swr`. Mobile-first; expand toggle is at least 44×44.
4. Update `daily-dashboard.tsx`:
   - Remove `LumenBanner` import and rendering (lines ~14, 378-380).
   - Remove the `lumenGoals` SWR hook (~138-140).
   - Remove `handleUpdateLumenGoals`, `handleLumenFileChange`, `fileInputRef`, `isUploadingLumen`, `lumenUploadError`, the "Update Lumen goals" button (~239-281, 467-485, 505-511).
   - Remove the `dayType` badge (~344-348).
   - Pass `goals?.proteinG / carbsG / fatG` from `/api/nutrition-goals` to `MacroBars` instead of `lumenGoals?.goals?.*`.
   - Render `<TargetsCard date={selectedDate} />` near the top of the dashboard (after `DateNavigator`, before `CalorieRing`) — replaces the LumenBanner slot.
   - Update auto-refresh visibility-change handler to no longer revalidate `/api/lumen-goals`.
5. Update `daily-dashboard.test.tsx` (if exists) — remove Lumen mocks, add TargetsCard expectations.
6. Run verifier (expect pass).

**Notes:**
- `MacroBars` component itself unchanged — same prop shape (`proteinGoal, carbsGoal, fatGoal`).
- A `loading.tsx` already exists for `/app` — verify it still matches the new layout (no Lumen banner skeleton).

### Task 12: Add Fitbit profile read-only card to settings page

**Linear Issue:** [FOO-978](https://linear.app/lw-claude/issue/FOO-978)

**Files:**
- `src/components/fitbit-profile-card.tsx` (create)
- `src/components/__tests__/fitbit-profile-card.test.tsx` (create)
- `src/components/settings-content.tsx` (modify)
- `src/app/api/fitbit/profile/route.ts` (create)
- `src/app/api/fitbit/profile/__tests__/route.test.ts` (create)

**Steps:**
1. Add tests for `GET /api/fitbit/profile`:
   - Returns `{ ageYears, sex, heightCm, weightKg, weightLoggedDate, goalType, lastSyncedAt }` from cached Fitbit fetchers.
   - 401 if no session; FITBIT_* error mapping (reuse the convention from `nutrition-goals/route.ts`).
   - `Cache-Control: private, no-cache`.
   - Accepts `?refresh=1` query — invalidates Fitbit cache before fetching.
2. Run verifier (expect fail).
3. Implement the route using `getCachedFitbitProfile` + `getCachedFitbitWeightKg` + `getCachedFitbitWeightGoal`. On `?refresh=1`, call `invalidateFitbitProfileCache(userId)` first.
4. Add tests for `FitbitProfileCard`:
   - Renders fields with values + last-synced timestamp.
   - Shows "Not set in Fitbit" for `sex: "NA"` or missing fields.
   - "Refresh from Fitbit" button is at least 44×44; calls `?refresh=1` and re-fetches via SWR mutate.
   - Duplicate-submission guard: button disables while refresh in flight.
   - Loading + error states.
5. Implement `FitbitProfileCard` client component, render below the existing "Fitbit App Credentials" section in `settings-content.tsx`.
6. Run verifier (expect pass).

**Notes:**
- Read-only — no editing. All edits happen in the Fitbit app.

### Task 13: Backfill `daily_calorie_goals` from `lumen_goals`, then drop `lumen_goals`

**Linear Issue:** [FOO-979](https://linear.app/lw-claude/issue/FOO-979)

**Files:**
- `src/db/schema.ts` (modify — remove `lumenGoals` export)
- `drizzle/<auto>.sql` (generated — drops `lumen_goals` table)
- `drizzle/meta/_journal.json` (generated)
- `MIGRATIONS.md` (modify)

**Steps:**
1. Remove `lumenGoals` and the `unique("lumen_goals_user_date_uniq")` constraint from `src/db/schema.ts`.
2. Run `npx drizzle-kit generate` (lead, not workers).
3. Append a detailed entry to `MIGRATIONS.md` describing the data-migration that MUST run BEFORE the auto-generated `DROP TABLE lumen_goals` — this is a "Data-only" migration that `push-to-production` runs at release time. Reference SQL:

   ```sql
   -- 1. UPSERT macro columns into daily_calorie_goals from lumen_goals.
   INSERT INTO daily_calorie_goals (user_id, date, calorie_goal, protein_goal, carbs_goal, fat_goal, created_at, updated_at)
   SELECT lg.user_id, lg.date, COALESCE(dcg.calorie_goal, 0), lg.protein_goal, lg.carbs_goal, lg.fat_goal, NOW(), NOW()
   FROM lumen_goals lg
   LEFT JOIN daily_calorie_goals dcg ON dcg.user_id = lg.user_id AND dcg.date = lg.date
   ON CONFLICT (user_id, date) DO UPDATE
     SET protein_goal = EXCLUDED.protein_goal,
         carbs_goal = EXCLUDED.carbs_goal,
         fat_goal = EXCLUDED.fat_goal,
         updated_at = NOW();
   -- 2. AFTER above succeeds, the auto-generated Drizzle migration drops lumen_goals.
   ```

   Audit columns (`weight_kg`, `calories_out`, `rmr`, `activity_kcal`) intentionally remain NULL on backfilled rows — that's the historical-Lumen marker.

   Where rows had no matching `daily_calorie_goals` row, the INSERT creates one with `calorie_goal = 0`. The dashboard treats `calorie_goal = 0` as "no calorie goal set" and the macros still render. Acceptable for historical days.

4. No tests — schema removal + data-only migration. Existing tests for Lumen are deleted in Task 14.

**Notes:**
- **Migration note:** Production data — preserves Lucas + Mariana's Lumen history as macro goals on `daily_calorie_goals`, then drops `lumen_goals` table. Backfill must run before drop (push-to-production handles ordering).
- Per CLAUDE.md: do NOT hand-write the migration SQL file or snapshot — the generator produces them.

### Task 14: Remove all Lumen code

**Linear Issue:** [FOO-980](https://linear.app/lw-claude/issue/FOO-980)

**Files:**
- `src/lib/lumen.ts` (delete)
- `src/lib/__tests__/lumen.test.ts` (delete)
- `src/components/lumen-banner.tsx` (delete)
- `src/components/__tests__/lumen-banner.test.tsx` (delete)
- `src/app/api/lumen-goals/route.ts` (delete)
- `src/app/api/lumen-goals/__tests__/route.test.ts` (delete)
- `src/app/api/v1/lumen-goals/route.ts` (delete)
- `src/lib/claude-usage.ts` (modify — remove `lumen-parsing` operation entry / pricing line)
- `src/types/index.ts` (modify — remove `LumenGoalsResponse`, `LumenGoals`)

**Steps:**
1. Delete files listed above.
2. Modify `claude-usage.ts` to drop the `lumen-parsing` operation row from any pricing/operation map.
3. Modify `src/types/index.ts` to remove Lumen-related exports.
4. Run `npm run typecheck` and `npm test` — fix any leftover references (grep `lumen` case-insensitive across `src/`).
5. Run verifier (expect pass).

**Notes:**
- Per CLAUDE.md ("STATUS: PRODUCTION — Delete unused code immediately. No deprecation warnings needed.") — no soft-removal, no compatibility shim.
- The `/api/v1/lumen-goals` external endpoint is removed without a replacement. Per project memory, the only public consumer was the user themselves; if anything external breaks (Health Helper, etc.) it surfaces as a 404. Document in PR.
- E2E spec for Lumen (if any) is deleted in Task 15.

### Task 15: E2E coverage — reconnect → engine → dashboard → chat

**Linear Issue:** [FOO-981](https://linear.app/lw-claude/issue/FOO-981)

**Files:**
- `e2e/tests/macro-engine.spec.ts` (create)
- `e2e/tests/setup-fitbit.spec.ts` (modify if any Lumen flow lingers)
- `e2e/tests/lumen-banner.spec.ts` (delete if present)
- `e2e/fixtures/fitbit.ts` (modify — add profile/weight/weight-goal/activity mock fixtures)

**Steps:**
1. Add an E2E spec that, using the existing test-login + Fitbit mock harness:
   - Sets a token row with legacy scope `"nutrition activity"` → loads `/app` → expects "Reconnect Fitbit" banner with the new copy.
   - Simulates the reconnect-callback (test-login bypass writes a fresh token with full scopes).
   - Reloads `/app` → expects calorie ring + macro bars rendered with goals matching the engine output for the seeded mock profile/weight/activity.
   - Expands the "Today's targets" card → expects RMR + activity + TDEE + BMI tier displayed.
   - Calls `chat` (existing test path) with "what are my macros today?" → response contains `Targets ${cal} cal/day (P:Xg C:Yg F:Zg)` from the new source.
   - Force a degraded state: clear activity from the mock → reload → expects "Targets pending — waiting for Fitbit activity".
2. Update Fitbit mock fixture to expose `getProfile`, `getWeightLog`, `getWeightGoal` matching the live response shapes from research.
3. Delete obsolete Lumen E2E specs.
4. Run E2E (`npm run e2e`) — lead-only (workers should not).

**Notes:**
- Per CLAUDE.md, E2E is NOT part of the TDD loop; it runs at the end. Plan-implement workers should NOT run `npm run e2e`. The lead runs E2E during the post-implementation phase or push-to-production gates it.

## Post-Implementation Checklist

1. Run `bug-hunter` agent — Review changes for bugs, focus on: scope-mismatch banner regressions, race conditions in `getOrComputeDailyGoals`, Fitbit fetcher field validation, settings page rendering, multi-user correctness (no per-user state leakage in caches).
2. Run `verifier` agent — Verify all unit/integration tests pass, lint is clean, build is clean. Zero warnings.
3. Run `verifier "e2e"` — Verify E2E suite passes against the local Postgres.
4. Verify both Lucas and Mariana scenarios manually after deploy: each user sees the reconnect banner once, completes reconnect, dashboard shows engine-derived targets matching their respective Fitbit profiles.

---

## Plan Summary

**Objective:** Replace the Lumen screenshot flow with a transparent in-app macro engine that computes daily calorie + macro targets from each user's Fitbit profile + activity, supporting both Lucas (BMI > 30) and Mariana out of the box via BMI-tiered protein coefficients.

**Linear Issues:** FOO-967, FOO-968, FOO-969, FOO-970, FOO-971, FOO-972, FOO-973, FOO-974, FOO-975, FOO-976, FOO-977, FOO-978, FOO-979, FOO-980, FOO-981

**Approach:** Two-phase work bundled in one PR. Phase 1 expands Fitbit OAuth scopes (`profile`, `weight`), persists scope on `fitbit_tokens`, adds a Fitbit health check, and extends the existing `FitbitStatusBanner` with a `scope_mismatch` state — making each user reconnect once. Phase 2 builds a pure `macro-engine.ts` (Mifflin-St Jeor RMR + activity-derived TDEE + BMI-tiered macros), wires it into `daily_calorie_goals`, swaps the dashboard / chat / user-profile data sources, backfills Lumen history into the new columns, then deletes all Lumen code.

**Scope:** 15 tasks, ~30 files (create/modify/delete), ~25 new test files. Two Drizzle migrations (additive columns; lumen_goals drop). One MIGRATIONS.md entry for data backfill.

**Key Decisions:**
- Carb floor: `max((target_kcal − P·4 − F·9)/4, 130, 0.10·target_kcal/4)` (IOM minimum, not `kg × 3` which would always bind for high-BMI users).
- BMI-tiered protein: <25 → 2.2/1.6/1.8, 25-30 → 2.0/1.6/1.8, ≥30 → 1.8/1.6/1.6 g/kg (cut/maintain/bulk).
- Scope persisted only on initial OAuth exchange — Fitbit's refresh response doesn't include scope.
- `prompt=consent` appended on scope-upgrade redirects to force the consent screen (Fitbit silently re-issues otherwise).
- Differentiated cache TTLs (profile 24h, weight goal 24h, weight log 1h, activity 5min) — not uniform.
- First-of-day compute idempotency via `INSERT ... ON CONFLICT DO NOTHING` + in-flight Promise Map (mirrors `refreshInFlight` at `fitbit.ts:466`).
- Extend the existing `FitbitStatusBanner` with a 5th state — no new "Fitbit Connection" component.
- Lumen history preserved by backfill into `daily_calorie_goals` macro columns (audit columns NULL marks origin); `lumen_goals` table dropped.
- `prompt=consent` and reconnect banner are one-time UX — both Lucas and Mariana go through it once after deploy.

**Risks:**
- **Reconnect window:** Both users see the reconnect banner immediately after deploy. If they ignore it, the dashboard shows degraded state until reconnect. Mitigation: clear copy + single-click reconnect.
- **External `/api/v1/lumen-goals`:** Removal is hard-stop. If any external integration was reading it, it 404s. Mitigation: documented in PR; project memory confirms only the user consumes it.
- **Mifflin-St Jeor + 0.85 multiplier accuracy:** Engineering choice, not science. If the user's 14-day weight trend diverges from expected, the multiplier becomes the lever to tune. Constants exposed in `macro-engine.ts` for future adjustment.
- **Backfill ordering:** Lumen archival SQL must run BEFORE the Drizzle DROP. push-to-production's "Data-only" migration handling owns this; documented in MIGRATIONS.md.

---

## Iteration 1

**Implemented:** 2026-05-03
**Method:** Agent team (4 workers, worktree-isolated) + lead-only foundation/cleanup work

### Tasks Completed This Iteration

- Task 1: Schema — `fitbit_tokens.scope` + `daily_calorie_goals` macro/audit columns (FOO-967, lead pre-workers)
- Task 2: Persist Fitbit OAuth scope; `FITBIT_REQUIRED_SCOPES`; `prompt=consent` on scope-upgrade reconnect (FOO-968, worker-1)
- Task 3: Fitbit `getFitbitProfile` / `getFitbitLatestWeightKg` (7-day walk-back) / `getFitbitWeightGoal` fetchers (FOO-969, worker-2)
- Task 4: `checkFitbitHealth` lib + `GET /api/fitbit/health` route + `FitbitStatusBanner` `scope_mismatch` 5th state (FOO-970, worker-1)
- Task 5: `src/lib/fitbit-cache.ts` — process-level TTL cache with in-flight Promise dedupe (FOO-971, worker-2)
- Task 6: `src/lib/macro-engine.ts` — pure Mifflin-St Jeor + BMI-tiered macro compute (FOO-972, worker-3)
- Task 7: `src/lib/daily-goals.ts` — idempotent compute service with INSERT…ON CONFLICT + in-flight dedupe (FOO-973, worker-3)
- Task 8: `GET /api/nutrition-goals` returns calories + macros + status + audit (FOO-974, worker-3)
- Task 9: `chat-tools.executeGetNutritionSummary` + `food-log.getDateRangeNutritionSummary` switched to `daily_calorie_goals` macro source (FOO-975, worker-4)
- Task 10: `user-profile.buildUserProfile` switched to `getDailyGoalsByDate` (FOO-976, worker-4)
- Task 11: `TargetsCard` component + `daily-dashboard.tsx` cleanup (Lumen banner/upload/state removed; TargetsCard inserted) (FOO-977, worker-4)
- Task 12: `GET /api/fitbit/profile` route + `FitbitProfileCard` settings card (FOO-978, worker-2)
- Task 13: Drop `lumen_goals` table; backfill SQL documented in MIGRATIONS.md (FOO-979, lead post-workers)
- Task 14: Delete all Lumen code — lumen.ts, lumen-banner.tsx, /api/lumen-goals, /api/v1/lumen-goals, types, claude-usage entry (FOO-980, worker-4)
- Task 15: E2E smoke spec for scope-mismatch banner + TargetsCard + FitbitProfileCard render paths (FOO-981, lead)

### Files Modified

**Schema / migrations:**
- `src/db/schema.ts` — added `scope` to `fitbit_tokens`; added macro+audit cols to `daily_calorie_goals`; removed `lumenGoals` table.
- `drizzle/0020_motionless_vindicator.sql` — additive ALTER TABLE migrations (auto-runs).
- `drizzle/0021_mushy_madripoor.sql` — `DROP TABLE lumen_goals` (must be preceded by manual data-only backfill — see `MIGRATIONS.md`).
- `MIGRATIONS.md` — two new entries documenting both migrations and the backfill SQL.

**Library code (created):**
- `src/lib/macro-engine.ts` — pure compute (Mifflin-St Jeor RMR + BMI-tiered protein + activity-derived TDEE + carb floor)
- `src/lib/daily-goals.ts` — `getOrComputeDailyGoals`, `getDailyGoalsByDate`, `getDailyGoalsByDateRange` (in-flight Promise dedupe + INSERT/UPDATE)
- `src/lib/fitbit-cache.ts` — TTL cache (24h profile/goal, 1h weight, 5min activity) with per-key in-flight dedupe
- `src/lib/fitbit-health.ts` — `checkFitbitHealth` (local DB read; classifies as needs_setup / needs_reconnect / scope_mismatch / healthy)

**Library code (modified):**
- `src/lib/fitbit.ts` — added `FITBIT_REQUIRED_SCOPES`, `getFitbitProfile`, `getFitbitLatestWeightKg`, `getFitbitWeightGoal`, `subtractDays`; `buildFitbitAuthUrl` accepts `forceConsent`; `exchangeFitbitCode` returns `scope`; `getActivitySummary` returns `caloriesOut: null` when missing instead of throwing
- `src/lib/fitbit-tokens.ts` — `upsertFitbitTokens` accepts/persists `scope?`
- `src/lib/chat-tools.ts` — `executeGetNutritionSummary` reads `getDailyGoalsByDate`; dropped `dayType`
- `src/lib/food-log.ts` — `getDateRangeNutritionSummary` reads macros from `daily_calorie_goals`
- `src/lib/user-profile.ts` — `buildUserProfile` reads daily-goals row directly
- `src/lib/claude-usage.ts` — removed `lumen-parsing` operation entry

**API routes (created):**
- `src/app/api/fitbit/health/route.ts` — GET, session-auth-guarded
- `src/app/api/fitbit/profile/route.ts` — GET (with `?refresh=1` invalidation)

**API routes (modified):**
- `src/app/api/nutrition-goals/route.ts` — uses `getOrComputeDailyGoals`; validates `clientDate` format
- `src/app/api/auth/fitbit/route.ts` — computes `forceConsent` from existing token's scope vs required
- `src/app/api/auth/fitbit/callback/route.ts` — passes `tokens.scope` into `upsertFitbitTokens`

**API routes (deleted):**
- `src/app/api/lumen-goals/route.ts` (+ tests)
- `src/app/api/v1/lumen-goals/route.ts` (+ tests)

**Components (created):**
- `src/components/targets-card.tsx` — SWR-driven TargetsCard with collapsible audit
- `src/components/fitbit-profile-card.tsx` — read-only profile card with refresh

**Components (modified):**
- `src/components/fitbit-status-banner.tsx` — switched SWR to `/api/fitbit/health`; added scope_mismatch branch
- `src/components/daily-dashboard.tsx` — removed Lumen banner/upload/handlers/dayType badge/Update Lumen button; renders `<TargetsCard>`; MacroBars sources goals from `/api/nutrition-goals`
- `src/components/dashboard-prefetch.tsx` — removed `/api/lumen-goals` preload
- `src/components/settings-content.tsx` — renders `<FitbitProfileCard>` below Fitbit App Credentials

**Components (deleted):**
- `src/components/lumen-banner.tsx` (+ test)
- `src/lib/lumen.ts` (+ test)

**Types (`src/types/index.ts`):**
- Added: `FitbitProfile`, `FitbitProfileData`, `FitbitWeightLog`, `FitbitWeightGoal`, `FitbitFoodGoals`, `FitbitHealthStatus`, `MacroGoalType`, `MacroEngineInputs`, `MacroEngineOutputs`, `NutritionGoalsAudit`
- Modified: `NutritionGoals` extended with `proteinG`, `carbsG`, `fatG`, `status`, `reason?`, `audit?`; `ActivitySummary.caloriesOut` now `number | null`
- Removed: `LumenGoals`, `LumenGoalsResponse`, `LUMEN_PARSE_ERROR`

**E2E:**
- `e2e/tests/macro-engine.spec.ts` (new) — scope-mismatch banner, TargetsCard render, FitbitProfileCard render
- `e2e/tests/api-v1.spec.ts` — dropped lumen-goals endpoint test
- `e2e/fixtures/db.ts` — dropped `lumenGoals` from truncation list
- `src/db/__tests__/schema.test.ts` — removed `lumenGoals` block; added "does not export lumenGoals" assertion

### Linear Updates

- FOO-967, FOO-968, FOO-969, FOO-970, FOO-971, FOO-972, FOO-973, FOO-974, FOO-975, FOO-976, FOO-977, FOO-978, FOO-979, FOO-980, FOO-981 — all moved Todo → In Progress → Review

### Pre-commit Verification

- bug-hunter: Found 4 real issues (HIGH×2, MEDIUM×1, LOW×1) — all fixed before completion:
  - HIGH: `clientDate` was passed to DB/Fitbit unvalidated → added `isValidDateFormat` check
  - HIGH: Fast-path in `daily-goals.ts` defaulted `weightKg` to 0 when DB col was NULL → causing wrong BMI tier; tightened `hasMacros` to require non-null weightKg
  - MEDIUM: Partial-state path in `daily-goals.ts` was unreachable because `getActivitySummary` threw on missing `caloriesOut` → changed `getActivitySummary` to return `caloriesOut: null` instead, making the partial path actually reach
  - LOW: `FitbitProfileCard` rendered raw `error.message` → replaced with static "Could not load Fitbit profile"
- verifier (full mode): 189 test files, 3327 unit/integration tests pass; lint clean (zero warnings); production build clean
- verifier (e2e mode): 145 E2E tests pass

### Work Partition

- Pre-workers (lead): Task 1 — schema modification + `npx drizzle-kit generate` + MIGRATIONS.md entry
- Worker 1 (auth/health domain): Tasks 2, 4 — `fitbit.ts` scope + `fitbit-tokens.ts` + auth routes + `fitbit-health.ts` + health route + `FitbitStatusBanner`
- Worker 2 (Fitbit data + profile UI): Tasks 3, 5, 12 — `fitbit.ts` fetchers + `fitbit-cache.ts` + `/api/fitbit/profile` route + `FitbitProfileCard`
- Worker 3 (compute pipeline): Tasks 6, 7, 8 — `macro-engine.ts` + `daily-goals.ts` + `/api/nutrition-goals` route
- Worker 4 (consumers + dashboard + Lumen removal): Tasks 9, 10, 11, 14 — `chat-tools.ts` + `food-log.ts` + `user-profile.ts` + `daily-dashboard.tsx` + `targets-card.tsx` + delete all Lumen code
- Post-workers (lead): Task 13 (drop `lumen_goals` migration + backfill SQL); Task 15 (E2E spec); bug-hunter fixes

### Merge Summary

Foundation-first order: worker-1 → worker-2 → worker-3 → worker-4.

- Worker 1: clean merge (no conflicts).
- Worker 2: auto-resolved by `ort` strategy on `src/lib/fitbit.ts`, `src/lib/__tests__/fitbit.test.ts`, `src/types/index.ts`.
- Worker 3: 2 conflicts resolved by lead:
  - `src/lib/fitbit-cache.ts` — Worker 3 had stubbed it (Worker 2 not merged at write time); kept Worker 2's full implementation (HEAD).
  - `src/types/index.ts` — combined Worker 2's Fitbit types with Worker 3's macro engine + extended NutritionGoals types.
  - Post-merge fix: `daily-goals.ts` expected `getCachedFitbitWeightKg` to return a `number`, but Worker 2's actual signature returns `FitbitWeightLog | null`; unwrapped `.weightKg`. Test mocks updated to wrapped shape.
- Worker 4: 2 conflicts resolved by lead:
  - `src/lib/daily-goals.ts` — Worker 4 had stubbed it (Worker 3 not merged at write time); kept Worker 3's full implementation (HEAD).
  - `src/types/index.ts` — kept Worker 3's canonical NutritionGoals (the one at the bottom of the file extended with macros/status/audit) and dropped Worker 4's duplicate definition.

### Continuation Status

All tasks completed.
