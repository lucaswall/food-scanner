# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## 2026-02-12: New `claude_usage` table (FOO-334)

New table only — no existing data affected. Migration is a simple `CREATE TABLE claude_usage (...)` with FK to `users.id`. Drizzle migration file: `drizzle/0012_gifted_nomad.sql`.
