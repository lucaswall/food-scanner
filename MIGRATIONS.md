# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## ⚠️ RELEASE RUNBOOK — Google Health migration (READ FIRST)

This release promotes the entire Fitbit→Google Health cutover. **Classification: `Simple`** (table/column renames, an integer→text type change with a value backfill, plus JSONB data remapping) — `push-to-production` must build a **manual migration script with Drizzle journal inserts** (skill Phase 3), NOT rely on Drizzle's generated SQL alone.

**Drizzle migration file:** `drizzle/0027_google_health_migration.sql` is generated and committed (Task 29 — done). It is **correct for a fresh/empty DB** (CI, E2E, local) — the app's startup-migrate builds the full current schema by running `0001…0027`, verified green by the unit, integration (20), and E2E (135) suites.

**🔴 What WILL FAIL if `0027` is applied verbatim to PRODUCTION (populated tables) — the manual migration MUST override these:**
1. ~~**`unit_id` integer→text has NO `USING` clause**~~ **RESOLVED (FOO-1117):** `0027` lines 17–18 now carry the full `ALTER COLUMN "unit_id" SET DATA TYPE text USING (CASE … END)` legacy-ID→`ServingUnit` backfill (147→'g', 226→'oz', 91→'cup', 349→'tbsp', 364→'tsp', 209→'ml', 311→'slice', 304→'serving', ELSE 'serving') for BOTH `custom_foods` and `food_log_entries`. The committed file is now correct for populated tables too — the value backfill no longer needs a separate manual override. A **startup boot guard** (`assertUnitIdConverted` in `src/db/migrate.ts`) FATAL-fails the boot if 0027 is journaled but either `unit_id` column is still `integer`, so a skipped/botched conversion can never run silently.
2. ~~**`saved_analyses.food_analysis` JSONB carries an embedded numeric `unit_id`** that `0027` does not touch.~~ **RESOLVED (FOO-1118):** `0027` now includes a `jsonb_set` UPDATE that remaps `food_analysis.unit_id` for `saved_analyses` rows whose value is a JSON number (same legacy map), normalising the stored values to `ServingUnit` strings. Additionally, the read boundaries (`getSavedAnalysis`, `GET /api/shared-food/[token]`) defensively `coerceServingUnit` so any residual numeric/numeric-string value never reaches `find-matches`/`log-food` (which 400 on a non-`ServingUnit`). No manual override needed — the remap is in the committed file.
3. **`0027` emits non-`CONCURRENT` `CREATE INDEX`** (lines 22–25). On live tables, substitute `CREATE INDEX CONCURRENTLY` to avoid long write locks.
4. **`0027` does `DROP TABLE fitbit_tokens`/`fitbit_credentials`** — intended (tokens are cleared at release anyway; per-user credentials are obsolete). `health_tokens` is created empty, which is the desired end state (forces re-consent). No rename needed; the end state is an empty `health_tokens`.

**Manual migration = `0027`'s DDL with items 1–3 corrected, then journal-insert `0027` so startup-migrate skips the naive file:**
- `hash` = `shasum -a 256 drizzle/0027_google_health_migration.sql | cut -d' ' -f1`
- `created_at` = the `when` value for the `0027` entry in `drizzle/meta/_journal.json` (epoch ms)
- Insert into `"drizzle"."__drizzle_migrations"` (verify internals per skill Phase 1.4).

**Data-only op (run after deploy/migrate):** `DELETE FROM health_tokens;` is unnecessary if the table is created fresh by the manual migration, but harmless — both Lucas and Mariana re-consent once via login → `/app/connect-health`.

**Drizzle migration files:** `0027` (consolidated cutover, above) **and `0028_cold_white_queen.sql`** (`users.sex` nullable column + CHECK — FOO-1116; safe nullable add on populated tables). Both are committed; the manual migration must journal-insert BOTH so startup-migrate skips them.

**Railway env changes (applied via the Railway CLI — `railway variables`).** Declared per-environment below for `push-to-production` Phase 2.2b to capture + apply (Phase 5.9). The Railway *MCP* tools are read-only, but the CLI writes fine through Bash (`railway status` → `railway environment <name>` → `railway variables --set "KEY=VALUE"`; verify the unset syntax via `railway variables --help`).

