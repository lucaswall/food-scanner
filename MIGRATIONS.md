# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## 2026-04-10: New `hydration_readings` table

New table `hydration_readings` created via Drizzle migration `0019_flowery_medusa.sql`. No existing data affected — this is a net-new table. Migration is `CREATE TABLE` + FK constraint only.
