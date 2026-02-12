# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## New `daily_calorie_goals` table (FOO-340)

**Migration:** `drizzle/0013_hard_lady_bullseye.sql`
**Type:** Schema-only (new table)
**Impact:** None — new table, no existing data affected. Drizzle will apply automatically on deploy.