**Critical ordering — `FITBIT_*` (incl. `FITBIT_CLIENT_ID`/`FITBIT_CLIENT_SECRET`) are used by the CURRENT pre-migration code and NOT by the migrated code.** Never remove any `FITBIT_*` from an environment until the migrated code is LIVE there, or the running pre-migration code breaks.

- **PRODUCTION** (`push-to-production` §5.9 runs AFTER the deploy is verified, i.e. migrated code live):
  - `set HEALTH_DRY_RUN=false` (explicit; unset already defaults to live since the code checks `=== "true"`)
  - `unset FITBIT_CLIENT_ID`, `unset FITBIT_CLIENT_SECRET` — safe only here, post-deploy (migrated code no longer uses them).
- **STAGING** (on the staging deploy — NOT `push-to-production`):
  - `set HEALTH_DRY_RUN=true` **before** the migrated code reaches staging (else staging does LIVE Google Health writes).
  - **after** the migrated code is live on staging: `unset FITBIT_DRY_RUN`, `unset FITBIT_CLIENT_ID`, `unset FITBIT_CLIENT_SECRET`.
- **Invariant:** staging always `HEALTH_DRY_RUN=true`; production always live (`false`/unset).
- **GCP precondition (Google Health API enabled + the 4 scopes incl. `googlehealth.nutrition.writeonly`): done** (verified by the user — the write scope is real; the discovery `auth.oauth2.scopes` listing only `.readonly` is incomplete).

**🔴 PRE-PROMOTION LIVE VALIDATION GATES (must pass before merging `main`→`release`):**
The Google Health REST request/response shapes are now **confirmed against the v4 discovery document** (commit history; see Phase-3 notes) — NOT guesses. But two things can only be verified against the LIVE API, because **staging skips writes** (`HEALTH_DRY_RUN=true`):
1. **Nutrition WRITE end-to-end (the core gate).** Temporarily set `HEALTH_DRY_RUN=false` on staging, connect Google Health, then log → edit → delete a food. Confirm the dataPoint is created with correct nutrients/time/meal-type (check via the Google Health app or a direct `GET .../dataTypes/nutrition-log/dataPoints`), and that `batchDelete` removes it. If a field is rejected, correct ONLY the isolated `buildNutritionLogBody`/parser helpers in `google-health.ts`. Re-enable `HEALTH_DRY_RUN=true` on staging afterward.
2. **`getHealthActivitySummary` dailyRollUp range body** (`/api/v1/activity-summary`, optional/non-blocking — degrades to null). The `CivilTimeInterval` field names (`start`/`end` vs `startTime`/`endTime`, exclusive-end) and the `total-calories` data-type id are unconfirmed; validate live if/when the external activity API is needed. (Codex finding, deferred.)

**🔴 POST-CUTOVER USER ACTION (or daily goals stay blocked):** both Lucas and Mariana must, after re-consenting, **set their biological sex AND activity level** in Settings → Daily Goals (FOO-1116/FOO-1131 — the v4 profile does not expose sex; activity level is required by the macro engine). Until both are set, `getOrComputeDailyGoals` returns `goals_not_set`, the save button is disabled in the UI, and the home banner shows. Neither field has a default — each user must explicitly choose.

---

## Google Health migration (feat/google-health-migration)

### Task 4 — types/session/API contract (FOO-1074)
**No SQL.** Session/API contract change only. `FullSession.fitbitConnected` → `healthConnected` (recomputed per request from the presence of a health-tokens row); `hasFitbitCredentials` removed. `FoodLogResponse.fitbitLogId` (number) → `healthLogId` (string); `fitbitFoodId` removed. `ErrorCode` swaps all `FITBIT_*` codes for `HEALTH_*` (and drops `FITBIT_CREDENTIALS_MISSING`). After the forced re-consent at release, clients see `healthConnected=false` until they reconnect via `/app/connect-health`.

### Task 5 — fitbit_tokens → health_tokens (FOO-1075)
```sql
ALTER TABLE fitbit_tokens RENAME TO health_tokens;
ALTER TABLE health_tokens RENAME COLUMN fitbit_user_id TO health_user_id;
DELETE FROM health_tokens;  -- every stored Fitbit token is invalid under Google; forces re-consent
```
The rename preserves the FK (`user_id → users.id`) and the unique constraint on `user_id`. The `DELETE` clears both users' rows so login routes them through `/app/connect-health` to re-consent once. (drizzle-kit generate in Task 29 must emit a RENAME, not drop+create — verify before applying.)

