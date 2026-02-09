# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Do NOT write migration code here — that happens at release time.

<!-- Add entries below this line -->

## Orphan custom_foods cleanup (FOO-284)
After deploying the orphan-cleanup code, run a one-time query to clean up existing orphaned rows:
```sql
DELETE FROM custom_foods WHERE id NOT IN (SELECT DISTINCT custom_food_id FROM food_log_entries);
```
