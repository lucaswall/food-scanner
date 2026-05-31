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
