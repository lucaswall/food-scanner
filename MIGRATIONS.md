# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## 0009: Add Tier 1 nutrient columns to custom_foods

**Migration:** `drizzle/0009_gigantic_silver_fox.sql`
**Issue:** FOO-300

Adds 4 nullable numeric columns to `custom_foods`: `saturated_fat_g`, `trans_fat_g`, `sugars_g`, `calories_from_fat`. No data backfill needed — existing rows get NULL. Safe for production.
