# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## zone_offset on food_log_entries (2026-03-29)

New nullable `zone_offset` varchar(6) column added to `food_log_entries`. Drizzle migration `0017_lonely_warbound.sql` handles the schema change. Existing production rows need backfill:

```sql
UPDATE food_log_entries SET zone_offset = '-03:00' WHERE zone_offset IS NULL;
```

