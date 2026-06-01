# Implementation Plan

**Created:** 2026-05-31
**Source:** Inline request: Full Fitbit → Google Health API migration (hard cutover, staging-testable) + all review-surfaced bug/defect fixes + Anthropic Core modernization. Agent-only, single-shot, no deferred work.
**Linear Issues:** [FOO-1071](https://linear.app/lw-claude/issue/FOO-1071), [FOO-1072](https://linear.app/lw-claude/issue/FOO-1072), [FOO-1073](https://linear.app/lw-claude/issue/FOO-1073), [FOO-1074](https://linear.app/lw-claude/issue/FOO-1074), [FOO-1075](https://linear.app/lw-claude/issue/FOO-1075), [FOO-1076](https://linear.app/lw-claude/issue/FOO-1076), [FOO-1077](https://linear.app/lw-claude/issue/FOO-1077), [FOO-1078](https://linear.app/lw-claude/issue/FOO-1078), [FOO-1079](https://linear.app/lw-claude/issue/FOO-1079), [FOO-1080](https://linear.app/lw-claude/issue/FOO-1080), [FOO-1081](https://linear.app/lw-claude/issue/FOO-1081), [FOO-1082](https://linear.app/lw-claude/issue/FOO-1082), [FOO-1083](https://linear.app/lw-claude/issue/FOO-1083), [FOO-1084](https://linear.app/lw-claude/issue/FOO-1084), [FOO-1085](https://linear.app/lw-claude/issue/FOO-1085), [FOO-1086](https://linear.app/lw-claude/issue/FOO-1086), [FOO-1087](https://linear.app/lw-claude/issue/FOO-1087), [FOO-1088](https://linear.app/lw-claude/issue/FOO-1088), [FOO-1089](https://linear.app/lw-claude/issue/FOO-1089), [FOO-1090](https://linear.app/lw-claude/issue/FOO-1090), [FOO-1091](https://linear.app/lw-claude/issue/FOO-1091), [FOO-1092](https://linear.app/lw-claude/issue/FOO-1092), [FOO-1093](https://linear.app/lw-claude/issue/FOO-1093), [FOO-1094](https://linear.app/lw-claude/issue/FOO-1094), [FOO-1095](https://linear.app/lw-claude/issue/FOO-1095), [FOO-1096](https://linear.app/lw-claude/issue/FOO-1096), [FOO-1097](https://linear.app/lw-claude/issue/FOO-1097), [FOO-1098](https://linear.app/lw-claude/issue/FOO-1098), [FOO-1099](https://linear.app/lw-claude/issue/FOO-1099), [FOO-1100](https://linear.app/lw-claude/issue/FOO-1100)
**Branch:** feat/google-health-migration

## Context Gathered

### Codebase Analysis
- **Fitbit surface (all migrates):** `src/lib/fitbit.ts` (createFood/logFood/deleteFoodLog, profile/weight/weight-goal/activity reads, OAuth exchange/refresh, fetchWithRetry, ensureFreshToken), `fitbit-rate-limit.ts`, `fitbit-cache.ts`, `fitbit-tokens.ts`, `fitbit-credentials.ts`, `fitbit-health.ts`; routes `api/auth/fitbit/*`, `api/fitbit/*`, `api/fitbit-credentials`; components `fitbit-*`, `setup-fitbit`; hook `use-log-to-fitbit`; `FITBIT_*` ErrorCodes + `FITBIT_MEAL_TYPE_LABELS` + Fitbit `unit_id` registry (in the Claude tool schema).
- **Postgres is the source of truth** for nutrition; `fitbit_log_id`/`fitbit_food_id` are mirror handles only (already optional via the dry-run branches), so the cutover is a module-internal rewrite + OAuth-provider swap + schema migration, not a data rebuild.
- **Existing patterns to follow:** `src/lib/api-response.ts` + `ErrorCode`; `getSession()`+`validateSession()` (api/*) and `validateApiRequest()` (api/v1/*); `useSWR` shared fetcher (`src/lib/swr.ts`); route→lib→db layering (no `@/db` imports under `src/app`); every app route has `loading.tsx`; `token-encryption.ts` (AES-256-GCM) for tokens.
- **Test conventions:** colocated `__tests__/` (Vitest), E2E in `e2e/tests/*.spec.ts`. Workers run `npx vitest run "pattern"`.

### MCP Context
- **MCPs used:** Linear (issue creation, team "Food Scanner"); Railway (validated env vars across staging + production).
- **Validated facts (Railway scan):** ONE shared Google OAuth client (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` identical in both envs) is reused for Google Health — NO new credentials/redirect URIs. `auth.ts` already uses `access_type=offline`. `FITBIT_DRY_RUN=true` is set in staging only; the migration renames it to `HEALTH_DRY_RUN`. `FITBIT_CLIENT_ID`/`FITBIT_CLIENT_SECRET` env vars exist in both envs but have ZERO code usages (orphaned — removed at release). Users: Lucas + Mariana.
- **Google Health API (verified):** cloud REST successor to the Fitbit Web API (Fitbit Web API turns down Sept 2026); `nutrition-log` supports create/update/batchDelete (anonymous food = food_display_name + manual nutrients); self-serve, restricted scopes ride the existing Testing-mode unverified-app path (≤100 users, no CASA). 4 scopes: `googlehealth.nutrition.writeonly`, `profile.readonly`, `health_metrics_and_measurements.readonly`, `activity_and_fitness.readonly`.

## Tasks

<!-- ===== Phase 0 ===== -->

### Task 1: Bump @anthropic-ai/sdk ^0.78 -> ^0.100.1 and fix type-only compile fallout
**Linear Issue:** [FOO-1071](https://linear.app/lw-claude/issue/FOO-1071) · **Label:** Improvement · **Phase 0**

**Files:**
- `package.json` (modify)
- `package-lock.json` (modify)
- `src/lib/claude.ts` (modify)
- `src/lib/claude-usage.ts` (modify)

**Steps:**
1. Run baseline npx vitest run "claude" and capture the pass count as the regression baseline before touching the dep
2. Edit package.json to set "@anthropic-ai/sdk": "^0.100.1"; run npm install to refresh package-lock.json
3. Run npm run typecheck (expect possible failures); fix ONLY type-level breakage in src/lib/claude.ts (the messages.stream param type at ~312, Anthropic.Message/MessageParam/ToolUseBlock/Messages.ToolUnion refs, Sentry.instrumentAnthropicAiClient at ~26, WEB_SEARCH_TOOL type:'web_search_20260209' literal) and src/lib/claude-usage.ts — no behavioral change
4. Run npm run typecheck (expect pass: zero errors)
5. Run npx vitest run "claude" (expect pass: same count as baseline; the vi.mock shim at claude.test.ts:142 must keep working), then npm run build and npm run lint (expect zero warnings)

**Notes:**
- Foundation for A2/A3 — both build on the upgraded SDK (A3 uses the beta context-management types in this SDK line)
- If the SDK changed the error class shape or stream return type, the hand-rolled MockAnthropic shim (claude.test.ts:142-168) may need a small adjustment; keep the change type-only and STOP if runtime semantics shifted rather than papering over with casts

### Task 2: Extract parseErrorBody/sanitizeErrorBody/jsonWithTimeout into provider-neutral src/lib/http.ts and repoint auth.ts
**Linear Issue:** [FOO-1072](https://linear.app/lw-claude/issue/FOO-1072) · **Label:** Technical Debt · **Phase 0**

**Files:**
- `src/lib/http.ts` (create)
- `src/lib/__tests__/http.test.ts` (create)
- `src/lib/auth.ts` (modify)
- `src/lib/fitbit.ts` (modify)

**Steps:**
1. Write test in src/lib/__tests__/http.test.ts asserting parseErrorBody/sanitizeErrorBody/jsonWithTimeout behave identically to the fitbit.ts originals (sanitize redacts tokens, jsonWithTimeout aborts after REQUEST_TIMEOUT_MS via fake timers, parseErrorBody handles non-JSON bodies)
2. Run npx vitest run "http" (expect fail — module does not exist)
3. Move parseErrorBody, sanitizeErrorBody, jsonWithTimeout, and REQUEST_TIMEOUT_MS from src/lib/fitbit.ts into src/lib/http.ts (verbatim logic); re-point src/lib/auth.ts line-3 import from @/lib/fitbit to @/lib/http; leave fitbit.ts importing them from http.ts for now (fitbit.ts is deleted later in Phase 3 with no dangling helper)
4. Run npx vitest run "http auth" and npm run typecheck (expect pass)

**Notes:**
- M1 from the critique — auth.ts depends on these helpers; they MUST move out before fitbit.ts is deleted or the Google LOGIN path breaks
- google-health.ts (task 13) will import jsonWithTimeout/sanitizeErrorBody from this module too

### Task 3: Widen exchangeGoogleCode to return refresh_token/expires_in/scope without breaking the LOGIN path
**Linear Issue:** [FOO-1073](https://linear.app/lw-claude/issue/FOO-1073) · **Label:** Improvement · **Phase 0** · **Depends on:** Task 2

**Files:**
- `src/lib/auth.ts` (modify)
- `src/lib/__tests__/auth.test.ts` (modify)

**Steps:**
1. Write test in src/lib/__tests__/auth.test.ts (extend the exchangeGoogleCode describe) asserting it returns { access_token, refresh_token, expires_in, scope } when the token endpoint includes them, returns access_token with the optional fields undefined when omitted, and still POSTs grant_type=authorization_code with client_id/client_secret/redirect_uri
2. Run npx vitest run "auth" (expect fail — return shape currently only carries access_token)
3. Widen exchangeGoogleCode in src/lib/auth.ts to parse and return refresh_token?/expires_in?/scope? alongside access_token; keep the existing LOGIN callers (which read only access_token) untouched and green
4. Run npx vitest run "auth" (expect pass)

**Notes:**
- M2 from the critique — the health-connect callback (task 11) requires refresh_token + expires_in + scope to persist the refresh token
- Pattern: follow the existing fetch+jsonWithTimeout shape in exchangeGoogleCode (auth.ts:21-58)

<!-- ===== Phase 1 ===== -->

### Task 4: Own all src/types/index.ts renames: ErrorCode/session/FoodLogResponse + ServingUnit registry + meal-type
**Linear Issue:** [FOO-1074](https://linear.app/lw-claude/issue/FOO-1074) · **Label:** Technical Debt · **Phase 1**

**Files:**
- `src/types/index.ts` (modify)
- `src/types/__tests__/index.test.ts` (modify)

**Steps:**
1. Write tests in src/types/__tests__/index.test.ts: (a) getUnitLabel('g',150)==='150g', ('cup',1)==='1 cup', ('cup',2)==='2 cups', ('slice',2)==='2 slices', ('tbsp',3)==='3tbsp', ('serving',1)==='1 serving'; an unknown unit coerces to a safe '3 servings'-style label; coerceServingUnit maps each legacy Fitbit ID (147,226,91,349,364,209,311,304) to the correct string; (b) @ts-expect-error that FoodAnalysis.unit_id:147 and CommonFood.unitId:91 no longer compile while 'g'/'cup' do; (c) ErrorCode union contains HEALTH_NOT_CONNECTED/HEALTH_TOKEN_INVALID/HEALTH_SCOPE_MISSING/HEALTH_RATE_LIMIT/HEALTH_RATE_LIMIT_LOW/HEALTH_TIMEOUT/HEALTH_REFRESH_TRANSIENT/HEALTH_TOKEN_SAVE_FAILED/HEALTH_API_ERROR and excludes all FITBIT_* codes; (d) MEAL_TYPE_LABELS exists and FITBIT_MEAL_TYPE_LABELS does not
2. Run npx vitest run "types/__tests__/index" (expect fail)
3. Replace FITBIT_UNITS/getUnitById/FitbitUnitKey with SERVING_UNITS (keyed by ServingUnit 'g'|'oz'|'cup'|'tbsp'|'tsp'|'ml'|'slice'|'serving' carrying {name,plural}), rewrite getUnitLabel(unit:ServingUnit|string, amount) reusing UNITS_WITHOUT_SPACE rules, add coerceServingUnit(value):ServingUnit and export LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT; retype FoodAnalysis.unit_id and unitId on CommonFood/FoodLogHistoryEntry/FoodMatch/FoodLogEntryDetail/MealEntry to ServingUnit (keep JSON key names); in the FullSession/SessionData/ErrorCode block rename fitbitConnected->healthConnected, drop hasFitbitCredentials, swap FITBIT_* error codes for HEALTH_* (incl HEALTH_NOT_CONNECTED), rename FoodLogResponse.fitbitLogId->healthLogId (string), FitbitProfile->HealthProfile, FitbitWeightLog->HealthWeightLog, FitbitProfileData->HealthProfileData, FitbitHealthStatus->HealthConnectionStatus, FITBIT_MEAL_TYPE_LABELS->MEAL_TYPE_LABELS, FitbitMealType->MealType (values unchanged); remove the FitbitWeightGoal type if unreferenced
4. Run npx vitest run "types/__tests__/index" (expect pass)

**Notes:**
- SINGLE OWNER of src/types/index.ts per C2 — every other task that needs a renamed type/error/unit DEPENDS ON THIS TASK and must not edit src/types/index.ts itself
- Folds the unit-registry remodel + type retype + M8 meal-type rename + ErrorCode/session/FoodLogResponse renames into one coherent foundation edit
- Expect a wide compile cascade across claude.ts/food-log.ts/components/routes — those are fixed in their own tasks which depend on this one

- **Migration note:** Session/API contract change (no SQL): clients re-derive healthConnected; FoodLogResponse exposes healthLogId. Logged in MIGRATIONS.md so the release skill knows a forced re-consent shows healthConnected=false until reconnect.

### Task 5: Rename fitbit_tokens->health_tokens + port the token store to src/lib/health-tokens.ts; delete fitbit-tokens.ts
**Linear Issue:** [FOO-1075](https://linear.app/lw-claude/issue/FOO-1075) · **Label:** Technical Debt · **Phase 1** · **Depends on:** Task 4

**Files:**
- `src/db/schema.ts` (modify)
- `src/lib/health-tokens.ts` (create)
- `src/lib/__tests__/health-tokens.test.ts` (create)
- `src/lib/fitbit-tokens.ts` (delete)
- `src/lib/__tests__/fitbit-tokens.test.ts` (delete)
- `src/db/__tests__/schema.test.ts` (modify)
- `MIGRATIONS.md` (modify)

**Steps:**
1. Write test in src/db/__tests__/schema.test.ts (replace the fitbitTokens block ~49-66): assert getTableColumns(healthTokens) has healthUserId/accessToken/refreshToken/expiresAt/scope/updatedAt + notNull userId, and expect(schema).not.toHaveProperty('fitbitTokens')
2. Write test in src/lib/__tests__/health-tokens.test.ts porting fitbit-tokens.test.ts: getHealthTokens returns null on empty / decrypts access+refresh + healthUserId on a row; upsertHealthTokens encrypts both tokens and onConflictDoUpdate on userId; deleteHealthTokens deletes filtered by userId
3. Run npx vitest run "health-tokens schema" (expect fail)
4. In src/db/schema.ts rename the pgTable to health_tokens, export healthTokens, column healthUserId:text('health_user_id'); create src/lib/health-tokens.ts as a verbatim port of fitbit-tokens.ts (HealthTokenRow interface, encrypt/decrypt from token-encryption.ts unchanged) and DELETE src/lib/fitbit-tokens.ts + its test; append the rename + row-clear to MIGRATIONS.md
5. Run npx vitest run "health-tokens schema" (expect pass), then npm run typecheck to surface remaining @/lib/fitbit-tokens importers (migrated in the session/OAuth tasks)

**Notes:**
- Reuse encryptToken/decryptToken from src/lib/token-encryption.ts verbatim
- drizzle-kit generate (task 26) must emit a RENAME not drop+create; rows are cleared at deploy anyway but the FK/unique must survive the column rename

- **Migration note:** ALTER TABLE fitbit_tokens RENAME TO health_tokens; RENAME COLUMN fitbit_user_id TO health_user_id; then DELETE FROM health_tokens (every stored Fitbit token is invalid under Google) forcing both users to re-consent once. FK + unique carry over under rename.

### Task 6: Drop fitbit_credentials table and delete src/lib/fitbit-credentials.ts (per-user credentials removed)
**Linear Issue:** [FOO-1076](https://linear.app/lw-claude/issue/FOO-1076) · **Label:** Technical Debt · **Phase 1** · **Depends on:** Task 4

**Files:**
- `src/db/schema.ts` (modify)
- `src/lib/fitbit-credentials.ts` (delete)
- `src/lib/__tests__/fitbit-credentials.test.ts` (delete)
- `src/db/__tests__/schema.test.ts` (modify)
- `MIGRATIONS.md` (modify)

**Steps:**
1. Write test in src/db/__tests__/schema.test.ts (near the lumenGoals guard): expect(schema).not.toHaveProperty('fitbitCredentials')
2. Run npx vitest run "schema" (expect fail)
3. Remove the fitbitCredentials pgTable block from src/db/schema.ts; DELETE src/lib/fitbit-credentials.ts (all 7 exports + FitbitCredentials interface) and its test; append DROP TABLE fitbit_credentials to MIGRATIONS.md
4. Run npx vitest run "schema" (expect pass), then npm run typecheck to enumerate dangling @/lib/fitbit-credentials importers (session/settings/OAuth tasks own them; report for the lead's cross-domain merge)

**Notes:**
- Hard cutover — no stub. Google Health reuses the single shared Google OAuth client, so per-user client id/secret is obsolete
- Orphaned Railway vars FITBIT_CLIENT_ID/FITBIT_CLIENT_SECRET removed at deploy (humanDeployNotes), not in code

- **Migration note:** DROP TABLE IF EXISTS fitbit_credentials; — no data preservation (held obsolete per-user Fitbit OAuth client id/secret).

### Task 7: Convert food_log_entries.fitbit_log_id->health_log_id TEXT, drop custom_foods.fitbit_food_id, rewire food-log.ts + re-base visibility filter
**Linear Issue:** [FOO-1077](https://linear.app/lw-claude/issue/FOO-1077) · **Label:** Technical Debt · **Phase 1** · **Depends on:** Task 4, 5

**Files:**
- `src/db/schema.ts` (modify)
- `src/lib/food-log.ts` (modify)
- `src/lib/food-matching.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/lib/__tests__/food-matching.test.ts` (modify)
- `src/db/__tests__/schema.test.ts` (modify)
- `MIGRATIONS.md` (modify)

**Steps:**
1. Write tests: in src/db/__tests__/schema.test.ts assert foodLogEntries has healthLogId (string) and not fitbitLogId, and customFoods does not have fitbitFoodId; in src/lib/__tests__/food-log.test.ts assert insertFoodLogEntry persists healthLogId (string) or null, deleteFoodLogEntry/updateFoodLogEntry return { healthLogId:string|null }, and getCommonFoods/getRecentFoods exclude entries whose health_log_id is null when HEALTH_DRY_RUN unset but include them when HEALTH_DRY_RUN='true'; in food-matching.test.ts assert its visibility filter reads health_log_id not fitbitFoodId and respects HEALTH_DRY_RUN
2. Run npx vitest run "food-log food-matching schema" (expect fail)
3. In src/db/schema.ts change fitbitLogId bigint -> healthLogId text('health_log_id') (nullable) and remove the customFoods.fitbitFoodId column; in src/lib/food-log.ts rename every fitbitLogId identifier to healthLogId (number->string), delete every fitbitFoodId field reference (inputs, mappers, inserts, return types), and replace the three isNotNull(customFoods.fitbitFoodId) DRY-RUN gates (~275,391,829) with isNotNull(foodLogEntries.healthLogId) gated on HEALTH_DRY_RUN!=='true' (re-anchor searchFoods to join food_log_entries for its filter); in src/lib/food-matching.ts replace its FITBIT_DRY_RUN + fitbitFoodId reads (~102,112) with HEALTH_DRY_RUN + health_log_id; rename all FITBIT_DRY_RUN reads to HEALTH_DRY_RUN; append the column changes to MIGRATIONS.md
4. Run npx vitest run "food-log food-matching schema" (expect pass), then npm run typecheck to surface route-handler consumers for the lead

**Notes:**
- Resolves C1 + M5: drops custom_foods.fitbit_food_id AND rewrites the WHERE clauses in BOTH food-log.ts and food-matching.ts (food-matching.ts was missing from every draft file list) and renames all 5 FITBIT_DRY_RUN sites
- Visibility semantics shift from 'food has a remote food id' to 'log entry has a remote log id' — a visible behavior change to call out in the PR

- **Migration note:** food_log_entries DROP COLUMN fitbit_log_id; ADD COLUMN health_log_id text (drop+add, not a cast — old numeric Fitbit ids are meaningless handles, existing rows get null). custom_foods DROP COLUMN fitbit_food_id. Nutrition data is preserved (Postgres is source of truth); only the external mirror handle resets.

### Task 8: Add performance indexes + daily_calorie_goals activity_level CHECK + partial unique index on (user_id, health_log_id)
**Linear Issue:** [FOO-1078](https://linear.app/lw-claude/issue/FOO-1078) · **Label:** Performance · **Phase 1** · **Depends on:** Task 7

**Files:**
- `src/db/schema.ts` (modify)
- `src/db/__tests__/schema.test.ts` (modify)
- `MIGRATIONS.md` (modify)

**Steps:**
1. Write tests in src/db/__tests__/schema.test.ts using getTableConfig: assert food_log_entries has indexes named food_log_entries_user_date_idx over [user_id,date] and food_log_entries_custom_food_idx over [custom_food_id]; custom_foods has custom_foods_user_idx over [user_id]; dailyCalorieGoals has a check named daily_calorie_goals_activity_level_chk; foodLogEntries has a unique index food_log_entries_user_health_log_uniq over [user_id,health_log_id] with a non-empty partial where clause
2. Run npx vitest run "schema" (expect fail)
3. In src/db/schema.ts add (via the table-callback): index('food_log_entries_user_date_idx').on(userId,date), index('food_log_entries_custom_food_idx').on(customFoodId), index('custom_foods_user_idx').on(userId); check('daily_calorie_goals_activity_level_chk', activity_level IS NULL OR IN enum — copy the predicate verbatim from users_activity_level_chk); uniqueIndex('food_log_entries_user_health_log_uniq').on(userId,healthLogId).where(sql`health_log_id IS NOT NULL`); import index/uniqueIndex from drizzle-orm/pg-core; append the DDL note to MIGRATIONS.md
4. Run npx vitest run "schema" (expect pass) and npm run typecheck

**Notes:**
- Partial unique index depends on the health_log_id column existing (task 7)
- Lead should CREATE INDEX CONCURRENTLY on live tables; partial unique is safe because health_log_id is all-null right after the rename migration

- **Migration note:** Three CREATE INDEX (run CONCURRENTLY on populated tables); daily_calorie_goals activity_level CHECK (pre-validate no existing row violates the enum); CREATE UNIQUE INDEX ... WHERE health_log_id IS NOT NULL. No data change.

### Task 9: Add nullable users.weightGoalType (LOSE/MAINTAIN/GAIN) local setting + read/write helper; remove the Fitbit weight-goal source
**Linear Issue:** [FOO-1079](https://linear.app/lw-claude/issue/FOO-1079) · **Label:** Feature · **Phase 1** · **Depends on:** Task 4

**Files:**
- `src/db/schema.ts` (modify)
- `src/lib/user-settings.ts` (modify)
- `src/lib/__tests__/user-settings.test.ts` (modify)
- `src/db/__tests__/schema.test.ts` (modify)
- `MIGRATIONS.md` (modify)

**Steps:**
1. Write test in src/db/__tests__/schema.test.ts asserting users exposes a nullable weightGoalType column constrained to LOSE/MAINTAIN/GAIN; write test in src/lib/__tests__/user-settings.test.ts asserting a read helper returns the stored weightGoalType or null when unset and a write/validation helper rejects values outside LOSE/MAINTAIN/GAIN
2. Run npx vitest run "user-settings schema" (expect fail)
3. Add users.weightGoalType column + CHECK in src/db/schema.ts; add getWeightGoalType/setWeightGoalType (validate enum, scope by userId) to src/lib/user-settings.ts; append the column to MIGRATIONS.md
4. Run npx vitest run "user-settings schema" (expect pass) and npm run typecheck

**Notes:**
- Confirmed (grounding) the weight-goal value is display-only (profile card goalType) and NOT consumed by the macro engine — macro-engine derives direction from goalWeightKg vs current weight
- The Fitbit weight-goal read (getFitbitWeightGoal) + its cache (getCachedFitbitWeightGoal/weightGoalCache) are deleted in tasks 18/20 (C5); this task only adds the local replacement

- **Migration note:** ADD nullable users.weightGoalType (LOSE/MAINTAIN/GAIN). No backfill — null renders as 'Not set'; existing users re-select if they want it displayed.

### Task 10: Rewire src/lib/session.ts to health tokens: healthConnected, drop hasFitbitCredentials, requireFitbit->requireHealth
**Linear Issue:** [FOO-1080](https://linear.app/lw-claude/issue/FOO-1080) · **Label:** Technical Debt · **Phase 1** · **Depends on:** Task 4, 5, 6

**Files:**
- `src/lib/session.ts` (modify)
- `src/lib/__tests__/session.test.ts` (modify)
- `MIGRATIONS.md` (modify)

**Steps:**
1. Port tests in src/lib/__tests__/session.test.ts: mock @/lib/health-tokens.getHealthTokens; assert getSession() returns healthConnected:true on a row and false on null; the session object has no hasFitbitCredentials/fitbitConnected keys; validateSession(session,{requireHealth:true}) returns a 400 HEALTH_NOT_CONNECTED Response when healthConnected is false and null when true; no fitbit-credentials module is imported
2. Run npx vitest run "session" (expect fail)
3. In src/lib/session.ts replace the getFitbitTokens import with getHealthTokens from @/lib/health-tokens, delete the fitbit-credentials import + hasCredentials lookup, set healthConnected = (await getHealthTokens(userId)) !== null, remove the hasFitbitCredentials field, and collapse the two requireFitbit branches into one requireHealth -> errorResponse('HEALTH_NOT_CONNECTED', ..., 400); append the session-contract note to MIGRATIONS.md
4. Run npx vitest run "session" (expect pass), then npm run typecheck to surface every validateSession({requireFitbit}) caller and session.fitbitConnected reader for the lead

**Notes:**
- Foundation module imported by nearly every route — lead merges it with the types/auth domain and runs full npm test post-merge
- Consumes the ErrorCode/session renames already owned by task 4

- **Migration note:** No SQL (session state is recomputed per request). The forced re-consent shows healthConnected=false until reconnect.

<!-- ===== Phase 2 ===== -->

### Task 11: Add buildGoogleHealthAuthUrl + getGoogleHealthIdentity + reject login when email_verified is not true
**Linear Issue:** [FOO-1081](https://linear.app/lw-claude/issue/FOO-1081) · **Label:** Security · **Phase 2** · **Depends on:** Task 3

**Files:**
- `src/lib/auth.ts` (modify)
- `src/lib/__tests__/auth.test.ts` (modify)

**Steps:**
1. Write tests in src/lib/__tests__/auth.test.ts: (a) buildGoogleHealthAuthUrl hits accounts.google.com/o/oauth2/v2/auth, reuses GOOGLE_CLIENT_ID, sets access_type=offline + prompt=consent, scope contains all 4 googlehealth.* full URLs, and GOOGLE_HEALTH_SCOPES has length 4; (b) getGoogleHealthIdentity calls health.googleapis.com/v4/users/me/identity with Bearer, returns the health user id string, throws + logs 'google_health_identity_fetch_failed' on 403, aborts after timeout (fake timers); (c) getGoogleProfile returns emailVerified:true for boolean true OR string 'true' and false for false/absent (no throw — gate lives in the callback)
2. Run npx vitest run "auth" (expect fail)
3. Implement in src/lib/auth.ts: exported GOOGLE_HEALTH_SCOPES (4 exact URLs) + buildGoogleHealthAuthUrl (mirror buildGoogleAuthUrl, leave the LOGIN builder untouched); getGoogleHealthIdentity (mirror getGoogleProfile fetch+timeout+validate, jsonWithTimeout from @/lib/http); add emailVerified parsing to getGoogleProfile
4. Run npx vitest run "auth" (expect pass)

**Notes:**
- Folds the auth-URL builder, identity capture, and the genuinely-missing email_verified security gate into one auth.ts task
- Scope strings must be the EXACT full https://www.googleapis.com/auth/... URLs in one exported const reused by reads/health-status
- The email_verified callback gate (403 AUTH_INVALID_EMAIL before getOrCreateUser) is wired in task 14 along with the rest of the callback

### Task 12: Add /api/auth/google-health initiation route (authenticated, state-branching to the shared callback)
**Linear Issue:** [FOO-1082](https://linear.app/lw-claude/issue/FOO-1082) · **Label:** Feature · **Phase 2** · **Depends on:** Task 11

**Files:**
- `src/app/api/auth/google-health/route.ts` (create)
- `src/app/api/auth/google-health/__tests__/route.test.ts` (create)

**Steps:**
1. Write test in src/app/api/auth/google-health/__tests__/route.test.ts: mock @/lib/session + @/lib/auth; assert (a) no session -> validateSession's 401 returned, no redirect; (b) with a session -> 302 to the sentinel auth URL; (c) rawSession.oauthState is a JSON string whose parsed object has flow==='health-connect' + a nonce and save() was called; (d) buildGoogleHealthAuthUrl called with redirectUri ending in '/api/auth/google/callback'
2. Run npx vitest run "auth/google-health" (expect fail)
3. Implement src/app/api/auth/google-health/route.ts (POST+GET delegating to initiate()): require getSession()+validateSession(), build state JSON.stringify({nonce:crypto.randomUUID(), flow:'health-connect'}) into rawSession.oauthState, REUSE buildUrl('/api/auth/google/callback'), call buildGoogleHealthAuthUrl, 302-redirect, createRequestLogger action 'google_health_oauth_start'
4. Run npx vitest run "auth/google-health" (expect pass)

**Notes:**
- Reuses the single existing /api/auth/google/callback redirect URI (do NOT register a new one)
- Keep iron-session sameSite 'lax' so the OAuth redirect carries the cookie back

### Task 13: Branch the Google callback on OAuth state: login (+email_verified gate, setup-health redirect) vs health-connect (persist refresh token)
**Linear Issue:** [FOO-1083](https://linear.app/lw-claude/issue/FOO-1083) · **Label:** Feature · **Phase 2** · **Depends on:** Task 5, 10, 11, 12

**Files:**
- `src/app/api/auth/google/callback/route.ts` (modify)
- `src/app/api/auth/google/callback/__tests__/route.test.ts` (modify)
- `src/lib/auth.ts` (modify)
- `src/lib/__tests__/auth.test.ts` (modify)

**Steps:**
1. Write tests: in auth.test.ts (exchangeGoogleHealthCode) assert it POSTs to oauth2.googleapis.com/token, returns {access_token,refresh_token,expires_in,scope}, and throws a typed 'missing refresh_token' error when omitted; in the callback test: (a) LOGIN regression — no flow keeps create-user+session+302 green; (b) login post-redirect goes to /app when getHealthTokens returns a row and /app/setup-health when null; (c) emailVerified:false -> 403 AUTH_INVALID_EMAIL + warn, no getOrCreateUser/createSession; (d) HEALTH-CONNECT happy path — flow:'health-connect' + existing getSessionById session + tokens incl refresh_token + getGoogleHealthIdentity 'health-uid' -> upsertHealthTokens called with healthUserId/refreshToken/scope, 302 /app, createSession NOT called; (e) health-connect without an authenticated DB session -> 401 AUTH_MISSING_SESSION; (f) health-connect with missing refresh_token -> 400
2. Run npx vitest run "auth google/callback" (expect fail)
3. Implement exchangeGoogleHealthCode in src/lib/auth.ts (clone exchangeGoogleCode + validate refresh_token present); in the callback split into handleLogin (parse flow, email_verified gate, exchangeGoogleCode+getGoogleProfile+isEmailAllowed+getOrCreateUser+createSession, then redirect to /app or /app/setup-health based on getHealthTokens) and handleHealthConnect (require getSessionById session, exchangeGoogleHealthCode, getGoogleHealthIdentity, upsertHealthTokens, 302 to returnTo|/app); swap getFitbitTokens/hasFitbitCredentials for getHealthTokens; keep rate-limit guard + state validation/consumption + maskEmail logging
4. Run npx vitest run "auth google/callback" (expect pass)

**Notes:**
- Folds M3 (rewrite login-success redirect to setup-health/dashboard, removing the /api/auth/fitbit + hasCredentials tier) into the callback branch task
- Highest-coordination task — lands after the schema rename + health-tokens module + session rewire; the LOGIN branch must stay behaviorally equivalent (guard with the full login test suite)

- **Migration note:** After cutover all fitbit_tokens rows are cleared; both users re-consent once via login -> /app/setup-health -> google-health.

### Task 14: Create src/lib/google-health-rate-limit.ts — port the criticality breaker re-tuned for Google Cloud quota (429 cooldown)
**Linear Issue:** [FOO-1084](https://linear.app/lw-claude/issue/FOO-1084) · **Label:** Feature · **Phase 2**

**Files:**
- `src/lib/google-health-rate-limit.ts` (create)
- `src/lib/__tests__/google-health-rate-limit.test.ts` (create)
- `src/lib/fitbit-rate-limit.ts` (delete)
- `src/lib/__tests__/fitbit-rate-limit.test.ts` (delete)

**Steps:**
1. Write test in src/lib/__tests__/google-health-rate-limit.test.ts asserting: (a) cold start allows all three criticalities; (b) after a recorded 429 cooldown, assertRateLimitAllowed throws 'HEALTH_RATE_LIMIT_LOW' for 'optional' but returns for 'important'/'critical'; (c) 'critical' during cooldown emits a warn log and still returns; (d) once cooldownUntil elapses all criticalities allowed; (e) _resetForTests clears state
2. Run npx vitest run "google-health-rate-limit" (expect fail)
3. Implement src/lib/google-health-rate-limit.ts following fitbit-rate-limit.ts structure (per-user Map, injected logger) but substitute a recent-429 cooldownUntil model (parse Retry-After/RetryInfo); export HealthCallCriticality, assertRateLimitAllowed, recordRateLimitHeaders, getRateLimitSnapshot, _resetForTests; DELETE fitbit-rate-limit.ts + its test
4. Run npx vitest run "google-health-rate-limit" (expect pass)

**Notes:**
- Keep the breaker conservative — never block 'critical' writes, so a wrong tuning degrades to extra 429 retries, not lost food logs

- **Migration note:** Google Health 429/Retry-After body shape inferred from docs — to be confirmed against the real API during staging QA.

### Task 15: Create src/lib/google-health.ts core — fetchWithRetry + refreshGoogleHealthToken + race-safe ensureFreshToken
**Linear Issue:** [FOO-1085](https://linear.app/lw-claude/issue/FOO-1085) · **Label:** Feature · **Phase 2** · **Depends on:** Task 5, 14

**Files:**
- `src/lib/google-health.ts` (create)
- `src/lib/__tests__/google-health.test.ts` (create)

**Steps:**
1. Write tests in src/lib/__tests__/google-health.test.ts (mock fetch, @/lib/google-health-rate-limit, @/lib/health-tokens, @/lib/logger, @sentry/nextjs): fetchWithRetry maps 401->'HEALTH_TOKEN_INVALID', 403->'HEALTH_SCOPE_MISSING', 429-then-200 succeeds after one retry, two 429s->'HEALTH_RATE_LIMIT', deadline exceeded->'HEALTH_TIMEOUT'; refreshGoogleHealthToken returns a new access_token while PRESERVING the input refresh token (Google does not rotate it), throws 'HEALTH_TOKEN_INVALID' on 400/401; a CONCURRENCY test fires ~5 ensureFreshToken(userId) on a near-expired row and asserts refreshGoogleHealthToken runs EXACTLY ONCE and all resolve to the same fresh token
2. Run npx vitest run "google-health" (expect fail)
3. Implement src/lib/google-health.ts porting fetchWithRetry from fitbit.ts (AbortController timeout, DEADLINE_MS budget, 429 single-retry, 5xx backoff, breaker on retryCount===0 via the new rate-limit module) using jsonWithTimeout/sanitizeErrorBody from @/lib/http; refreshGoogleHealthToken (POST oauth2.googleapis.com/token grant_type=refresh_token, env GOOGLE_CLIENT_ID/SECRET, preserve refresh token); RACE-SAFE ensureFreshToken — register the in-flight promise BEFORE the refresh decision and re-read the token row INSIDE the deduped promise (refreshInFlight.get(userId) ?? createAndRegister), short-circuit if a concurrent refresh already updated it, delete the key in finally; map upsert failure to 'HEALTH_TOKEN_SAVE_FAILED'
4. Run npx vitest run "google-health" (expect pass)

**Notes:**
- The ensureFreshToken concurrency fix closes the read-then-check window present in fitbit.ts:582-633 — highest-value correctness fix
- Uses getHealthTokens/upsertHealthTokens from the task-5 module

<!-- ===== Phase 3 ===== -->

### Task 16: Add createNutritionLog + deleteNutritionLogs to google-health.ts (isolated body-builder) with HEALTH_DRY_RUN
**Linear Issue:** [FOO-1086](https://linear.app/lw-claude/issue/FOO-1086) · **Label:** Feature · **Phase 3** · **Depends on:** Task 15

**Files:**
- `src/lib/google-health.ts` (modify)
- `src/lib/__tests__/google-health.test.ts` (modify)
- `src/lib/fitbit.ts` (modify)

**Steps:**
1. Write tests (mock fetch) for createNutritionLog: ONE POST to nutrition-log/dataPoints (not two), body carries food_display_name + energy + protein/carbs/fat/fiber/sodium, omits trans_fat/sugars/saturated_fat/calories_from_fat when the FoodAnalysis fields are null and includes them when present, rounds fractional calories (Math.round), accepts {amount, servingUnit:string}, returns { healthLogId:<string> }; throws 'HEALTH_API_ERROR' on non-ok and on a 200 body lacking a string id; deleteNutritionLogs: single batchDelete POST with the id array, 404 resolves (already-deleted), 500 throws 'HEALTH_API_ERROR'; with HEALTH_DRY_RUN='true' neither function calls fetch and both resolve
2. Run npx vitest run "google-health" (expect fail)
3. Implement createNutritionLog + deleteNutritionLogs in src/lib/google-health.ts with the request-body construction isolated in ONE buildNutritionLogBody helper (port nutrient-param logic from fitbit.ts:221-247, not-found handling from fitbit.ts:367-373), criticality 'critical', module-level HEALTH_DRY_RUN gate (single source)
4. Run npx vitest run "google-health" (expect pass)

**Notes:**
- Collapses Fitbit createFood+logFood into one anonymous-food create; batchDelete replaces deleteFoodLog
- Anonymous-food logs are not editable in place — fine because the app always does delete-old+create-new

- **Migration note:** The Google Health nutrition-log create/batchDelete JSON field paths (energy/macros, serving amount+unit) are inferred from docs — body shapes to be confirmed against the real API during staging QA. The isolated body-builder contains the blast radius.

### Task 17: Rewire log-food + edit-food + food-history DELETE routes to Google Health (create/batchDelete, compensation, idempotency, HEALTH_* error mapping)
**Linear Issue:** [FOO-1087](https://linear.app/lw-claude/issue/FOO-1087) · **Label:** Feature · **Phase 3** · **Depends on:** Task 4, 7, 16

**Files:**
- `src/app/api/log-food/route.ts` (modify)
- `src/app/api/log-food/__tests__/route.test.ts` (modify)
- `src/app/api/edit-food/route.ts` (modify)
- `src/app/api/edit-food/__tests__/route.test.ts` (modify)
- `src/app/api/food-history/[id]/route.ts` (modify)
- `src/app/api/food-history/[id]/__tests__/route.test.ts` (modify)

**Steps:**
1. Write log-food tests: new-food POST calls createNutritionLog EXACTLY once (not create+log) and persists the returned string healthLogId; reuse flow builds createNutritionLog from the stored custom food (no legacy fitbit-id check); DB-insert-failure-after-create calls deleteNutritionLogs([id]) and returns INTERNAL_ERROR (PARTIAL_ERROR if rollback also throws); idempotency — two POSTs with the same clientToken/user call createNutritionLog once and return the same foodLogId, a different token creates a new log; a thrown 'HEALTH_RATE_LIMIT_LOW' -> HTTP 503. Write edit-food tests: regular path deletes old + creates new + persists new id; fast path (nutrition unchanged) also delete+create from the entry's own nutrients; both compensation branches (re-create original on failed re-create; delete new on DB failure); HEALTH_DRY_RUN skips remote calls. Write food-history DELETE tests: deletes remote then DB row; skips remote when no healthLogId or HEALTH_DRY_RUN; HEALTH_TOKEN_INVALID->401, HEALTH_API_ERROR->502, HEALTH_RATE_LIMIT_LOW->503
2. Run npx vitest run "api/log-food api/edit-food api/food-history" (expect fail)
3. Rewrite all three routes: swap @/lib/fitbit imports for ensureFreshToken/createNutritionLog/deleteNutritionLogs from @/lib/google-health; collapse findOrCreateFood->logFood into createNutritionLog; store string healthLogId; preserve every compensation branch; add the per-user short-TTL in-memory clientToken idempotency guard to log-food (validate clientToken shape in isValidFoodLogRequest); add HEALTH_RATE_LIMIT_LOW->503 (was missing on log-food) and the full HEALTH_* -> HTTP mapping; read HEALTH_DRY_RUN
4. Run npx vitest run "api/log-food api/edit-food api/food-history" (expect pass)

**Notes:**
- Consolidates the 3 write-route rewires — they share the same google-health import surface and error-mapping pattern
- The in-memory idempotency cache is per-process (resets on deploy) — acceptable for a 2-user app; document the TTL
- edit-food has 4 compensation branches — each must be re-tested

- **Migration note:** log-food request contract gains optional clientToken; responses expose healthLogId instead of fitbit ids (consumed by the hook/UI task). Old rows carrying legacy numeric ids become stale string-incompatible handles, replaced on next edit/delete.

### Task 18: Add getHealthProfile + getHealthLatestWeightKg + getHealthActivitySummary reads to google-health.ts; delete the Fitbit reads + weight-goal read
**Linear Issue:** [FOO-1088](https://linear.app/lw-claude/issue/FOO-1088) · **Label:** Feature · **Phase 3** · **Depends on:** Task 4, 15, 17

**Files:**
- `src/lib/google-health.ts` (modify)
- `src/lib/__tests__/google-health.test.ts` (modify)
- `src/lib/fitbit.ts` (delete)

**Steps:**
1. Write tests in src/lib/__tests__/google-health.test.ts: getHealthProfile parses Google Health v4 /users/me into { ageYears:int, sex:'MALE', heightCm } (Bearer + v4 URL asserted); 'female'->'FEMALE', unknown/absent sex -> 'NA' (NOT a throw), height in meters/explicit unit converted to cm, age derived from DOB with frozen time, 401->'HEALTH_TOKEN_INVALID', non-ok->'HEALTH_API_ERROR'. getHealthLatestWeightKg issues EXACTLY ONE ranged fetch over [targetDate-13d,targetDate], returns the most-recent point on/before targetDate (not the first), null on empty, converts non-kg to kg, excludes points after targetDate, logs the 14-day window (not '7 days'). getHealthActivitySummary parses dailyRollUp into { caloriesOut:number }, returns { caloriesOut:null } on empty roll-up (no throw), converts kJ->kcal if applicable, 401/non-ok mapping
2. Run npx vitest run "google-health" (expect fail)
3. Implement getHealthProfile/getHealthLatestWeightKg/getHealthActivitySummary in src/lib/google-health.ts via the module fetchWithRetry+criticality, isolating each response parser in its own helper; map the sex enum defaulting unknown to NA, convert height to cm and weight to kg, derive age from DOB, single ranged weight read replacing the 14-day walk-back; DELETE src/lib/fitbit.ts entirely (getFitbitProfile/getFitbitLatestWeightKg/getActivitySummary/getFitbitWeightGoal and the rest) now that all consumers are migrated
4. Run npx vitest run "google-health" (expect pass) and npm run typecheck (confirm no remaining @/lib/fitbit importer)

**Notes:**
- Consolidates the 3 read migrations into one google-health.ts read-layer task and performs the final fitbit.ts deletion
- getFitbitWeightGoal is dropped (C5) — replaced by the local users.weightGoalType from task 9; no read equivalent in Google Health
- Defaulting unknown sex to NA keeps the daily-goals 'sex_unset' path alive for both users

- **Migration note:** Google Health profile (sex/height/DOB), ranged weight, and dailyRollUp caloriesOut field paths + units (kg/cm/kcal-vs-kJ) are inferred from docs — body shapes to be confirmed against the real API during staging QA.

### Task 19: Rename fitbit-cache->health-cache (drop weight-goal cache) and rewire daily-goals.ts consumers
**Linear Issue:** [FOO-1089](https://linear.app/lw-claude/issue/FOO-1089) · **Label:** Improvement · **Phase 3** · **Depends on:** Task 18

**Files:**
- `src/lib/health-cache.ts` (create)
- `src/lib/__tests__/health-cache.test.ts` (create)
- `src/lib/fitbit-cache.ts` (delete)
- `src/lib/__tests__/fitbit-cache.test.ts` (delete)
- `src/lib/daily-goals.ts` (modify)

**Steps:**
1. Port src/lib/__tests__/health-cache.test.ts from fitbit-cache.test.ts: mock the google-health read fns; assert getCachedHealthProfile caches for TTL_24H, dedups concurrent in-flight calls, invalidateHealthProfileCache bumps the per-user generation and clears profile/weight/activity; assert the orphan-write guard (value resolved after invalidation is not written); remove all weight-goal cache tests
2. Run npx vitest run "health-cache" (expect fail)
3. Create src/lib/health-cache.ts from fitbit-cache.ts with renamed exports (getCachedHealthProfile/getCachedHealthWeightKg/getCachedHealthActivitySummary/invalidateHealthProfileCache), importing the google-health read fns + ensureFreshToken; DELETE getCachedFitbitWeightGoal + weightGoalCache/weightGoalInFlight + their invalidation (C5); update Sentry/log category strings; DELETE src/lib/fitbit-cache.ts; update src/lib/daily-goals.ts imports + the doCompute Promise.all (~334-337) to getCachedHealthProfile/getCachedHealthWeightKg
4. Run npx vitest run "health-cache daily-goals" (expect pass)

**Notes:**
- Hub module — daily-goals.ts (macro engine entrypoint), profile route, and v1 activity route all import it; renames land atomically with consumers
- TTL behavior (24h profile, 1h/10min weight, 5min activity) ports verbatim

### Task 20: Migrate the internal profile route + external v1/activity-summary route to Google Health data + HEALTH_* errors (M4 health-connection status)
**Linear Issue:** [FOO-1090](https://linear.app/lw-claude/issue/FOO-1090) · **Label:** Improvement · **Phase 3** · **Depends on:** Task 9, 19

**Files:**
- `src/app/api/health-profile/route.ts` (create)
- `src/app/api/health-profile/__tests__/route.test.ts` (create)
- `src/app/api/fitbit/profile/route.ts` (delete)
- `src/lib/health-connection.ts` (create)
- `src/lib/__tests__/health-connection.test.ts` (create)
- `src/lib/fitbit-health.ts` (delete)
- `src/app/api/health-status/route.ts` (create)
- `src/app/api/fitbit/health/route.ts` (delete)
- `src/app/api/v1/activity-summary/route.ts` (modify)
- `src/app/api/v1/activity-summary/__tests__/route.test.ts` (modify)
- `src/lib/swr.ts` (modify)

**Steps:**
1. Write tests: health-profile route returns { ageYears,sex,heightCm,weightKg,weightLoggedDate,goalType,lastSyncedAt } with Cache-Control private,no-cache, goalType from users.weightGoalType (null when unset), ?refresh=1 invalidates cache + invalidateUserDailyGoalsForDate, HEALTH_TOKEN_INVALID->401 / HEALTH_RATE_LIMIT_LOW->503, no FITBIT_CREDENTIALS_MISSING branch; health-connection checkHealthConnection returns needs_reconnect/scope_mismatch/healthy (no needs_setup/credentials branch) using getHealthTokens + GOOGLE_HEALTH_SCOPES; health-status route returns the HealthConnectionStatus payload; v1/activity-summary sources caloriesOut from getCachedHealthActivitySummary, keeps Bearer auth + per-key rate-limit + date validation + ETag, maps HEALTH_* errors and drops the credentials branch
2. Run npx vitest run "health-profile health-connection health-status v1/activity-summary" (expect fail)
3. Implement: create /api/health-profile (non-colliding with the public /api/health) reading getCachedHealthProfile/getCachedHealthWeightKg + local weightGoalType, HEALTH_* mapping, DELETE old /api/fitbit/profile; port checkFitbitHealth->checkHealthConnection into src/lib/health-connection.ts (collapse to needs_reconnect/scope_mismatch/healthy, drop the credentials branch) and DELETE src/lib/fitbit-health.ts; create /api/health-status route + DELETE /api/fitbit/health; swap the v1 route to getCachedHealthActivitySummary + HEALTH_* mapping + de-fitbit the log/comment strings; update the SWR keys in src/lib/swr.ts (and HEALTH_BACKED_SWR_CONFIG)
4. Run npx vitest run "health-profile health-connection health-status v1/activity-summary" (expect pass)

**Notes:**
- Folds M4 (checkFitbitHealth->checkHealthConnection + /api/fitbit/health route migration, which no draft owned) with the profile route rename and the v1 route migration
- Choose a profile route path that does NOT shadow the public /api/health check (e.g. /api/health-profile)
- Uses HealthProfileData/HealthConnectionStatus already renamed in task 4 and goalType from task 9

- **Migration note:** Client-facing route paths change (/api/fitbit/profile -> /api/health-profile, /api/fitbit/health -> /api/health-status); SWR keys move for the profile + daily-goals cards. External v1/activity-summary body { caloriesOut } is unchanged; only the upstream source + error codes change.

### Task 21: Update Claude tool schema/prompt + tool-output validation + DB-write validation to the serving_unit string
**Linear Issue:** [FOO-1091](https://linear.app/lw-claude/issue/FOO-1091) · **Label:** Improvement · **Phase 3** · **Depends on:** Task 4

**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/food-validation.ts` (modify)
- `src/lib/__tests__/food-validation.test.ts` (modify)
- `src/lib/analysis-session.ts` (modify)
- `src/lib/__tests__/analysis-session.test.ts` (modify)

**Steps:**
1. Write tests: REPORT_NUTRITION_TOOL + report_session_items items schema expose serving_unit (string + enum exactly ['g','oz','cup','tbsp','tsp','ml','slice','serving']), 'unit_id' absent from properties, serving_unit in required and unit_id excluded; each input_example has a serving_unit string and no numeric unit_id; validateFoodAnalysis on serving_unit:'cup' returns result.unit_id==='cup', a missing/invalid serving_unit coerces to 'serving' (no throw, matching the tolerant confidence pattern); validateSessionItems passes serving_unit through; food-validation isValidFoodAnalysisFields accepts unit_id:'g' and rejects 147/'bogus'; analysis-session match validator accepts unitId:'cup' and rejects 91/'bogus'
2. Run npx vitest run "claude food-validation analysis-session" (expect fail)
3. In src/lib/claude.ts rename the schema property + required entry to serving_unit (enum + plain-language description) in BOTH tools, rewrite input_examples, update the system-prompt unit wording (~34, 2120) and the session-item context line (~2342) to stop leaking a numeric id; drop 'unit_id' from validateFoodAnalysis numericFields, read+coerce data.serving_unit via coerceServingUnit, set result.unit_id to the coerced ServingUnit; in src/lib/food-validation.ts and src/lib/analysis-session.ts change the numeric-unit guards to require a serving-unit set member (compare via coerceServingUnit, reject non-members as 400)
4. Run npx vitest run "claude food-validation analysis-session" (expect pass)

**Notes:**
- report_nutrition is strict:true + additionalProperties:false — the rename MUST update both properties and required in both tools or the schema is invalid and analysis breaks
- Coerce (warn+default 'serving') rather than throw on unknown model output so one bad output doesn't abort the analysis
- Consumes ServingUnit/coerceServingUnit/SERVING_UNITS from task 4

<!-- ===== Phase 4 ===== -->

### Task 22: Rename use-log-to-fitbit->use-log-food + retype healthLogId; update all 5 consumers and unit-renderer components incl chat-tools.ts
**Linear Issue:** [FOO-1092](https://linear.app/lw-claude/issue/FOO-1092) · **Label:** Improvement · **Phase 4** · **Depends on:** Task 4, 17, 21

**Files:**
- `src/hooks/use-log-food.ts` (create)
- `src/hooks/__tests__/use-log-food.test.ts` (create)
- `src/hooks/use-log-to-fitbit.ts` (delete)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/quick-select.tsx` (modify)
- `src/components/food-chat.tsx` (modify)
- `src/components/saved-food-detail.tsx` (modify)
- `src/components/log-shared-content.tsx` (modify)
- `src/components/food-detail.tsx` (modify)
- `src/components/analysis-result.tsx` (modify)
- `src/components/food-entry-card.tsx` (modify)
- `src/components/nutrition-facts-card.tsx` (modify)
- `src/components/mini-nutrition-card.tsx` (modify)
- `src/components/food-match-card.tsx` (modify)
- `src/components/food-entry-detail-sheet.tsx` (modify)
- `src/components/food-history.tsx` (modify)
- `src/components/meal-breakdown.tsx` (modify)
- `src/lib/chat-tools.ts` (modify)
- `src/components/__tests__/nutrition-facts-card.test.tsx` (modify)
- `src/components/__tests__/food-entry-card.test.tsx` (modify)

**Steps:**
1. Write tests: use-log-food test (ported from use-log-to-fitbit) asserts it reads FoodLogResponse.healthLogId; nutrition-facts-card rendered with unitId='g' amount=150 shows '150g'; food-entry-card with unitId='slice' amount=2 shows '2 slices'
2. Run npx vitest run "use-log-food nutrition-facts-card food-entry-card" (expect fail)
3. Create src/hooks/use-log-food.ts (rename of use-log-to-fitbit, retype FoodLogResponse usage to healthLogId), DELETE the old hook; update the 5 hook consumers (food-analyzer/quick-select/food-chat/saved-food-detail/log-shared-content); retype every component's unitId/unit_id prop and FoodAnalysis-derived value to ServingUnit (mechanical — chat-tools.ts getUnitLabel calls compile once food.unitId/entry.unitId are strings); flip numeric-unit fixtures to strings across the affected component test files
4. Run npx vitest run "use-log-food nutrition-facts-card food-entry-card food-detail analysis-result" plus a full component-suite npm test to catch remaining numeric-unit fixtures (expect pass)

**Notes:**
- Folds M9 (hook rename + 5 consumers) with M10 (chat-tools.ts) and the renderer-consumer cascade — all fall out of the task-4 type changes
- Budget a sweep of ALL test fixtures that construct FoodAnalysis/entry mocks with numeric unit_id, not just the two named files

### Task 23: Replace Fitbit setup/guard/banner/card/settings UI with one-click Connect Google Health flow; rename healthMode; a11y + contrast fixes
**Linear Issue:** [FOO-1093](https://linear.app/lw-claude/issue/FOO-1093) · **Label:** Feature · **Phase 4** · **Depends on:** Task 4, 10, 12, 20

**Files:**
- `src/app/app/connect-health/page.tsx` (create)
- `src/app/app/connect-health/loading.tsx` (create)
- `src/app/app/connect-health/__tests__/page.test.tsx` (create)
- `src/app/app/setup-fitbit/page.tsx` (delete)
- `src/app/app/setup-fitbit/loading.tsx` (delete)
- `src/components/fitbit-setup-form.tsx` (delete)
- `src/components/health-connect-guard.tsx` (create)
- `src/components/__tests__/health-connect-guard.test.tsx` (create)
- `src/components/fitbit-setup-guard.tsx` (delete)
- `src/components/health-status-banner.tsx` (create)
- `src/components/health-profile-card.tsx` (create)
- `src/components/fitbit-status-banner.tsx` (delete)
- `src/components/fitbit-profile-card.tsx` (delete)
- `src/components/settings-content.tsx` (modify)
- `src/app/app/page.tsx` (modify)
- `src/app/app/analyze/page.tsx` (modify)
- `src/app/app/chat/page.tsx` (modify)
- `src/app/app/edit/[id]/page.tsx` (modify)
- `src/app/app/quick-select/page.tsx` (modify)
- `src/app/app/saved/[id]/page.tsx` (modify)
- `src/app/app/capture/page.tsx` (modify)
- `src/app/app/process-captures/page.tsx` (modify)
- `src/app/api/health/route.ts` (modify)
- `src/components/food-analyzer.tsx` (modify)
- `src/components/daily-goals-card.tsx` (modify)

**Steps:**
1. Write/port tests: connect-health page renders h1 'Connect Google Health', SkipLink + <main id=main-content>, back link to /app, a single form posting to the health-connect endpoint with a min-h-[44px] button, redirect('/') when no session; health-connect-guard renders children when healthConnected, else a connect prompt Link to /app/connect-health, animate-pulse on loading, null on undefined data; health-status-banner shows 'Google Health' copy + connect CTA, null when healthy; health-profile-card shows 'Google Health Profile' + 'Refresh from Google Health' + 'Not set in Google Health' (refresh-error <p> text-destructive, stale-weight <p> text-warning); settings renders a Google Health status line + connect/reconnect Link to /app/connect-health + <HealthProfileCard/> and no credential-edit UI; /api/health returns healthMode (not fitbitMode) from HEALTH_DRY_RUN; food-analyzer save banner uses text-success and food-chat warning uses text-warning; capture/process-captures/saved each render SkipLink + <main id=main-content>; food-detail/food-entry-detail-sheet link-copied use text-success and daily-goals-card safety-floor uses text-warning
2. Run npx vitest run "connect-health health-connect-guard health-status-banner health-profile-card settings-content api/health food-analyzer food-chat capture process-captures saved daily-goals-card food-detail food-entry-detail-sheet" (expect fail)
3. Implement: create connect-health page+loading (single POST form to the health-connect initiation endpoint), health-connect-guard (single healthConnected branch reading /api/auth/session), health-status-banner + health-profile-card (Google Health copy, renamed health endpoints/types, Link to /app/connect-health, theme-token colors); strip all Fitbit credential state/handlers/cards from settings-content and narrow SessionInfo to {email,healthConnected,expiresAt}; swap all 5 guard-consumer pages + the banner consumer to the new components; add SkipLink/#main-content to capture/process-captures/saved; change /api/health to healthMode from HEALTH_DRY_RUN; fix the contrast tokens in food-analyzer/food-chat/food-detail/food-entry-detail-sheet/daily-goals-card; DELETE setup-fitbit/, fitbit-setup-form, fitbit-setup-guard, fitbit-status-banner, fitbit-profile-card + their tests
4. Run the same vitest pattern (expect pass); grep src/ + e2e/ to confirm zero remaining Fitbit component/route identifiers or 'fitbitMode'

**Notes:**
- Consolidates 8 UI drafts (connect page, guard, banner/card rename, settings strip, contrast x2, skiplinks, healthMode) into one cohesive UI cutover — they share the same component graph and depend on the same session/types renames
- Consumes session.healthConnected (task 10), HealthProfileData/HealthConnectionStatus (task 4), and the health-connect initiation route (task 12)
- Mobile-first: min-h-[44px] touch targets; success/warning/destructive tokens are defined in globals.css

- **Migration note:** Railway: set HEALTH_DRY_RUN=true on staging (health route reports healthMode). Client UI no longer references /app/setup-fitbit or /api/fitbit-credentials.

### Task 24: Anthropic Core A2: move volatile date/time out of the cached system block + extend cache_control over image blocks
**Linear Issue:** [FOO-1094](https://linear.app/lw-claude/issue/FOO-1094) · **Label:** Performance · **Phase 4** · **Depends on:** Task 1

**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/__tests__/claude-triage.test.ts` (modify)

**Steps:**
1. Write tests: call analyzeFood twice with the SAME currentDate but DIFFERENT currentTime and assert system[0].text is byte-identical (toBe) and contains neither 'Current time' nor 'Today's date is:'; assert the messages array carries a block whose text includes 'Today's date is: 2026-02-15' (and 'Current time: 14:30' when provided) as the LAST content block of a user message; drive analyzeFood through the slow path so runToolLoop fires a 2nd call and assert the 2nd request still carries the image blocks AND a cache_control breakpoint on the user content block immediately after the image+description blocks; when the mocked 2nd response reports cache_read_input_tokens>0 the emitted usage StreamEvent carries cacheReadTokens>0
2. Run npx vitest run "claude claude-triage" (expect fail — date is in system[0].text)
3. Implement in src/lib/claude.ts: add buildDateContextBlock(currentDate,currentTime) returning a {type:'text',text} message block; remove the date/time concatenations at ~933/1271/1649/1914/2206 so system text is date-free; append the date block as the trailing block of the leading user message in all 6 entry points; add a cache_control:{type:'ephemeral'} breakpoint on the last stable user-content block (post-image, pre-date) in analyzeFood + convertMessages image path; reword the tool description 'today's date (provided in system prompt)' (~171) to 'provided in the conversation'
4. Rewrite the now-invalid assertions (claude.test.ts:763/1911 date-in-system) to assert date-in-messages; verify the no-date branch (~1923) still holds against system text; update any claude-triage.test.ts system-date assertions; run npx vitest run "claude claude-triage" + npm run typecheck + npm run lint (expect pass)

**Notes:**
- Stable system prefix is what makes cache_read_input_tokens nonzero — verify via the existing usage StreamEvent/recordUsage path
- Breakpoint budget: system[0] + last tool + image-prefix = 3 (under the max-4 limit); images MUST precede the date block or the image prefix won't cache
- Lands before A3 because clearing tool results invalidates the cached prefix at the clear point

### Task 25: Anthropic Core A3: replace truncateConversation with beta context-management clear_tool_uses (delete fn + tests + all 3 call sites)
**Linear Issue:** [FOO-1095](https://linear.app/lw-claude/issue/FOO-1095) · **Label:** Improvement · **Phase 4** · **Depends on:** Task 1, 24

**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/__tests__/claude-triage.test.ts` (modify)

**Steps:**
1. Write tests: drive conversationalRefine/editAnalysis(via runToolLoop)/triageRefine and assert each request carries betas including 'context-management-2025-06-27' and context_management.edits[0].type==='clear_tool_uses_20250919' with exclude_tools containing 'web_search'; update the @anthropic-ai/sdk vi.mock so MockAnthropic exposes beta={messages:{stream:mockStream}} and assert getClient wiring calls beta.messages.stream; add a 40-message over-threshold conversation to conversationalRefine and assert the request messages length EQUALS the input length (no client-side dropping) and that truncateConversation is no longer exported (remove its describe block)
2. Run npx vitest run "claude claude-triage" (expect fail — code still uses messages.stream + truncateConversation)
3. Implement in src/lib/claude.ts: change createStreamWithRetry (~321) to getClient().beta.messages.stream, widen its streamParams to the beta message-create params type, add a shared CONTEXT_MANAGEMENT const (clear_tool_uses_20250919 + trigger/keep/clear_at_least/exclude_tools:['web_search'] tuned conservatively so the report_nutrition pendingAnalysis loop keeps context) + betas:['context-management-2025-06-27'] applied at the single chokepoint so all 6 entry points benefit; DELETE truncateConversation (762-811), estimateTokenCount (713-760), the 3 truncateConversation call sites (~1631/1950/2372) + their truncation debug logs; keep CLAUDE_MODEL=claude-sonnet-4-6
4. Delete the obsolete truncateConversation test block; run npx vitest run "claude claude-triage claude-retry" + npm run typecheck + npm run lint + npm run build (expect pass, zero warnings)

**Notes:**
- C8 — must delete the function AND its tests AND all 3 call sites, not just swap one
- createStreamWithRetry is the single path all 6 entry points funnel through — confirm the beta stream's finalMessage()/Message type aligns and the Sentry-instrumented client still wraps beta.messages
- clear_at_least must be high enough to make re-caching worthwhile given A2's image-prefix cache

### Task 26: Non-migration review fixes: claude.ts decomposition + role-prompt decoupling, custom-food insert helper, client-date enforcement, shared-food rate-limit, search SQL pushdown
**Linear Issue:** [FOO-1096](https://linear.app/lw-claude/issue/FOO-1096) · **Label:** Technical Debt · **Phase 4** · **Depends on:** Task 1, 7

**Files:**
- `src/lib/claude.ts` (modify)
- `src/lib/claude-prompts.ts` (create)
- `src/lib/claude-tools-schema.ts` (create)
- `src/lib/__tests__/claude.test.ts` (modify)
- `src/lib/food-log.ts` (modify)
- `src/lib/__tests__/food-log.test.ts` (modify)
- `src/lib/date-utils.ts` (modify)
- `src/app/api/analyze-food/route.ts` (modify)
- `src/app/api/chat-food/route.ts` (modify)
- `src/app/api/edit-chat/route.ts` (modify)
- `src/app/api/process-captures/route.ts` (modify)
- `src/app/api/analyze-food/__tests__/route.test.ts` (modify)
- `src/app/api/chat-food/__tests__/route.test.ts` (modify)
- `src/app/api/shared-food/[token]/route.ts` (modify)
- `src/app/api/shared-food/[token]/__tests__/route.test.ts` (modify)

**Steps:**
1. Write tests: characterization test that getAnalysisSystemPrompt/getChatSystemPrompt/getEditSystemPrompt equal today's exported *_SYSTEM_PROMPT (no profile) and `${SYSTEM_PROMPT}\n\n${profile}`+role-instructions (with profile); mapStopReasonToError returns the existing per-label message for model_context_window_exceeded/refusal/max_tokens and null for end_turn/tool_use; the error-wrap helper rethrows ClaudeApiError unchanged, routes AbortError to the abort path, wraps other errors with extractRequestId; toCustomFoodInsertValues stringifies amount/macros, Math.rounds calories, nulls absent tier-1 nutrients, passes through the ?? null defaults; analyze-food + chat-food return 400 VALIDATION_ERROR on missing/invalid clientDate and pass a valid one through; shared-food GET returns 429 RATE_LIMIT_EXCEEDED past the per-user window and 200 on the first request, revokeShareToken nulls shareToken scoped by id+userId; searchFoods builds a where() carrying an ILIKE/array-overlap keyword predicate + a LIMIT while still JS-re-filtering computeMatchRatio>=0.5, getCommonFoods query is row-bounded
2. Run npx vitest run "claude food-log analyze-food chat-food shared-food" (expect fail)
3. Implement: replace the .slice(SYSTEM_PROMPT.length) coupling with standalone ANALYSIS/CHAT/EDIT_ROLE_INSTRUCTIONS constants; extract mapStopReasonToError/yieldUsageAndRecord/wrapStreamErrors and replace the duplicated blocks (preserving every per-site message); move prompt constants to claude-prompts.ts + tool schemas to claude-tools-schema.ts re-exported from claude.ts; extract toCustomFoodInsertValues() and call it from all 3 custom-food writers (spread update-path extras on top); replace the `?? getTodayDate()` fallback in the 4 browser routes with a 400 guard (leave v1/nutrition-goals defaulting to server-today, update getTodayDate JSDoc); add checkRateLimit to shared-food GET + revokeShareToken to food-log.ts; push the keyword ILIKE/array-overlap predicate + LIMIT into searchFoods and bound getCommonFoods
4. Run npx vitest run "claude food-log analyze-food chat-food edit-chat process-captures shared-food" + npm run typecheck (expect pass)

**Notes:**
- Consolidates the standalone non-migration review fixes that are independent of the cutover (and were over-fragmented into 7 drafts); the claude split modules MUST be re-exported from claude.ts (barrel) so import sites are unaffected, and per-site error/log wording must be preserved exactly
- Preserve the HEALTH_DRY_RUN-gated visibility filter (owned by task 7) verbatim when adding the searchFoods pushdown — the SQL predicate must be a superset of the JS matcher
- The shared-food optional shareTokenExpiresAt column is skipped here to avoid an extra schema change; rate-limit + revocation are the required wins

### Task 27: Real-Postgres integration suite: cross-user isolation, deleteUserData admin path, and goal-engine end-to-end test for both user bodies
**Linear Issue:** [FOO-1097](https://linear.app/lw-claude/issue/FOO-1097) · **Label:** Security · **Phase 4** · **Depends on:** Task 4, 9, 19

**Files:**
- `src/lib/__tests__/food-log.integration.test.ts` (create)
- `src/lib/user-data.ts` (create)
- `src/lib/__tests__/user-data.integration.test.ts` (create)
- `src/lib/__tests__/daily-goals.integration.test.ts` (create)
- `vitest.config.ts` (modify)
- `package.json` (modify)
- `MIGRATIONS.md` (modify)

**Steps:**
1. Add a test:integration script / vitest project that runs only *.integration.test.ts against a real integration DATABASE_URL and is excluded from the default fast npm test loop (skip via guard when the env is unset)
2. Write src/lib/__tests__/food-log.integration.test.ts: seed users A and B (each a custom food + log entry) against a fresh migrated Postgres and assert every cross-user call (getCustomFoodById/getFoodLogEntry/getFoodLogEntryDetail/deleteFoodLogEntry/updateFoodLogEntry/toggleFavorite/setShareToken with B on A's ids) returns null/false and leaves A's data intact; write src/lib/__tests__/user-data.integration.test.ts asserting deleteUserData(A) removes ALL of A's rows across every table in one transaction while B is untouched and a mid-delete failure leaves A intact; write src/lib/__tests__/daily-goals.integration.test.ts (C6) seeding a health profile + local weightGoalType + health activity summary for TWO distinct bodies (Lucas + Mariana profiles) and asserting the daily-goals/macro engine produces the correct per-user goal output for each
3. Run the integration suite against a local Dockerized PG (expect fail — deleteUserData missing)
4. Implement deleteUserData(userId) in src/lib/user-data.ts as a db.transaction deleting children-before-parents in FK-safe order (food_log_entries before custom_foods, leaf tables, finally users) scoped by userId; keep FK onDelete NO ACTION and document the rationale + the cascade alternative in MIGRATIONS.md
5. Run the integration suite (expect pass) and confirm npm test still skips it and stays ~5s; run npm run typecheck

**Notes:**
- Folds C6 (goal-engine end-to-end test from the NEW data sources for both user bodies — absent from every draft) with the cross-user isolation suite and the deleteUserData admin path, since all three need the same real-Postgres integration harness
- drizzle node-postgres means pglite is NOT a faithful substitute — use a containerized throwaway PG with the project's real migrations applied; gate strictly on a dedicated integration DATABASE_URL so it never touches prod/dev
- Mariana + Lucas profiles must differ (multi-user design rule) so the engine is exercised across bodies, not tuned to one

- **Migration note:** Test-only: integration suite needs a throwaway Postgres with the project's Drizzle migrations applied; document the integration DATABASE_URL in DEVELOPMENT.md. deleteUserData keeps FK onDelete NO ACTION (no schema change); the cascade alternative is noted but not applied.

### Task 28: Migrate E2E fixtures + 10 specs to health_tokens/HEALTH_DRY_RUN; remove Fitbit from CSP form-action and the docs
**Linear Issue:** [FOO-1098](https://linear.app/lw-claude/issue/FOO-1098) · **Label:** Convention · **Phase 4** · **Depends on:** Task 22, 23

**Files:**
- `e2e/fixtures/db.ts` (modify)
- `e2e/global-setup.ts` (modify)
- `e2e/tests/settings.spec.ts` (modify)
- `e2e/tests/dashboard.spec.ts` (modify)
- `e2e/tests/analyze.spec.ts` (modify)
- `e2e/tests/quick-select.spec.ts` (modify)
- `e2e/tests/refine-chat.spec.ts` (modify)
- `e2e/tests/log-shared.spec.ts` (modify)
- `e2e/tests/goal-anchored-engine.spec.ts` (modify)
- `e2e/tests/empty-states.spec.ts` (modify)
- `e2e/tests/landing.spec.ts` (modify)
- `next.config.ts` (modify)
- `src/lib/__tests__/csp-header.test.ts` (modify)
- `README.md` (modify)
- `DEVELOPMENT.md` (modify)
- `CLAUDE.md` (modify)
- `.env.sample` (modify)

**Steps:**
1. Update src/lib/__tests__/csp-header.test.ts to assert form-action no longer contains https://www.fitbit.com; run npx vitest run "csp-header" (expect fail), then remove https://www.fitbit.com from the CSP form-action in next.config.ts and re-run (expect pass)
2. Migrate e2e/fixtures/db.ts + e2e/global-setup.ts to seed health_tokens (drop fitbit_tokens/fitbit_credentials seeding) and set HEALTH_DRY_RUN; update the 10 affected specs (settings/dashboard/analyze/quick-select/refine-chat/log-shared/goal-anchored-engine/empty-states/landing) for the Connect-Google-Health flow, renamed routes/components, and serving_unit strings
3. Rewrite README.md/DEVELOPMENT.md/CLAUDE.md/.env.sample to Google Health: tagline/logging-target/tech-stack, single shared Google OAuth client + one-click /app/connect-health (remove dev.fitbit.com + /app/setup-fitbit), CLAUDE.md DATABASE table list (fitbit_tokens->health_tokens, drop fitbit_credentials), ENVIRONMENTS dry-run (FITBIT_DRY_RUN->HEALTH_DRY_RUN), the RATE-LIMIT CRITICALITY + api/auth route-convention sections, and add HEALTH_DRY_RUN to .env.sample with a comment noting scopes are configured on the GCP consent screen
4. Run grep -ri 'fitbit' README.md DEVELOPMENT.md CLAUDE.md .env.sample next.config.ts e2e/ (expect zero non-historical matches), then npm run e2e (the lead gate) and npm run lint (expect pass, zero warnings)

**Notes:**
- Folds M6 (CSP form-action) + M7 (E2E fixtures + 10 specs) + the docs sweep — all are the pre-E2E-gate cleanup and touch overlapping config
- Must land before the E2E gate runs (Phase 1.6 of push-to-production / before PR creation)
- No outbound connect-src for health.googleapis.com is needed (REST is server-side, not browser)

- **Migration note:** Docs document HEALTH_DRY_RUN (staging always true, production always false) and that Google Health scopes live on the GCP consent screen, not env. E2E fixtures seed health_tokens.

<!-- ===== Phase 5 ===== -->

### Task 29: LEAD ONLY: run a single npx drizzle-kit generate after all schema edits land
**Linear Issue:** [FOO-1099](https://linear.app/lw-claude/issue/FOO-1099) · **Label:** Technical Debt · **Phase 5** · **Depends on:** Task 5, 6, 7, 8, 9, 26, 27

**Files:**
- `drizzle/` (create)
- `src/db/schema.ts` (modify)

**Steps:**
1. Confirm all schema-editing tasks (5,6,7,8,9 + the shared-food/user-data decisions) are merged and src/db/schema.ts compiles via npm run typecheck
2. Run npx drizzle-kit generate ONCE (it diffs schema.ts against the previous snapshot locally; no live DB needed) — never hand-write the migration SQL or snapshot
3. Inspect the generated SQL: verify the fitbit_tokens->health_tokens RENAME (not drop+create) and the column renames; if drizzle emits drop+create, the lead pre-creates the rename via a separate reviewed step rather than hand-tuning the journal; confirm the integer->text unit_id change carries the USING cast + legacy-ID backfill and the index/CHECK/partial-unique DDL match current column names
4. Run npm run build + npm test to confirm the generated migration + snapshot are consistent

**Notes:**
- Single generate after ALL schema edits (rename, drops, column type changes, new columns, indexes, checks) — not per-task
- Workers must never hand-write generated files (past corruption from a hand-written snapshot in PR #29)
- The actual production migration run + row-clear + Railway var changes are humanDeployNotes executed at release, not in this task

- **Migration note:** Produces the consolidated Drizzle migration for the full schema delta (token rename, credentials drop, food_log/custom_foods column changes, unit_id integer->text + backfill, users.weightGoalType, indexes, daily_calorie_goals CHECK, partial unique index). Lead applies it against production during the release per humanDeployNotes.

### Task 30: LEAD ONLY (agent via Railway MCP + DB): apply release env + token-clear deploy steps — zero human action
**Linear Issue:** [FOO-1100](https://linear.app/lw-claude/issue/FOO-1100) · **Label:** Technical Debt · **Phase 5** · **Depends on:** Task 29

**Files:**
- `MIGRATIONS.md` (modify)

**Steps:**
1. At the staging deploy, the LEAD sets HEALTH_DRY_RUN=true on staging AND HEALTH_DRY_RUN=false on production via the Railway MCP (set_variables) — the standing invariant: staging always true (writes skipped), production always false (writes live). Set staging=true before/with the deploy so staging never goes live.
2. Via Railway MCP, remove the orphaned vars FITBIT_DRY_RUN (staging), FITBIT_CLIENT_ID and FITBIT_CLIENT_SECRET (both staging + production). Safe to remove FITBIT_DRY_RUN only AFTER the migrated code (which reads HEALTH_DRY_RUN, not FITBIT_DRY_RUN) is live — never before, or pre-migration staging would go live.
3. Apply the data-only token clear DELETE FROM health_tokens against staging, then production at release (per the push-to-production data-SQL policy — agent-applied, never deferred to the user), so Lucas + Mariana hit the reconnect path and re-consent once.
4. Verify: GET /api/health reports healthMode=Dry Run on staging; the login → /app/connect-health → google-health round-trip succeeds; production health unaffected. Log the env + token-clear actions in MIGRATIONS.md.

**Notes:**
- Executed by the LEAD (Railway MCP + DB access), not a worker — workers have no MCP. This replaces what were previously framed as manual deploy notes; NO human action is required.
- GCP precondition (enable Google Health API + add the 4 scopes) is already DONE — verified by the user.
- Production application of the Drizzle migration (Task 29) + this token clear happens via the push-to-production release flow, which already runs data SQL agent-side.

- **Migration note:** Release/deploy ops (agent-applied, no human): Railway env — HEALTH_DRY_RUN=true on staging, HEALTH_DRY_RUN=false on production (standing invariant); drop FITBIT_DRY_RUN/FITBIT_CLIENT_ID/FITBIT_CLIENT_SECRET; + DELETE FROM health_tokens. Only drop FITBIT_DRY_RUN after the migrated code is live.

## Deploy Steps — AGENT-EXECUTED, no human action

**Precondition (GCP enable Google Health API + add the 4 scopes): VERIFIED DONE by the user.** No remaining human action.

The release env + token-clear steps are performed by the LEAD agent (Railway MCP + DB) in **Task 30** — not by a human:
- Railway (staging): set HEALTH_DRY_RUN=true; remove FITBIT_DRY_RUN, FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET (0 code usages). Production leaves HEALTH_DRY_RUN unset for live writes.
- DB one-time (lead, at deploy): after the fitbit_tokens->health_tokens rename, clear the table (DELETE FROM health_tokens;) so both Lucas and Mariana re-consent once via login -> /app/connect-health -> Google Health. They will see healthConnected=false until they reconnect.
- DB (lead, drizzle-kit generate + reviewed SQL): fitbit_tokens RENAME TO health_tokens (+ column rename fitbit_user_id->health_user_id, preserve FK/unique); DROP fitbit_credentials; food_log_entries DROP fitbit_log_id + ADD health_log_id text; custom_foods DROP fitbit_food_id; custom_foods/food_log_entries unit_id integer->text with USING cast + legacy-ID backfill (147->g,226->oz,91->cup,349->tbsp,364->tsp,209->ml,311->slice,304->serving, unknown->serving) and saved_analyses.food_analysis JSONB unit_id remap; ADD users.weightGoalType; new indexes (CREATE INDEX CONCURRENTLY on a live table); daily_calorie_goals activity_level CHECK; partial unique index on food_log_entries(user_id, health_log_id) WHERE NOT NULL.
- GCP Google Health API enablement + consent-screen scope configuration is handled separately (out of scope for these tasks).
- Staging QA verifies the inferred Google Health API field paths against the real API; correct the isolated body-builders if any field path differs.

## Post-Implementation Checklist
1. Run `bug-hunter` agent — review changes for bugs
2. Run `verifier` agent (no args) — unit tests + lint + build, zero warnings
3. Run `verifier "e2e"` agent — E2E suite (staging-testable gate)
4. LEAD: Task 29 `drizzle-kit generate`, then the release/deploy notes above

---

## Plan Summary

**Objective:** Hard-cutover the app's nutrition/profile/weight/activity integration from Fitbit to Google Health (single absolute switch, no provider flags), fix the review-surfaced bugs, and modernize the Anthropic Core (SDK ^0.100, prompt-cache, server-side context editing).
**Approach:** Phase the work foundation-first: extract shared HTTP helpers and bump the SDK before any deletes (Phase 0); land the entire data model, the single-owner src/types/index.ts rename, the serving-unit re-model, and the session contract (Phase 1); stand up the Google Health OAuth connect flow and the google-health transport/rate-limit cores (Phase 2); rewire all write and read paths plus the renamed routes/caches (Phase 3); migrate UI/hooks, the Claude cache/context-editing changes, docs, the non-migration bug-fixes, and the E2E/goal-engine tests (Phase 4); then a single lead-only drizzle-kit generate (Phase 5). Every task is test-first with colocated __tests__/ and concrete assertions; Google Health request/response body shapes are isolated in body-builder helpers and verified against the real API during staging QA.
**Linear Issues:** FOO-1071–FOO-1100 (30 issues, Todo)
**Scope:** 30 tasks across 6 phases, ~144 files, 62+ test files
**Key Decisions:**
- Single absolute cutover: delete ALL Fitbit code (fitbit.ts, fitbit-tokens.ts, fitbit-credentials.ts, fitbit-cache.ts, fitbit-rate-limit.ts, fitbit-health.ts, setup-fitbit, fitbit-setup-form, fitbit-setup-guard, fitbit-status-banner, fitbit-profile-card) — no shims, no provider flag, no deferred stage.
- Per-user Fitbit credentials are eliminated: Google Health reuses the single shared Google OAuth client; fitbit_credentials table + module dropped.
- ONE Phase-1 task owns every src/types/index.ts ErrorCode/session/FoodLogResponse/serving-unit/meal-type rename; all other tasks depend on it (resolves C2 worktree conflict).
- Extract parseErrorBody/sanitizeErrorBody/jsonWithTimeout/REQUEST_TIMEOUT_MS to src/lib/http.ts BEFORE deleting fitbit.ts so auth.ts and google-health.ts have a provider-neutral home (M1).
- Food visibility filter is re-based off food_log_entries.health_log_id (a remote-log handle), NOT the dropped custom_foods.fitbit_food_id, gated on HEALTH_DRY_RUN (C1/M5).
- Fitbit numeric serving-unit IDs become an internal ServingUnit string enum ('g'|'oz'|'cup'|'tbsp'|'tsp'|'ml'|'slice'|'serving'); the Claude tool emits serving_unit; a LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT map backfills existing rows.
- Google Health nutrition logs are anonymous single-create (collapse Fitbit createFood+logFood into one createNutritionLog; batchDelete replaces deleteFoodLog); edit is always delete-old+create-new, matching the existing route structure.
- Weight-goal (LOSE/MAINTAIN/GAIN) has no Google Health equivalent — degrade to a local nullable users.weightGoalType column (display-only consumer); delete getFitbitWeightGoal + its cache.
- Anthropic Core: keep model claude-sonnet-4-6; move volatile date/time into the message stream so the system prefix caches; extend cache_control over image blocks; replace truncateConversation with beta context-management clear_tool_uses (delete fn + tests + all 3 call sites).
- drizzle-kit generate is ONE lead-only task after ALL schema edits land; workers never hand-write migrations or snapshots.
- Release env/DB steps are AGENT-executed by the lead via Railway MCP + DB (Task 30) — set HEALTH_DRY_RUN on staging, drop orphaned FITBIT_* vars, clear health_tokens. Zero human action; GCP enablement already verified done.
- Dry-run invariant matches the current Fitbit architecture exactly: HEALTH_DRY_RUN gates ONLY the nutrition write/delete (createNutritionLog/deleteNutritionLogs) + the visibility filter; OAuth (all 4 scopes), token refresh, and profile/weight/activity reads are REAL on staging. Staging always HEALTH_DRY_RUN=true, production always false. The actual nutrition write/delete is the only surface first exercised in production.
**Risks:**
- Google Health request/response BODY SHAPES (nutrition-log create/batchDelete, users/me/identity, health_metrics weight query, activity dailyRollUp, profile sex/height/DOB) are inferred from docs, not a live API. Body-builders are isolated; unit tests mock fetch; correctness is verified during staging QA (C4).
- The fitbitFoodId visibility-filter re-base changes which foods appear in history/search in production — intended under Postgres-as-source-of-truth but a visible behavior change to call out in the PR (C1).
- The unit_id integer->text ALTER on populated custom_foods/food_log_entries needs a USING cast + legacy-ID backfill; a wrong USING corrupts every portion label — verify against a DB backup before release.
- Google profile sex/height/DOB enum mapping must default unknown sex to NA (never throw) or daily-goals compute breaks for both users.
- Migrating createStreamWithRetry from messages.stream to beta.messages.stream touches the single path all 6 Claude entry points funnel through; the Sentry-instrumented client must still wrap beta.messages.
- context-management clear_tool_uses interacts with prompt caching — clearing tool results invalidates the cached prefix at the clear point, so clear_at_least must be high enough and image-prefix caching (A2) lands before A3.
- src/types/index.ts and src/lib/session.ts are foundation files imported by nearly every route; the field renames break the build until all consumers land in the same merge — lead runs full npm test post-merge.
- Forcing both users to re-consent means healthConnected=false until they reconnect — expected but must be communicated.

---

## Iteration 1: Phase 0 — Anthropic SDK bump + provider-neutral HTTP extraction

**Date:** 2026-05-31
**Status:** PARTIAL — 27 tasks remaining (Phases 1–5)
**Method:** single-agent

### Summary
Completed all of Phase 0 (foundation-before-deletes): bumped `@anthropic-ai/sdk` to ^0.100.1, extracted the shared HTTP helpers into a provider-neutral `src/lib/http.ts`, and widened `exchangeGoogleCode` to surface `refresh_token`/`expires_in`/`scope` for the upcoming health-connect callback. The tree is fully green (typecheck 0 errors, all touched suites pass, build + lint clean). Stopped at the Phase 0/1 boundary — Phase 1 renames the single-owner `src/types/index.ts`, which breaks compilation across every consumer until Tasks 5–23 land, so it cannot be partially completed; the next run resumes at Task 4.

### Completed Tasks
- **Task 1: Bump @anthropic-ai/sdk ^0.78 → ^0.100.1** (FOO-1071) — dependency upgraded + `npm install`; the anticipated type fallout did not materialize (typecheck passed with zero source edits to claude.ts/claude-usage.ts); `vitest "claude"` = 292 passing (= baseline), build + lint clean.
- **Task 2: Extract parseErrorBody/sanitizeErrorBody/jsonWithTimeout → src/lib/http.ts** (FOO-1072) — moved the 3 helpers + `REQUEST_TIMEOUT_MS` verbatim into the new `src/lib/http.ts` with a colocated test; `fitbit.ts` now imports + re-exports them (so `fitbit.test.ts` importers stay green until fitbit.ts is deleted in Phase 3); `auth.ts` repointed to `@/lib/http`.
- **Task 3: Widen exchangeGoogleCode → {access_token, refresh_token?, expires_in?, scope?}** (FOO-1073) — added the `ExchangeGoogleCodeResult` interface, parse the optional fields with type guards (undefined when omitted), LOGIN callers (read only `access_token`) untouched; 3 new auth tests.

### Issues Encountered
- The repeated "blank/duplicated" tool outputs earlier in the run were a transient output-delivery lag, not failures — every command had actually executed. Mitigated by routing long commands to a file via `run_in_background` and reading the file on the completion notification.
- Initial Task-2 test draft asserted incorrect helper behavior (assumed Bearer-redaction); corrected to match the verbatim implementations (`sanitizeErrorBody` strips HTML + truncates to 500; `parseErrorBody` falls back to `"unable to read body"`; `jsonWithTimeout` throws `"Response body read timed out"`).
- A Task-3 test compared a `URLSearchParams` body as a string; fixed by `String(...)`-coercing before asserting `.toContain`.

### Tasks Remaining
Resume at **Phase 1, Task 4** (FOO-1074 — single-owner `src/types/index.ts` rename), then Tasks 5–10 (rest of Phase 1), then Phases 2–5 (Tasks 11–30). Phase 1 must be completed as one atomic unit (the types rename cascades across all consumers + schema.ts) before typecheck returns to green.

### Verification
- `npm run typecheck` — 0 errors
- `npx vitest run http` — pass (8); `npx vitest run auth` — pass (24); `npx vitest run fitbit` — pass (130); `npx vitest run "claude"` — pass (292)
- `npm run build` — success; `npm run lint` — zero warnings
- (Task 1 full gate run earlier: tests + build + lint all exit 0)

### Files Changed
- `package.json` (modify — SDK ^0.100.1)
- `package-lock.json` (modify)
- `src/lib/http.ts` (create)
- `src/lib/__tests__/http.test.ts` (create)
- `src/lib/fitbit.ts` (modify — helpers moved out, re-exported from @/lib/http)
- `src/lib/auth.ts` (modify — import @/lib/http; widen exchangeGoogleCode)
- `src/lib/__tests__/auth.test.ts` (modify — 3 new exchangeGoogleCode tests)

---

## Iteration 2: Phase 1 — data model + single-owner type rename + session contract

**Date:** 2026-05-31
**Status:** PARTIAL — 20 tasks remaining (Phases 2–5, Tasks 11–30)
**Method:** single-agent

### Summary
Completed all of **Phase 1 (Tasks 4–10)** — the foundational data-model + type cutover. Task 4 owns the single rename of `src/types/index.ts`; Tasks 5–9 rewrite `src/db/schema.ts` (token table rename, credentials-table drop, food-log column changes, indexes/checks, `weightGoalType`); Task 10 rewires the session contract. Every Phase-1 task was implemented test-first; **all 251 Phase-1 unit tests pass** and **all seven Phase-1 source files typecheck clean** (0 errors in `types/index.ts`, `db/schema.ts`, `health-tokens.ts`, `food-log.ts`, `food-matching.ts`, `users.ts`, `session.ts`). bug-hunter reviewed the diff and found 0 actionable bugs.

**Expected red global typecheck (≈384 errors):** The single-owner `types/index.ts` rename cascades across every consumer that is migrated in later phases (`fitbit*.ts`, `claude.ts`, `daily-goals.ts`, all `src/app/api/**` routes, `src/components/**`, hooks). This is the documented inherent property of this atomic cutover (Iteration 1 flagged it: "breaks compilation across every consumer until Tasks 5–23 land"). The full build/verifier/E2E gate is therefore deferred to the end of the migration (the plan's Post-Implementation Checklist + plan-review-implementation), not run mid-cutover. Verification this iteration was per-task via `npx vitest run` (Vitest compiles per-file via esbuild, independent of the project-wide `tsc`).

### Completed Tasks
- **Task 4 (FOO-1074):** Single-owner `src/types/index.ts` rewrite — `FITBIT_UNITS`/`getUnitById`/`FitbitUnitKey` → `ServingUnit` string enum + `SERVING_UNITS` + `coerceServingUnit` + `LEGACY_FITBIT_UNIT_ID_TO_SERVING_UNIT`; `getUnitLabel(ServingUnit|string, amount)`; retyped `unit_id`/`unitId` to `ServingUnit` on `FoodAnalysis`/`CommonFood`/`FoodLogHistoryEntry`/`FoodMatch`/`FoodLogEntryDetail`/`MealEntry`; `fitbitConnected`→`healthConnected`, dropped `hasFitbitCredentials`; `ErrorCode` FITBIT_*→HEALTH_* (dropped `FITBIT_CREDENTIALS_MISSING`); `FoodLogResponse.fitbitLogId`(number)→`healthLogId`(string), dropped `fitbitFoodId`; `FitbitProfile(Data)`→`HealthProfile(Data)`, `FitbitWeightLog`→`HealthWeightLog`, `FitbitHealthStatus`→`HealthConnectionStatus` (dropped `needs_setup`), `FITBIT_MEAL_TYPE_LABELS`→`MEAL_TYPE_LABELS`, `FitbitMealType`→`MealType`; removed `FitbitWeightGoal`. 19 tests.
- **Task 5 (FOO-1075):** `fitbit_tokens`→`health_tokens` (`fitbit_user_id`→`health_user_id`); ported the store to `src/lib/health-tokens.ts` (`getHealthTokens`/`upsertHealthTokens`/`deleteHealthTokens`, `HealthTokenRow`); deleted `fitbit-tokens.ts` + test. 10 tests.
- **Task 6 (FOO-1076):** Dropped `fitbit_credentials` table; deleted `src/lib/fitbit-credentials.ts` + test.
- **Task 7 (FOO-1077):** `food_log_entries.fitbit_log_id`(bigint)→`health_log_id`(text), dropped `custom_foods.fitbit_food_id`, **`unit_id` integer→text on both tables** (required for the `ServingUnit` types + the migration's USING-cast backfill); rewired `food-log.ts` + `food-matching.ts` (every `fitbitLogId`→`healthLogId` string, removed all `fitbitFoodId`, mappers wrap unit reads in `coerceServingUnit`); re-based the visibility/DRY-RUN filter from `custom_foods.fitbit_food_id` to `food_log_entries.health_log_id` gated on `HEALTH_DRY_RUN` across `getCommonFoods`/`getRecentFoods`/`searchFoods`/`findMatchingFoods`; renamed all `FITBIT_DRY_RUN`→`HEALTH_DRY_RUN`. 161 tests (food-log + food-matching).
- **Task 8 (FOO-1078):** Added indexes `food_log_entries_user_date_idx`, `food_log_entries_custom_food_idx`, `custom_foods_user_idx`; `daily_calorie_goals_activity_level_chk` CHECK; partial unique index `food_log_entries_user_health_log_uniq` on `(user_id, health_log_id) WHERE health_log_id IS NOT NULL`.
- **Task 9 (FOO-1079):** Added nullable `users.weight_goal_type` + CHECK (`LOSE`/`MAINTAIN`/`GAIN`); `getWeightGoalType`/`setWeightGoalType` in `src/lib/users.ts` (the existing settings module — the plan's notional `user-settings.ts`).
- **Task 10 (FOO-1080):** `session.ts` derives `healthConnected` from `getHealthTokens`; dropped `hasFitbitCredentials`; `validateSession({requireHealth})` → 400 `HEALTH_NOT_CONNECTED` (collapsed the two-tier fitbit check).

### Interpretations / decisions (documented per Autonomous-Execution rules)
- **Single-owner completeness:** the plan's Task-4 step-3 enumeration omitted the `fitbitLogId`→`healthLogId` rename and `fitbitFoodId` removal on the *data interfaces* (`FoodLogHistoryEntry`/`MealEntry`/`FoodLogEntryDetail`/`CommonFood`/`FoodMatch`), but those tasks "must not edit `types/index.ts`" (C2). Resolved by making Task 4 reflect the full end-state shape so consumers cascade — the only internally consistent reading.
- **`unit_id` column type:** no task explicitly assigned the `integer`→`text` schema change, but the `ServingUnit` string types + the deploy notes' USING-cast backfill + Task 29's `drizzle-kit generate` all require it. Assigned to Task 7 (the schema + food-log data task) as the natural owner.
- **`HealthConnectionStatus` dropped `needs_setup`** and **`FitbitWeightGoal` removed** now (end-state) even though their last consumers (`fitbit-health.ts`, `fitbit.ts`/`fitbit-cache.ts`) aren't deleted until Phase 3 — consistent with the cascade; those files are already red and are deleted in Tasks 18/20.
- **Module mapping:** plan's `user-settings.ts` = existing `src/lib/users.ts`; weight-goal helpers added there.
- **Test-fixture transform:** the visibility filter is mocked in unit tests (WHERE isn't executed), so the `HEALTH_DRY_RUN` dry-run tests assert mapping/inclusion (renamed away from the dead `fitbitFoodId` assertions); numeric `unit_id` fixtures coerce correctly via `coerceServingUnit`.

### Issues Encountered
- The food-log test suite (~3000 lines) required a bulk mechanical transform (`FITBIT_DRY_RUN`→`HEALTH_DRY_RUN`, `fitbitLogId`→`healthLogId` with number→string, helper-default unit strings) plus ~15 targeted semantic edits (removed obsolete `fitbitFoodId` insert-value/output assertions, deleted the bigint-range and "uses provided fitbitFoodId" tests). Done via a Node regex pass + hand edits; all 141 food-log tests pass.

### Tasks Remaining
Resume at **Phase 2, Task 11** (FOO-1081 — `buildGoogleHealthAuthUrl`/`getGoogleHealthIdentity`/email_verified gate), then the rest of Phase 2 (Tasks 12–15: google-health initiation route, callback branching, rate-limit core, google-health transport core), Phase 3 (Tasks 16–21: nutrition write/delete + read migration, route rewires, fitbit.ts deletion, health-cache, profile/v1 routes, Claude serving_unit schema), Phase 4 (Tasks 22–28: hook/component cutover, UI connect flow, Anthropic A2/A3, non-migration fixes, integration suite, E2E/docs), Phase 5 (Tasks 29–30: lead-only `drizzle-kit generate` + release env/token-clear). The global typecheck returns to green around Task 23 (when the last UI/route/claude consumers land); the full verifier + E2E gate runs after Phase 4.

### Verification
- Phase-1 suites (all green): `types/__tests__/index` (19), `db/__tests__/schema` (33), `health-tokens` (10), `food-log` (141), `food-matching` (20), `users` (12), `session` (15) — **251 tests pass**.
- `npm run typecheck` — **intentionally red (~384 errors), all in unmigrated Phase 2–4 consumers**; the 7 Phase-1 source files are typecheck-clean (verified by filtering tsc output to those paths → empty).
- bug-hunter (Sonnet) reviewed the full Phase-1 diff — **0 actionable bugs** (one redundant-but-harmless dry-run guard noted, kept for parity with the original Fitbit code).
- Full build/lint/E2E **deferred** to migration end (structurally impossible mid-cutover; runs in the Post-Implementation Checklist / plan-review-implementation).

### Files Changed
- `src/types/index.ts` (modify), `src/types/__tests__/index.test.ts` (modify)
- `src/db/schema.ts` (modify — health_tokens rename, fitbit_credentials drop, food_log/custom_foods columns, unit_id→text, indexes/checks, weightGoalType), `src/db/__tests__/schema.test.ts` (modify)
- `src/lib/health-tokens.ts` (create), `src/lib/__tests__/health-tokens.test.ts` (create)
- `src/lib/fitbit-tokens.ts` (delete), `src/lib/__tests__/fitbit-tokens.test.ts` (delete)
- `src/lib/fitbit-credentials.ts` (delete), `src/lib/__tests__/fitbit-credentials.test.ts` (delete)
- `src/lib/food-log.ts` (modify), `src/lib/__tests__/food-log.test.ts` (modify)
- `src/lib/food-matching.ts` (modify), `src/lib/__tests__/food-matching.test.ts` (modify)
- `src/lib/users.ts` (modify — weightGoalType helpers), `src/lib/__tests__/users.test.ts` (modify)
- `src/lib/session.ts` (modify), `src/lib/__tests__/session.test.ts` (modify)
- `MIGRATIONS.md` (modify — Tasks 4–10 migration notes)

---

## Iteration 3: Phase 2 — Google Health OAuth connect flow + transport/rate-limit cores

**Date:** 2026-05-31
**Status:** PARTIAL — 15 tasks remaining (Phases 3–5, Tasks 16–30)
**Method:** Agent team (2 workers, worktree-isolated)

### Summary
Completed all of **Phase 2 (Tasks 11–15)** — the Google Health OAuth connect flow plus the google-health transport + rate-limit cores. Two independent work units ran in parallel: **worker-1** (auth/OAuth: Tasks 11–13) and **worker-2** (transport: Tasks 14–15). No file overlap, both merges clean (worker-2 fast-forward, worker-1 ort merge). All **216 Phase-2 unit tests pass** (108 across the 5 directly-touched files; full Phase-2 suite incl. rate-limit/transport). bug-hunter found **1 HIGH bug** (naked `upsertHealthTokens` in the health-connect callback branch) — fixed by the lead with a typed `HEALTH_TOKEN_SAVE_FAILED` 500 + a regression test.

**Expected red global typecheck (385 errors):** unchanged in nature from Iteration 2 — all in unmigrated Phase 3–4 Fitbit consumers (`fitbit.ts`, `fitbit-cache.ts`, `claude.ts`, components, old `/api/auth/fitbit/*` + `/api/fitbit/*` routes). Deleting `fitbit-rate-limit.ts` (Task 14) added a couple of new `fitbit.ts` import errors — expected (`fitbit.ts` is deleted in Task 18). The Phase-2 merged source files are themselves typecheck-clean (filtered `tsc` output for them → empty). Full build/verifier/E2E remain deferred to migration end.

### Tasks Completed This Iteration
- **Task 11 (FOO-1081):** Added `GOOGLE_HEALTH_SCOPES` (4 exact full URLs), `buildGoogleHealthAuthUrl` (mirrors login builder, `access_type=offline`+`prompt=consent`), `getGoogleHealthIdentity` (`health.googleapis.com/v4/users/me/identity`, Bearer, timeout+AbortController, logs `google_health_identity_fetch_failed`), and `emailVerified` parsing on `getGoogleProfile` (boolean `true` OR string `'true'` → true, else false, no throw). (worker-1)
- **Task 12 (FOO-1082):** Created `/api/auth/google-health/route.ts` (POST+GET → `initiate()`): `getSession()`+`validateSession()`, state `{nonce, flow:'health-connect'}` into `rawSession.oauthState`, reuses `buildUrl('/api/auth/google/callback')`, 302-redirects. (worker-1)
- **Task 13 (FOO-1083):** Added `exchangeGoogleHealthCode` (validates `refresh_token` present, throws typed error if absent); rewrote the callback to branch on `flow==='health-connect'` (require `getSessionById` DB session, exchange + `getGoogleHealthIdentity` + `upsertHealthTokens`, 302 `/app`, no `createSession`) vs login (email_verified gate → 403 `AUTH_INVALID_EMAIL` before allowlist; post-login redirect to `/app` when health tokens exist else `/app/setup-health`); removed `fitbit-tokens`/`fitbit-credentials` imports. (worker-1)
- **Task 14 (FOO-1084):** Created `src/lib/google-health-rate-limit.ts` (per-user Map, injected logger, recent-429 `cooldownUntil` model; exports `HealthCallCriticality`, `assertRateLimitAllowed`, `recordRateLimitHeaders`, `getRateLimitSnapshot`, `_resetForTests`; never blocks `critical`); deleted `fitbit-rate-limit.ts` + test. (worker-2)
- **Task 15 (FOO-1085):** Created `src/lib/google-health.ts` (`fetchWithRetry`: 401→`HEALTH_TOKEN_INVALID`, 403→`HEALTH_SCOPE_MISSING`, 429 single-retry then `HEALTH_RATE_LIMIT`, 5xx backoff, `DEADLINE_MS` budget→`HEALTH_TIMEOUT`; `refreshGoogleHealthToken` preserves the input refresh token; **race-safe `ensureFreshToken`** registers the in-flight promise BEFORE the refresh decision and re-reads the row inside the deduped IIFE, closing the read-then-check window present in `fitbit.ts`; upsert failure → `HEALTH_TOKEN_SAVE_FAILED`). Concurrency test: 5 concurrent calls → token endpoint hit exactly once. (worker-2)

### Tasks Remaining
Resume at **Phase 3, Task 16** (FOO-1086 — `createNutritionLog`/`deleteNutritionLogs` on google-health.ts with `HEALTH_DRY_RUN`), then Tasks 17–21 (write-route rewires, fitbit.ts deletion + reads, health-cache rename, profile/v1 routes, Claude serving_unit schema), Phase 4 (Tasks 22–28), Phase 5 (Tasks 29–30: lead-only `drizzle-kit generate` + release env/token-clear). Global typecheck returns to green around Task 23; full verifier + E2E gate runs after Phase 4.

### Files Modified
- `src/lib/auth.ts` (modify), `src/lib/__tests__/auth.test.ts` (modify — 15 new tests, 38 total)
- `src/app/api/auth/google-health/route.ts` (create), `src/app/api/auth/google-health/__tests__/route.test.ts` (create — 10 tests)
- `src/app/api/auth/google/callback/route.ts` (modify — flow-branching rewrite + lead's upsert try/catch), `src/app/api/auth/google/callback/__tests__/route.test.ts` (modify — 29 tests incl. lead's HEALTH_TOKEN_SAVE_FAILED regression test)
- `src/lib/google-health-rate-limit.ts` (create), `src/lib/__tests__/google-health-rate-limit.test.ts` (create — 13 tests)
- `src/lib/google-health.ts` (create), `src/lib/__tests__/google-health.test.ts` (create — 19 tests)
- `src/lib/fitbit-rate-limit.ts` (delete), `src/lib/__tests__/fitbit-rate-limit.test.ts` (delete)

### Linear Updates
- FOO-1081 → Todo → In Progress → Review
- FOO-1082 → Todo → In Progress → Review
- FOO-1083 → Todo → In Progress → Review
- FOO-1084 → Todo → In Progress → Review
- FOO-1085 → Todo → In Progress → Review

### Pre-commit Verification
- bug-hunter (Sonnet): Found 1 HIGH bug — naked `upsertHealthTokens` in the health-connect callback branch (DB failure after token exchange → unstructured 500). Fixed by the lead: wrapped in try/catch returning `errorResponse("HEALTH_TOKEN_SAVE_FAILED", …, 500)` + added a regression test. Verified-clean: ensureFreshToken dedup, AbortController/setTimeout cleanup, OAuth state/nonce, email_verified gate, returnTo open-redirect guard, token-logging.
- verifier (full build/lint/E2E): **deferred** to migration end (structurally impossible mid-cutover). Per-file verification via `npx vitest run`: all 108 directly-touched Phase-2 tests pass; `npm run typecheck` red (385) only in unmigrated consumers, 0 in Phase-2 files.

### Work Partition
- Worker 1: Tasks 11, 12, 13 (auth/OAuth domain — `auth.ts`, google-health initiation route, callback branching)
- Worker 2: Tasks 14, 15 (transport domain — google-health rate-limit + transport cores)

### Merge Summary
- Worker 2 (foundation/service layer): fast-forward, no conflicts
- Worker 1 (auth + routes): ort merge, no conflicts
- Lead post-merge: bug fix in `callback/route.ts` (HIGH bug from bug-hunter) + regression test

### Continuation Status
Phase boundary reached (workers-mode checkpoint). Phase 2 complete and merged; resume at Phase 3, Task 16.
