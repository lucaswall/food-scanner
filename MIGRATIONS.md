# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## Per-user Fitbit credentials (FOO-288)
New `fitbit_credentials` table. After deployment:
1. Remove `FITBIT_CLIENT_ID` and `FITBIT_CLIENT_SECRET` from Railway production and staging env vars
2. Existing user must re-enter Fitbit credentials through the new setup flow at `/app/setup-fitbit`

No data migration needed — new table, no existing rows to convert.

## Orphan custom_foods cleanup (FOO-284)
After deploying the orphan-cleanup code, run a one-time query to clean up existing orphaned rows:
```sql
DELETE FROM custom_foods WHERE id NOT IN (SELECT DISTINCT custom_food_id FROM food_log_entries);
```