### Task 6 — drop fitbit_credentials (FOO-1076)
```sql
DROP TABLE IF EXISTS fitbit_credentials;
```
No data preservation — the table held obsolete per-user Fitbit OAuth client id/secret. Google Health reuses the single shared Google OAuth client, so per-user credentials are gone. Orphaned Railway vars `FITBIT_CLIENT_ID`/`FITBIT_CLIENT_SECRET` are removed at deploy (Task 30), not in code.

### Task 7 — food_log_entries/custom_foods column changes + unit_id → text (FOO-1077)
```sql
-- food_log_entries: drop the numeric Fitbit handle, add the text Google Health handle
ALTER TABLE food_log_entries DROP COLUMN fitbit_log_id;
ALTER TABLE food_log_entries ADD COLUMN health_log_id text;  -- existing rows get NULL (old numeric ids are meaningless)
-- custom_foods: drop the per-food Fitbit handle (no Google Health equivalent)
ALTER TABLE custom_foods DROP COLUMN fitbit_food_id;
-- unit_id integer -> text on BOTH tables, with the legacy-id backfill (USING cast)
ALTER TABLE custom_foods     ALTER COLUMN unit_id TYPE text USING (CASE unit_id
  WHEN 147 THEN 'g' WHEN 226 THEN 'oz' WHEN 91 THEN 'cup' WHEN 349 THEN 'tbsp'
  WHEN 364 THEN 'tsp' WHEN 209 THEN 'ml' WHEN 311 THEN 'slice' ELSE 'serving' END);
ALTER TABLE food_log_entries ALTER COLUMN unit_id TYPE text USING (CASE unit_id
  WHEN 147 THEN 'g' WHEN 226 THEN 'oz' WHEN 91 THEN 'cup' WHEN 349 THEN 'tbsp'
  WHEN 364 THEN 'tsp' WHEN 209 THEN 'ml' WHEN 311 THEN 'slice' ELSE 'serving' END);
-- saved_analyses.food_analysis JSONB also carries unit_id — remap the embedded numeric ids (see Task 21/deploy notes)
```
**Nutrition data is preserved** (Postgres is the source of truth); only the external mirror handle (`fitbit_log_id`) resets to NULL. **Visibility behavior change:** the food-history/search/common/recent/match filters re-base from "custom food has a Fitbit food id" to "log entry has a remote `health_log_id`" (gated on `HEALTH_DRY_RUN`). A wrong USING cast corrupts every portion label — verify against a DB backup before release. (Task 8 adds the partial unique index on `(user_id, health_log_id)`; Task 29 generates the consolidated Drizzle migration.)

### Task 8 — performance indexes + CHECK + partial unique index (FOO-1078)
```sql
-- Run CREATE INDEX CONCURRENTLY on the live (populated) tables to avoid long locks.
CREATE INDEX CONCURRENTLY food_log_entries_user_date_idx   ON food_log_entries (user_id, date);
CREATE INDEX CONCURRENTLY food_log_entries_custom_food_idx ON food_log_entries (custom_food_id);
CREATE INDEX CONCURRENTLY custom_foods_user_idx            ON custom_foods (user_id);
-- Partial unique index — safe because health_log_id is all-NULL right after the Task 5/7 rename+reset.
CREATE UNIQUE INDEX CONCURRENTLY food_log_entries_user_health_log_uniq
  ON food_log_entries (user_id, health_log_id) WHERE health_log_id IS NOT NULL;
-- daily_calorie_goals activity_level CHECK — pre-validate no existing row violates the enum before adding.
ALTER TABLE daily_calorie_goals ADD CONSTRAINT daily_calorie_goals_activity_level_chk
  CHECK (activity_level IS NULL OR activity_level IN ('sedentary','light','moderate','very_active','extra_active'));
```
No data change. (drizzle-kit generate in Task 29 will emit non-CONCURRENT `CREATE INDEX`; the lead substitutes `CONCURRENTLY` when applying against the populated production tables.)

