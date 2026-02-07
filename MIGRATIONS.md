# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Do NOT write migration code here — that happens at release time.

<!-- Add entries below this line -->

## Multi-user support: users table + email→userId migration (FOO-213, FOO-214, FOO-215, FOO-216)

**Schema changes (2 migrations):**

1. **0005** — Creates `users` table (id UUID PK, email unique, name, timestamps). Adds `user_id` UUID NOT NULL FK column to `sessions`, `fitbit_tokens`, `custom_foods`, `food_log_entries`. Adds unique constraint on `fitbit_tokens.user_id`.

2. **0006** — Drops `email` column from `sessions`, `fitbit_tokens`, `custom_foods`, `food_log_entries`. Drops `fitbit_tokens_email_unique` constraint.

**Production data migration required between 0005 and 0006:**
- Before running 0005: existing tables have `email` columns with data
- After 0005, before 0006: need to backfill `user_id` in all rows:
  1. Create a user record in `users` table with **lowercased** email (new code normalizes to lowercase):
     `INSERT INTO users (id, email) VALUES (gen_random_uuid(), LOWER('wall.lucas@gmail.com'))`
  2. UPDATE `sessions` SET `user_id` = (user UUID) WHERE LOWER(`email`) = 'wall.lucas@gmail.com'
  3. UPDATE `fitbit_tokens` SET `user_id` = (user UUID) WHERE LOWER(`email`) = 'wall.lucas@gmail.com'
  4. UPDATE `custom_foods` SET `user_id` = (user UUID) WHERE LOWER(`email`) = 'wall.lucas@gmail.com'
  5. UPDATE `food_log_entries` SET `user_id` = (user UUID) WHERE LOWER(`email`) = 'wall.lucas@gmail.com'
- Then run 0006 to drop the now-redundant email columns

**Environment variable rename:**
- `ALLOWED_EMAIL` → `ALLOWED_EMAILS` (comma-separated). Must update Railway env var before deploy.

**Session invalidation:**
- All existing sessions will be invalid after deploy (they store `email` in session-db, new code expects `userId`). Users must re-login. This is acceptable per development policies.
