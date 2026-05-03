# Pending Production Migrations

Log potential production data migrations here during development. These notes are assessed and implemented by the `push-to-production` skill when promoting `main` to `release`.

**Format:** Describe what changed and what data is affected. Simple reference SQL is fine; do not write full migration scripts — those are built at release time.

<!-- Add entries below this line -->

## 2026-05-03 — Macro engine: fitbit_tokens.scope + daily_calorie_goals macro/audit columns

**What changed (additive, no data backfill in this step):**

- `fitbit_tokens.scope` (nullable `text`) — populated lazily on each user's next OAuth exchange. NULL means "legacy `nutrition activity` only" → triggers the scope-mismatch banner. Both Lucas and Mariana will see "Reconnect Fitbit" once after deploy and both must reconnect to populate the column.
- `daily_calorie_goals` gains nullable columns: `protein_goal int`, `carbs_goal int`, `fat_goal int`, `weight_kg numeric`, `calories_out int`, `rmr int`, `activity_kcal int`. All nullable so existing rows migrate cleanly. Lumen-backfilled rows (see later entry) will carry NULL audit columns to mark their historical-Lumen origin.

**Migration handling:** Standard Drizzle migration — auto-runs at startup. No backfill required for this step.