### Task 9 — users.weightGoalType (FOO-1079)
```sql
ALTER TABLE users ADD COLUMN weight_goal_type text;
ALTER TABLE users ADD CONSTRAINT users_weight_goal_type_chk
  CHECK (weight_goal_type IS NULL OR weight_goal_type IN ('LOSE','MAINTAIN','GAIN'));
```
Nullable, no backfill — replaces the removed Fitbit weight-goal read. Null renders as "Not set"; existing users re-select it if they want the profile card to show a direction. Helpers `getWeightGoalType`/`setWeightGoalType` live in `src/lib/users.ts` (the existing settings module; the plan's notional `user-settings.ts` maps to it). **Now settable** via the Daily Goals settings form + `PATCH /api/daily-goals-settings` (FOO-1116 follow-up — the setter previously had no UI).

### FOO-1116 — users.sex (post-review fix, migration `drizzle/0028`)
```sql
ALTER TABLE users ADD COLUMN sex text;
ALTER TABLE users ADD CONSTRAINT users_sex_chk
  CHECK (sex IS NULL OR sex IN ('MALE','FEMALE'));
```
Nullable, no backfill. The Google Health v4 Profile resource does NOT expose biological sex (unlike Fitbit), so it becomes a LOCAL macro-engine input set in the Daily Goals settings form. **Both existing users (Lucas, Mariana) MUST set their sex after cutover or daily-goal computation stays blocked** (`goals_not_set` → home settings banner). Safe to apply to populated tables (nullable add + CHECK; CHECK validates only non-null values).

### Task 10 — session contract rewire (FOO-1080)
**No SQL** — session state is recomputed per request. `getSession()` now derives `healthConnected` from the presence of a `health_tokens` row (via `getHealthTokens`); `fitbitConnected`/`hasFitbitCredentials` are removed. `validateSession({ requireHealth: true })` returns a 400 `HEALTH_NOT_CONNECTED` response (replacing the former `requireFitbit` → `FITBIT_NOT_CONNECTED`/`FITBIT_CREDENTIALS_MISSING` two-tier check). After the release token-clear, both users see `healthConnected=false` until they reconnect.

---

## Phase 3 — Google Health write/read transport + route rewires (Tasks 16–21)

**No new SQL.** All Phase-3 changes are code rewires against the schema already migrated in Phase 1 (Task 29 emits the single consolidated Drizzle migration). The notes below are **API/route-contract and release-QA** items, not data migrations.

### Task 16 / 18 — Google Health API body shapes (FOO-1086, FOO-1088, FOO-1115)
The Google Health REST request/response field paths are now **confirmed against the v4 discovery document** (`health.googleapis.com/$discovery/rest?version=v4`), corrected in commit df1361b/this branch:
- `createNutritionLog` / `deleteNutritionLogs` — `POST .../dataTypes/nutrition-log/dataPoints` with a DataPoint `{ name, nutritionLog }`; NutritionLog = `foodDisplayName`, `energy`/`energyFromFat` (`{kcal}`), `totalCarbohydrate`/`totalFat` (`{grams}`), `serving` (`{amount, foodMeasurementUnit}`), `interval` (SessionTimeInterval), `mealType` (BREAKFAST/LUNCH/DINNER/SNACK/ANYTIME), `nutrients[]` (`{nutrient, quantity:{grams}}` keyed PROTEIN/DIETARY_FIBER/SODIUM/SATURATED_FAT/TRANS_FAT/SUGAR — sodium mg→grams). Delete = `:batchDelete` with `{ names: [resourceName] }`. Create returns a long-running Operation, so the dataPoint id is client-generated.
- `getHealthProfile` — `GET /v4/users/me/profile` (exposes `age` only — NO sex/height). **sex is a local setting (FOO-1116)**; height read from the `height` data type (`heightMillimeters` → cm).
- `getHealthLatestWeightKg` — `GET .../dataTypes/weight/dataPoints` (`weightGrams`→kg, `sampleTime.physicalTime`), client-side filtered to `[targetDate-13d, targetDate]`.
- `getHealthActivitySummary` — `POST .../dataTypes/total-calories/dataPoints:dailyRollUp`, response `rollupDataPoints[]` summed by `kcalSum`.

**Remaining LIVE-only validation (FOO-1115):** staging runs `HEALTH_DRY_RUN=true`, so the WRITE path (create/batchDelete) is never exercised there — to confirm it against the live API, flip `HEALTH_DRY_RUN` off on staging (real writes) before promoting. Also unconfirmed: the exact `dailyRollUp` request body + the `total-calories` data-type id (optional, non-blocking read). The request-body construction is isolated in `buildNutritionLogBody` / per-read parser helpers so any remaining mismatch has a contained blast radius.

### Task 17 — write-route contract (FOO-1087)
`POST /api/log-food` gains an **optional `clientToken`** for idempotency (per-user, in-memory, ~5-min TTL, resets on deploy — acceptable for the 2-user app). Responses now expose **`healthLogId` (string)** in place of the old numeric Fitbit ids. Pre-existing rows carrying legacy numeric ids hold stale, string-incompatible handles — they are replaced on the next edit/delete. (DB column change itself is Task 7 / Phase 1.)

### Task 20 — client-facing route + SWR key changes (FOO-1090)
- Route paths change: `/api/fitbit/profile` → **`/api/health-profile`**, `/api/fitbit/health` → **`/api/health-status`** (the public `/api/health` check is untouched).
- SWR config export renamed: `FITBIT_BACKED_SWR_CONFIG` → **`HEALTH_BACKED_SWR_CONFIG`**; profile/daily-goals SWR keys move accordingly.
- External `/api/v1/activity-summary` response body `{ caloriesOut }` is **unchanged**; only the upstream data source (Google Health) and error codes change.

### Task 27 — deleteUserData admin path + integration test infrastructure (FOO-1097)

**No SQL.** `deleteUserData(userId)` in `src/lib/user-data.ts` deletes all rows for a user in
FK-safe order inside a single Postgres transaction. No schema changes are required.

**FK onDelete strategy: NO ACTION (not CASCADE)**

FK constraints remain `ON DELETE NO ACTION` (the Drizzle ORM default). Rationale:

- **Fail-safe**: an accidental single-table delete (missing a table in the order) is caught
  immediately by the DB with a FK violation, rather than silently cascading and losing data.
- **Self-documenting**: the explicit deletion sequence in `deleteUserData` is reviewable code;
  `ON DELETE CASCADE` hides what gets deleted and the rationale for the sequence.
- **No schema change required**: `NO ACTION` is already the default. `CASCADE` would require
  adding `{ onDelete: "cascade" }` to every FK in `schema.ts` plus a `drizzle-kit generate`
  / migration run — a non-trivial blast radius.
- **Acceptable at this scale**: the function is called infrequently (admin user-deletion path),
  so the explicit per-table delete order is not a maintenance burden.

The CASCADE alternative becomes more attractive if the number of FK-child tables grows
significantly; the current trade-off (visibility + no schema change) is preferred for now.

**Integration test DATABASE_URL setup**

The integration suite (`npm run test:integration`) reads `INTEGRATION_DATABASE_URL` — a
**dedicated** env var, never `DATABASE_URL`. This prevents any accidental connection to dev
or production. The lead runs the following before the integration gate:

```bash
# 1. Start a throwaway Postgres container
docker run --rm -d -p 5433:5432 \
  -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=food_scanner_integration \
  --name pg-integration postgres:16

# 2. Apply the current schema. Simplest for a throwaway DB: drizzle-kit push
#    (syncs schema.ts directly, non-interactive on an empty DB). The committed
#    drizzle/ migrations (incl. 0027) are now current and would also work via
#    startup-migrate, but push is faster for a disposable integration DB.
INTEGRATION_DATABASE_URL="postgresql://postgres:test@localhost:5433/food_scanner_integration" \
  DATABASE_URL="postgresql://postgres:test@localhost:5433/food_scanner_integration" \
  npx drizzle-kit push --config drizzle.config.ts

# 3. Run the integration suite
INTEGRATION_DATABASE_URL="postgresql://postgres:test@localhost:5433/food_scanner_integration" \
  npm run test:integration

# 4. Tear down
docker stop pg-integration
```

### Task 21 — Claude tool schema (FOO-1091)
**No data migration.** The Claude tool-schema property `unit_id` → `serving_unit` (string enum) is an LLM-contract change only; the internal parsed field stays `unit_id` carrying a `ServingUnit` string. The legacy numeric→string `unit_id` DB backfill is already covered by the Task 7 deploy note.
