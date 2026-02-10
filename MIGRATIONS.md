# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## 2026-02-10: New `lumen_goals` table

**Migration:** `drizzle/0010_elite_shiva.sql` — DDL-only, no existing data to transform.

Creates `lumen_goals` table with columns: id (serial PK), user_id (UUID FK → users), date, day_type, protein_goal, carbs_goal, fat_goal, created_at, updated_at. Composite unique constraint on (user_id, date).
