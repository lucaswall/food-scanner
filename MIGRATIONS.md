# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

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
Nullable, no backfill — replaces the removed Fitbit weight-goal read. Null renders as "Not set"; existing users re-select it if they want the profile card to show a direction. Helpers `getWeightGoalType`/`setWeightGoalType` live in `src/lib/users.ts` (the existing settings module; the plan's notional `user-settings.ts` maps to it).

### Task 10 — session contract rewire (FOO-1080)
**No SQL** — session state is recomputed per request. `getSession()` now derives `healthConnected` from the presence of a `health_tokens` row (via `getHealthTokens`); `fitbitConnected`/`hasFitbitCredentials` are removed. `validateSession({ requireHealth: true })` returns a 400 `HEALTH_NOT_CONNECTED` response (replacing the former `requireFitbit` → `FITBIT_NOT_CONNECTED`/`FITBIT_CREDENTIALS_MISSING` two-tier check). After the release token-clear, both users see `healthConnected=false` until they reconnect.

---

## Phase 3 — Google Health write/read transport + route rewires (Tasks 16–21)

**No new SQL.** All Phase-3 changes are code rewires against the schema already migrated in Phase 1 (Task 29 emits the single consolidated Drizzle migration). The notes below are **API/route-contract and release-QA** items, not data migrations.

### Task 16 / 18 — Google Health API body shapes (FOO-1086, FOO-1088)
The Google Health REST request/response field paths are **inferred from docs, not a live API**, and must be confirmed during staging QA:
- `createNutritionLog` / `deleteNutritionLogs` — `nutrition-log/dataPoints` create (`food_display_name` + `energy`/`protein`/`carbs`/`fat`/`fiber`/`sodium`, optional `trans_fat`/`sugars`/`saturated_fat`/`calories_from_fat`) and `batchDelete`.
- `getHealthProfile` — `https://health.googleapis.com/v4/users/me` (sex/height/DOB → `{ ageYears, sex, heightCm }`).
- `getHealthLatestWeightKg` — single ranged fetch over `[targetDate-13d, targetDate]` (replaces the old 14-day walk-back), most-recent point on/before `targetDate`.
- `getHealthActivitySummary` — `/activity-summary?date=` dailyRollUp → `{ caloriesOut }`.
The request-body construction is isolated in `buildNutritionLogBody` / per-read parser helpers so a wrong field path has a contained blast radius — correct only those helpers if staging QA finds a mismatch.

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

# 2. Apply the current schema (drizzle-kit push syncs schema.ts directly;
#    do NOT use the committed drizzle/ migration files — they are STALE
#    pending Task 29's drizzle-kit generate).
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
